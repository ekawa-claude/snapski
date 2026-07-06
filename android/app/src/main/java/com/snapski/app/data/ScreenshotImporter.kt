package com.snapski.app.data

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Opt-in auto-import of new screenshots from the system Screenshots folder.
 *
 * Watermark = MediaStore date_added (seconds). Enabling resets it to "now",
 * so history is never pulled in — only screenshots taken afterwards.
 */
class ScreenshotImporter(private val context: Context, private val library: LibraryRepository) {

    private val prefs = context.getSharedPreferences("snapski_screenshots", Context.MODE_PRIVATE)

    val enabled: Boolean get() = prefs.getBoolean("enabled", false)

    fun setEnabled(on: Boolean) {
        prefs.edit().apply {
            putBoolean("enabled", on)
            // Fresh watermark on every enable: only screenshots from this point on.
            if (on) putLong("watermark", System.currentTimeMillis() / 1000)
        }.apply()
    }

    fun hasPermission(): Boolean {
        fun granted(p: String) =
            ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
        return when {
            Build.VERSION.SDK_INT >= 34 ->
                granted(Manifest.permission.READ_MEDIA_IMAGES) ||
                    granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            Build.VERSION.SDK_INT >= 33 -> granted(Manifest.permission.READ_MEDIA_IMAGES)
            else -> granted(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    /** The permission to ask for at the current API level. */
    fun permissionToRequest(): String =
        if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
        else Manifest.permission.READ_EXTERNAL_STORAGE

    /** Import screenshots newer than the watermark. Returns how many came in. */
    suspend fun importNew(): Int = withContext(Dispatchers.IO) {
        if (!enabled || !hasPermission()) return@withContext 0
        val watermark = prefs.getLong("watermark", System.currentTimeMillis() / 1000)

        val collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val (selection, args) = if (Build.VERSION.SDK_INT >= 29) {
            "${MediaStore.Images.Media.RELATIVE_PATH} LIKE ? AND ${MediaStore.Images.Media.DATE_ADDED} > ?" to
                arrayOf("%Screenshots%", watermark.toString())
        } else {
            @Suppress("DEPRECATION")
            "${MediaStore.Images.Media.DATA} LIKE ? AND ${MediaStore.Images.Media.DATE_ADDED} > ?" to
                arrayOf("%/Screenshots/%", watermark.toString())
        }

        val found = mutableListOf<Pair<Uri, Long>>()
        context.contentResolver.query(
            collection,
            arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_ADDED),
            selection,
            args,
            "${MediaStore.Images.Media.DATE_ADDED} ASC",
        )?.use { c ->
            val idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val dateCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            while (c.moveToNext()) {
                found += ContentUris.withAppendedId(collection, c.getLong(idCol)) to c.getLong(dateCol)
            }
        }
        if (found.isEmpty()) return@withContext 0

        val imported = library.importUris(found.map { it.first }, source = "screenshot")
        // Advance past everything we saw — no re-import loops on failed rows.
        prefs.edit().putLong("watermark", found.maxOf { it.second }).apply()
        imported.size
    }
}
