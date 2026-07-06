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
)

/**
 * Flat-file library: images in filesDir/library, metadata in index.json.
 * Small enough that a full rewrite of the index on every mutation is fine.
 */
class LibraryRepository(private val context: Context) {

    private val dir = File(context.filesDir, "library").apply { mkdirs() }
    private val indexFile = File(dir, "index.json")
    private val lock = Any()

    private val _shots = MutableStateFlow(loadIndex())
    val shots: StateFlow<List<Shot>> = _shots

    fun file(shot: Shot): File = File(dir, shot.fileName)
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

    fun toggleFavorite(id: String) =
        mutate { list -> list.map { if (it.id == id) it.copy(favorite = !it.favorite) else it } }

    fun delete(ids: Set<String>) = mutate { list ->
        list.filter { shot ->
            if (shot.id in ids) {
                File(dir, shot.fileName).delete()
                false
            } else true
        }
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
            })
        }
        indexFile.writeText(arr.toString())
    }
}
