package com.snapski.app.data

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class Shot(
    val id: String,
    val fileName: String,
    val createdAt: Long,
    val favorite: Boolean = false,
    val source: String = "import",
    val editedFrom: String? = null,
    // --- sync (3b) ---
    /** User intent: this shot should live in the cloud library. Opt-in. */
    val wantSync: Boolean = false,
    /** Server seq once actually uploaded; null = not on the hub yet. */
    val uploadedSeq: Long? = null,
    /** Client ts of the last favorite change — LWW conflict resolution. */
    val favoriteTs: Long = 0,
)

/** A local mutation waiting to be pushed to the hub as POST /ops. */
data class PendingOp(
    val localId: String,
    val kind: String,      // "favorite" | "delete"
    val shotId: String,
    val value: Boolean?,   // favorite: new state; delete: null
    val ts: Long,
)

/**
 * Flat-file library: images in filesDir/library, metadata in index.json.
 * Small enough that a full rewrite of the index on every mutation is fine.
 *
 * Sync (3b) is opt-in: nothing leaves the device until a shot gets
 * [Shot.wantSync] = true (via [requestSync] or by favoriting). Local
 * favorite/delete mutations are also recorded in a durable ops outbox
 * ([ops.json]) so the [SyncEngine] can push them; deletions leave a
 * tombstone so a late pull can't resurrect them.
 */
class LibraryRepository(private val context: Context) {

    private val dir = File(context.filesDir, "library").apply { mkdirs() }
    private val indexFile = File(dir, "index.json")
    private val opsFile = File(dir, "ops.json")
    private val tombstoneFile = File(dir, "tombstones.json")
    private val lock = Any()

    private val _shots = MutableStateFlow(loadIndex())
    val shots: StateFlow<List<Shot>> = _shots

    private val pendingOps = loadOps().toMutableList()
    private val tombstones = loadTombstones().toMutableSet()

    fun file(shot: Shot): File = File(dir, shot.fileName)
    fun fileByName(name: String): File = File(dir, name)
    fun byId(id: String): Shot? = _shots.value.find { it.id == id }

    suspend fun importUris(uris: List<Uri>, source: String = "share"): List<Shot> =
        withContext(Dispatchers.IO) {
            val imported = uris.mapNotNull { uri ->
                runCatching {
                    val ext = when (context.contentResolver.getType(uri)) {
                        "image/png" -> "png"
                        "image/webp" -> "webp"
                        else -> "jpg"
                    }
                    val id = UUID.randomUUID().toString().take(8)
                    val name = "$id.$ext"
                    context.contentResolver.openInputStream(uri)!!.use { input ->
                        File(dir, name).outputStream().use { input.copyTo(it) }
                    }
                    Shot(id = id, fileName = name, createdAt = System.currentTimeMillis(), source = source)
                }.getOrNull()
            }
            if (imported.isNotEmpty()) mutate { it + imported }
            imported
        }

    suspend fun saveEdited(bitmap: Bitmap, from: Shot?): Shot =
        saveBitmap(bitmap, source = "edit", editedFrom = from?.id)

    suspend fun saveCapture(bitmap: Bitmap): Shot = saveBitmap(bitmap, source = "capture")

