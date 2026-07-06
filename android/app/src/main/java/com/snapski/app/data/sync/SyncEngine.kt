package com.snapski.app.data.sync

import android.util.Log
import com.snapski.app.data.LibraryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

data class SyncStatus(
    val running: Boolean = false,
    val lastSyncAt: Long = 0,
    val queued: Int = 0,
    val serverUsed: Long = 0,
    val serverQuota: Long = 0,
    val storageFull: Boolean = false,
    val lastError: String? = null,
)

/**
 * Push-then-pull sync against the hub. Opt-in: only shots the user marked
 * [com.snapski.app.data.Shot.wantSync] ever leave the device.
 *
 * Order matters — upload shots before their favorite ops, so /ops never
 * references a shot the hub doesn't have yet.
 */
class SyncEngine(
    private val repo: LibraryRepository,
    private val prefs: SyncPrefs,
    private val api: HubApi = HubApi(prefs),
) {
    private val TAG = "SyncEngine"
    private val runLock = Mutex()

    private val _status = MutableStateFlow(currentStatus())
    val status: StateFlow<SyncStatus> = _status

    fun refreshStatus() { _status.value = currentStatus() }

    private fun currentStatus(full: Boolean = false, error: String? = null) = SyncStatus(
        running = false,
        lastSyncAt = prefs.lastSyncAt,
        queued = repo.pendingUploads().size + repo.snapshotPendingOps().size,
        serverUsed = prefs.serverUsed,
        serverQuota = prefs.serverQuota,
        storageFull = full,
        lastError = error,
    )

    /** Run a full push+pull cycle. Safe to call concurrently — serialized. */
    suspend fun sync(): SyncStatus = withContext(Dispatchers.IO) {
        if (!prefs.enabled || !prefs.isPaired) return@withContext currentStatus()
        runLock.withLock {
            _status.value = _status.value.copy(running = true, lastError = null)
            var storageFull = false
            var error: String? = null
            try {
                storageFull = pushShots()
                pushOps()
                pull()
                prefs.lastSyncAt = System.currentTimeMillis()
            } catch (e: HubException) {
                if (e.code == 507) storageFull = true else error = "hub ${e.code}"
                Log.w(TAG, "sync hub error", e)
            } catch (e: Exception) {
                error = e.message ?: e.javaClass.simpleName
                Log.w(TAG, "sync failed", e)
            }
            currentStatus(storageFull, error).also { _status.value = it }
        }
    }

    /** Returns true if we hit the group quota (507). */
    private fun pushShots(): Boolean {
        for (shot in repo.pendingUploads()) {
            val f = repo.file(shot)
            if (!f.exists()) continue
            try {
                val seq = api.uploadShot(shot, f)
                repo.markUploaded(shot.id, seq)
            } catch (e: HubException) {
                if (e.code == 507) return true       // storage full — stop, keep queue
                if (e.code == 413) { Log.w(TAG, "shot ${shot.id} too large, skipping"); continue }
                throw e                               // network/auth — abort, retry later
            }
        }
        return false
    }

    private fun pushOps() {
        // Skip favorite ops whose shot isn't on the hub yet (upload failed this
        // run); they'll go out next cycle once the shot lands. Deletes always go.
        val notUploaded = repo.pendingUploads().map { it.id }.toSet()
        val toClear = mutableListOf<String>()
        for (op in repo.snapshotPendingOps()) {
            if (op.kind == "favorite" && op.shotId in notUploaded) continue
            api.postOp(op)
            toClear += op.localId
        }
        if (toClear.isNotEmpty()) repo.clearOps(toClear)
    }

    private fun pull() {
        var cursor = prefs.cursor
        var guard = 0
        while (guard++ < 100) {
            val resp = api.getChanges(cursor)
            for (c in resp.changes) {
                when (c.kind) {
                    "shot" -> applyRemoteShot(c)
                    "favorite" -> repo.applyRemoteFavorite(c.shotId, c.value ?: true, c.ts ?: 0)
                    "delete" -> repo.applyRemoteDelete(c.shotId)
                }
            }
            cursor = resp.next
            prefs.cursor = cursor
            prefs.serverUsed = resp.usage
            prefs.serverQuota = resp.quota
            if (!resp.hasMore) break
        }
    }

    private fun applyRemoteShot(c: ChangeItem) {
        val id = c.shotId
        if (repo.isTombstoned(id) || repo.byId(id) != null) return
        val meta = c.meta ?: return
        val fileName = "$id.png"
        try {
            api.downloadFile(id, repo.fileByName(fileName))
        } catch (e: HubException) {
            // Shot was deleted on the server before we fetched it — skip.
            Log.w(TAG, "download $id failed (${e.code})")
            return
        }
        repo.applyRemoteShot(
            id = id,
            fileName = fileName,
            createdAt = meta.optLong("createdAt", c.ts ?: System.currentTimeMillis()),
            favorite = meta.optBoolean("favorite"),
            source = meta.optString("source", "import"),
            editedFrom = meta.optString("editedFrom").ifEmpty { null },
            seq = c.seq,
            favoriteTs = c.ts ?: 0,
        )
    }
}
