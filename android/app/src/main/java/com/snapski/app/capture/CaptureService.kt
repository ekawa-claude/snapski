package com.snapski.app.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.snapski.app.MainActivity
import com.snapski.app.R
import com.snapski.app.SnapSkiApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * One-shot screenshot: started with a fresh MediaProjection consent, waits a beat
 * for the consent dialog / shade to disappear, grabs a frame, saves it to the
 * library, posts a notification that opens the editor, and stops itself.
 */
class CaptureService : Service() {

    companion object {
        private const val EXTRA_CODE = "code"
        private const val EXTRA_DATA = "data"
        private const val CHANNEL = "capture"
        private const val NOTIF_ID = 10
        const val EXTRA_OPEN_SHOT = "open_shot"

        fun start(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, CaptureService::class.java)
                .putExtra(EXTRA_CODE, resultCode)
                .putExtra(EXTRA_DATA, data)
            ContextCompat.startForegroundService(context, intent)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var thread: HandlerThread? = null
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var done = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannel()
        val notif = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile_capture)
            .setContentTitle("Capturing screen…")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIF_ID, notif)
        }

        val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)
        if (data == null) {
            stopSelf(); return START_NOT_STICKY
        }

        val t = HandlerThread("snapski-capture").apply { start() }
        thread = t
        val handler = Handler(t.looper)
        // Give the consent dialog / QS shade time to leave the screen.
        handler.postDelayed({ capture(code, data, handler) }, 700)

        // Safety net: never linger.
        handler.postDelayed({ if (!done) finish(null) }, 6000)
        return START_NOT_STICKY
    }

    private fun capture(code: Int, data: Intent, handler: Handler) {
        try {
            val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val mp = mpm.getMediaProjection(code, data) ?: run {
                finish(null); return
            }
            projection = mp
            mp.registerCallback(object : MediaProjection.Callback() {}, handler)

            val wm = getSystemService(WINDOW_SERVICE) as WindowManager
            val (w, h) = if (Build.VERSION.SDK_INT >= 30) {
                val b = wm.currentWindowMetrics.bounds
                b.width() to b.height()
            } else {
                @Suppress("DEPRECATION")
                val dm = android.util.DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }
                dm.widthPixels to dm.heightPixels
            }
            val dpi = resources.configuration.densityDpi

            val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
            reader = r
            r.setOnImageAvailableListener({ rd ->
                if (done) return@setOnImageAvailableListener
                val image = rd.acquireLatestImage() ?: return@setOnImageAvailableListener
                done = true
                val plane = image.planes[0]
                val rowStridePx = plane.rowStride / plane.pixelStride
                val padded = Bitmap.createBitmap(rowStridePx, h, Bitmap.Config.ARGB_8888)
                padded.copyPixelsFromBuffer(plane.buffer)
                image.close()
                val bitmap = if (rowStridePx != w) {
                    Bitmap.createBitmap(padded, 0, 0, w, h)
                } else padded
                finish(bitmap)
            }, handler)

            display = mp.createVirtualDisplay(
                "snapski",
                w, h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                r.surface, null, handler,
            )
        } catch (_: Exception) {
            finish(null)
        }
    }

    private fun finish(bitmap: Bitmap?) {
        display?.release(); display = null
        projection?.stop(); projection = null
        if (bitmap == null) {
            cleanupAndStop(); return
        }
        val library = (application as SnapSkiApp).library
        scope.launch {
            val shot = library.saveCapture(bitmap)
            notifyCaptured(bitmap, shot.id)
            cleanupAndStop()
        }
    }

    private fun notifyCaptured(bitmap: Bitmap, shotId: String) {
        val open = PendingIntent.getActivity(
            this, shotId.hashCode(),
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_OPEN_SHOT, shotId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val thumb = Bitmap.createScaledBitmap(
            bitmap, 512, (512f * bitmap.height / bitmap.width).toInt(), true,
        )
        val notif = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile_capture)
            .setContentTitle("Screenshot captured")
            .setContentText("Tap to annotate")
            .setLargeIcon(thumb)
            .setStyle(NotificationCompat.BigPictureStyle().bigPicture(thumb))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(shotId.hashCode(), notif)
    }

    private fun cleanupAndStop() {
        reader?.close(); reader = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createChannel() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Screen capture", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    override fun onDestroy() {
        display?.release()
        projection?.stop()
        reader?.close()
        thread?.quitSafely()
        scope.cancel()
        super.onDestroy()
    }
}