    private suspend fun saveBitmap(
        bitmap: Bitmap,
        source: String,
        editedFrom: String? = null,
    ): Shot = withContext(Dispatchers.IO) {
        val id = UUID.randomUUID().toString().take(8)
        val name = "$id.png"
        File(dir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val shot = Shot(
            id = id, fileName = name, createdAt = System.currentTimeMillis(),
            source = source, editedFrom = editedFrom,
        )
        mutate { it + shot }
        shot
    }

    /** Explicit "Sync" from multiselect: opt these shots into the cloud. */
    fun requestSync(ids: Set<String>) = mutate { list ->
        list.map { if (it.id in ids && !it.wantSync) it.copy(wantSync = true) else it }
    }

    /**
     * Toggle favorite. Turning a star ON also opts the shot into sync (a
     * favorite is a signal the user wants to revisit it). Un-favoriting does
     * NOT retract sync (sticky one-way). Either way we record a favorite op so
     * the star propagates across devices.
     */
    fun toggleFavorite(id: String) {
        val ts = System.currentTimeMillis()
        var op: PendingOp? = null
        mutate { list ->
            list.map { shot ->
                if (shot.id == id) {
                    val next = !shot.favorite
                    op = PendingOp(UUID.randomUUID().toString(), "favorite", id, next, ts)
                    shot.copy(
                        favorite = next,
                        favoriteTs = ts,
                        wantSync = shot.wantSync || next,
                    )
                } else shot
            }
        }
        op?.let { enqueueOp(it) }
    }

    fun delete(ids: Set<String>) {
        val ts = System.currentTimeMillis()
        val ops = mutableListOf<PendingOp>()
        mutate { list ->
            list.filter { shot ->
                if (shot.id in ids) {
                    File(dir, shot.fileName).delete()
                    // Only tell the hub to delete shots it actually has.
                    if (shot.uploadedSeq != null) {
                        ops += PendingOp(UUID.randomUUID().toString(), "delete", shot.id, null, ts)
                    }
                    false
                } else true
            }
        }
        if (ids.isNotEmpty()) addTombstones(ids)
        ops.forEach { enqueueOp(it) }
    }

    // --- sync engine hooks -------------------------------------------------

    /** Shots the user wants in the cloud that aren't up there yet. */
    fun pendingUploads(): List<Shot> =
        _shots.value.filter { it.wantSync && it.uploadedSeq == null }

    fun markUploaded(id: String, seq: Long) = mutate { list ->
        list.map { if (it.id == id) it.copy(uploadedSeq = seq, wantSync = true) else it }
    }

    fun snapshotPendingOps(): List<PendingOp> = synchronized(lock) { pendingOps.toList() }

    fun clearOps(localIds: Collection<String>) = synchronized(lock) {
        if (pendingOps.removeAll { it.localId in localIds }) saveOps()
    }

    fun isTombstoned(id: String): Boolean = synchronized(lock) { id in tombstones }

    /**
     * Apply a shot pulled from the hub. No-op if we already have it or it was
     * locally deleted (tombstone). The PNG must already be written to [fileName].
     */
    fun applyRemoteShot(
        id: String, fileName: String, createdAt: Long, favorite: Boolean,
        source: String, editedFrom: String?, seq: Long, favoriteTs: Long,
    ) = mutate { list ->
        if (id in tombstones || list.any { it.id == id }) return@mutate list
        list + Shot(
            id = id, fileName = fileName, createdAt = createdAt, favorite = favorite,
            source = source, editedFrom = editedFrom,
            wantSync = true, uploadedSeq = seq, favoriteTs = favoriteTs,
        )
    }

    /** Apply a remote favorite op with LWW: newer client ts wins. */
    fun applyRemoteFavorite(shotId: String, value: Boolean, ts: Long) = mutate { list ->
        list.map {
            if (it.id == shotId && ts >= it.favoriteTs) it.copy(favorite = value, favoriteTs = ts)
            else it
        }
    }

    /** Apply a remote delete: remove locally and tombstone so it can't return. */
    fun applyRemoteDelete(shotId: String) {
        addTombstones(setOf(shotId))
        mutate { list ->
            list.filter { shot ->
                if (shot.id == shotId) {
                    File(dir, shot.fileName).delete(); false
                } else true
            }
        }
    }

    // --- persistence -------------------------------------------------------

    private fun enqueueOp(op: PendingOp) = synchronized(lock) {
        pendingOps += op
        saveOps()
    }

    private fun addTombstones(ids: Set<String>) = synchronized(lock) {
        if (tombstones.addAll(ids)) saveTombstones()
    }

    private fun mutate(transform: (List<Shot>) -> List<Shot>) {
        synchronized(lock) {
            val next = transform(_shots.value)
            _shots.value = next
            saveIndex(next)
        }
    }

    private fun loadIndex(): List<Shot> = runCatching {
        if (!indexFile.exists()) return emptyList()
        val arr = JSONArray(indexFile.readText())
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Shot(
                id = o.getString("id"),
                fileName = o.getString("fileName"),
                createdAt = o.getLong("createdAt"),
                favorite = o.optBoolean("favorite"),
                source = o.optString("source", "import"),
                editedFrom = o.optString("editedFrom").ifEmpty { null },
                wantSync = o.optBoolean("wantSync"),
                uploadedSeq = if (o.has("uploadedSeq") && !o.isNull("uploadedSeq"))
                    o.getLong("uploadedSeq") else null,
                favoriteTs = o.optLong("favoriteTs"),
            )
        }
    }.getOrDefault(emptyList())

    private fun saveIndex(list: List<Shot>) {
        val arr = JSONArray()
        list.forEach { s ->
            arr.put(JSONObject().apply {
                put("id", s.id)
                put("fileName", s.fileName)
                put("createdAt", s.createdAt)
                put("favorite", s.favorite)
                put("source", s.source)
                s.editedFrom?.let { put("editedFrom", it) }
                put("wantSync", s.wantSync)
                s.uploadedSeq?.let { put("uploadedSeq", it) }
                put("favoriteTs", s.favoriteTs)
            })
        }
        indexFile.writeText(arr.toString())
    }

    private fun loadOps(): List<PendingOp> = runCatching {
        if (!opsFile.exists()) return emptyList()
        val arr = JSONArray(opsFile.readText())
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PendingOp(
                localId = o.getString("localId"),
                kind = o.getString("kind"),
                shotId = o.getString("shotId"),
                value = if (o.has("value") && !o.isNull("value")) o.getBoolean("value") else null,
                ts = o.getLong("ts"),
            )
        }
    }.getOrDefault(emptyList())

    private fun saveOps() {
        val arr = JSONArray()
        pendingOps.forEach { op ->
            arr.put(JSONObject().apply {
                put("localId", op.localId)
                put("kind", op.kind)
                put("shotId", op.shotId)
                op.value?.let { put("value", it) }
                put("ts", op.ts)
            })
        }
        opsFile.writeText(arr.toString())
    }

    private fun loadTombstones(): Set<String> = runCatching {
        if (!tombstoneFile.exists()) return emptySet()
        val arr = JSONArray(tombstoneFile.readText())
        (0 until arr.length()).map { arr.getString(it) }.toSet()
    }.getOrDefault(emptySet())

    private fun saveTombstones() {
        tombstoneFile.writeText(JSONArray(tombstones.toList()).toString())
    }
}
