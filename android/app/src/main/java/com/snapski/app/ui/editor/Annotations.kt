package com.snapski.app.ui.editor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** All coordinates are in image (bitmap) space. */
sealed interface Ann {
    data class Pen(val points: List<Pair<Float, Float>>, val color: Int, val width: Float) : Ann
    data class Arrow(
        val x1: Float, val y1: Float, val x2: Float, val y2: Float,
        val color: Int, val width: Float,
    ) : Ann
    data class Box(
        val x1: Float, val y1: Float, val x2: Float, val y2: Float,
        val color: Int, val width: Float,
    ) : Ann
    data class Note(
        val x: Float, val y: Float, val text: String, val color: Int, val size: Float,
    ) : Ann
    data class Blur(val rect: Rect, val pixels: Bitmap) : Ann
}

/** Renders one annotation onto an image-space android canvas (shared by preview and flatten). */
fun Canvas.drawAnn(a: Ann) {
    when (a) {
        is Ann.Pen -> {
            if (a.points.size < 2) return
            val paint = strokePaint(a.color, a.width).apply {
                strokeJoin = Paint.Join.ROUND
            }
            val path = Path()
            path.moveTo(a.points[0].first, a.points[0].second)
            for (i in 1 until a.points.size) path.lineTo(a.points[i].first, a.points[i].second)
            drawPath(path, paint)
        }
        is Ann.Arrow -> {
            val paint = strokePaint(a.color, a.width)
            drawLine(a.x1, a.y1, a.x2, a.y2, paint)
            // arrowhead
            val angle = atan2(a.y2 - a.y1, a.x2 - a.x1)
            val len = max(a.width * 3.5f, min(24f, hypot(a.x2 - a.x1, a.y2 - a.y1) / 3f))
            val spread = 0.5f
            val head = Path().apply {
                moveTo(a.x2, a.y2)
                lineTo(
                    a.x2 - len * cos(angle - spread),
                    a.y2 - len * sin(angle - spread),
                )
                moveTo(a.x2, a.y2)
                lineTo(
                    a.x2 - len * cos(angle + spread),
                    a.y2 - len * sin(angle + spread),
                )
            }
            drawPath(head, paint)
        }
        is Ann.Box -> {
            val paint = strokePaint(a.color, a.width)
            val r = RectF(
                min(a.x1, a.x2), min(a.y1, a.y2),
                max(a.x1, a.x2), max(a.y1, a.y2),
            )
            drawRoundRect(r, a.width, a.width, paint)
        }
        is Ann.Note -> {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = a.color
                textSize = a.size
                isFakeBoldText = true
                setShadowLayer(a.size / 8f, 0f, a.size / 16f, 0x99000000.toInt())
            }
            var y = a.y
            for (line in a.text.split("\n")) {
                drawText(line, a.x, y, paint)
                y += a.size * 1.2f
            }
        }
        is Ann.Blur -> drawBitmap(a.pixels, null, a.rect, null)
    }
}

private fun strokePaint(color: Int, width: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color
    style = Paint.Style.STROKE
    strokeWidth = width
    strokeCap = Paint.Cap.ROUND
}

/** Mosaic-pixelates a region of the bitmap (used when a Blur annotation is committed). */
fun pixelate(src: Bitmap, rect: Rect, cells: Int = 18): Bitmap {
    val clamped = Rect(
        rect.left.coerceIn(0, src.width - 1),
        rect.top.coerceIn(0, src.height - 1),
        rect.right.coerceIn(1, src.width),
        rect.bottom.coerceIn(1, src.height),
    )
    val region = Bitmap.createBitmap(src, clamped.left, clamped.top, clamped.width(), clamped.height())
    val cell = max(1, max(clamped.width(), clamped.height()) / cells)
    val small = Bitmap.createScaledBitmap(
        region,
        max(1, clamped.width() / cell),
        max(1, clamped.height() / cell),
        true,
    )
    return Bitmap.createScaledBitmap(small, clamped.width(), clamped.height(), false)
}

/** Draws all annotations into a mutable copy of the bitmap. */
fun flatten(bitmap: Bitmap, annotations: List<Ann>): Bitmap {
    val out = bitmap.copy(Bitmap.Config.ARGB_8888, true)
    val canvas = Canvas(out)
    annotations.forEach { canvas.drawAnn(it) }
    return out
}
