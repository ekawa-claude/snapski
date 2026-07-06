package com.snapski.app.ui.editor

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.BlurOn
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.CropSquare
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.NearMe
import androidx.compose.material.icons.filled.NorthEast
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.snapski.app.data.LibraryRepository
import com.snapski.app.data.Shot
import com.snapski.app.util.Exporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private enum class Tool { SELECT, CROP, PEN, ARROW, BOX, TEXT, BLUR }

private val palette = listOf(
    0xFFFF3B30.toInt(), 0xFFFFCC00.toInt(), 0xFF34C759.toInt(),
    0xFF7163EE.toInt(), 0xFFFFFFFF.toInt(), 0xFF000000.toInt(),
)

private data class Fit(val scale: Float, val dx: Float, val dy: Float)

private class EditorState(first: Bitmap) {
    var bitmap by mutableStateOf(first)
    var anns by mutableStateOf(listOf<Ann>())
    var undoStack by mutableStateOf(listOf<Pair<Bitmap, List<Ann>>>())
    var redoStack by mutableStateOf(listOf<Pair<Bitmap, List<Ann>>>())

    fun push() {
        undoStack = undoStack + (bitmap to anns)
        redoStack = emptyList()
    }

    fun undo() {
        val last = undoStack.lastOrNull() ?: return
        redoStack = redoStack + (bitmap to anns)
        undoStack = undoStack.dropLast(1)
        bitmap = last.first; anns = last.second
    }

    fun redo() {
        val next = redoStack.lastOrNull() ?: return
        undoStack = undoStack + (bitmap to anns)
        redoStack = redoStack.dropLast(1)
        bitmap = next.first; anns = next.second
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(
    library: LibraryRepository,
    shotId: String,
    onClose: (Shot?) -> Unit,
) {
    val shot = library.byId(shotId)
    if (shot == null) {
        onClose(null); return
    }
    val loaded by produceState<Bitmap?>(null, shot.id) {
        value = withContext(Dispatchers.IO) { decodeSampled(library.file(shot)) }
    }
    val bmp = loaded ?: return

    val state = remember(bmp) { EditorState(bmp) }
    var tool by remember { mutableStateOf(Tool.PEN) }
    var color by remember { mutableStateOf(palette[0]) }
    var widthLevel by remember { mutableStateOf(1) } // 0..2
    var viewSize by remember { mutableStateOf(IntSize.Zero) }
    var selected by remember { mutableStateOf<Int?>(null) }

    // in-progress gesture, image space
    var penPoints by remember { mutableStateOf<List<Pair<Float, Float>>>(emptyList()) }
    var dragStart by remember { mutableStateOf<Offset?>(null) }
    var dragEnd by remember { mutableStateOf<Offset?>(null) }
    var cropRect by remember { mutableStateOf<Rect?>(null) }
    var pendingTextAt by remember { mutableStateOf<Offset?>(null) }
    var editingNote by remember { mutableStateOf<Int?>(null) }
    var textInput by remember { mutableStateOf("") }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // All of these read snapshot state, so gesture handlers get fresh values even
    // though pointerInput only restarts when its keys change.
    fun fit(): Fit {
        val vs = viewSize
        if (vs == IntSize.Zero) return Fit(1f, 0f, 0f)
        val s = min(
            vs.width / state.bitmap.width.toFloat(),
            vs.height / state.bitmap.height.toFloat(),
        )
        return Fit(
            s,
            (vs.width - state.bitmap.width * s) / 2f,
            (vs.height - state.bitmap.height * s) / 2f,
        )
    }

    fun toImage(p: Offset): Offset {
        val f = fit()
        return Offset(
            ((p.x - f.dx) / f.scale).coerceIn(0f, state.bitmap.width.toFloat()),
            ((p.y - f.dy) / f.scale).coerceIn(0f, state.bitmap.height.toFloat()),
        )
    }

    fun strokeWidthFor(level: Int): Float {
        val maxDim = max(state.bitmap.width, state.bitmap.height).toFloat()
        return maxDim / 300f * listOf(1f, 2f, 3.5f)[level]
    }

    fun textSizeFor(level: Int): Float {
        val maxDim = max(state.bitmap.width, state.bitmap.height).toFloat()
        return maxDim / 36f * listOf(0.75f, 1f, 1.5f)[level]
    }

    fun strokeWidthNow() = strokeWidthFor(widthLevel)
    fun textSizeNow() = textSizeFor(widthLevel)

    /** Closest S/M/L level for an existing annotation, for highlighting in the size row. */
    fun levelOf(ann: Ann): Int? {
        val candidates = when (ann) {
            is Ann.Note -> (0..2).map { textSizeFor(it) to ann.size }
            is Ann.Blur -> return null
            is Ann.Pen -> (0..2).map { strokeWidthFor(it) to ann.width }
            is Ann.Arrow -> (0..2).map { strokeWidthFor(it) to ann.width }
            is Ann.Box -> (0..2).map { strokeWidthFor(it) to ann.width }
        }
        return candidates.withIndex().minByOrNull { (_, p) -> abs(p.first - p.second) }?.index
    }

    fun dragRect(): Rect? {
        val s = dragStart ?: return null
        val e = dragEnd ?: return null
        val r = Rect(
            min(s.x, e.x).toInt(), min(s.y, e.y).toInt(),
            max(s.x, e.x).toInt(), max(s.y, e.y).toInt(),
        )
        return if (r.width() > 4 && r.height() > 4) r else null
    }

    fun commitDrag() {
        val s = dragStart
        val e = dragEnd
        when (tool) {
            Tool.PEN -> if (penPoints.size > 1) {
                state.push()
                state.anns = state.anns + Ann.Pen(penPoints, color, strokeWidthNow())
            }
            Tool.ARROW -> if (s != null && e != null &&
                (abs(e.x - s.x) > 8 || abs(e.y - s.y) > 8)
            ) {
                state.push()
                state.anns = state.anns + Ann.Arrow(s.x, s.y, e.x, e.y, color, strokeWidthNow())
            }
            Tool.BOX -> dragRect()?.let { r ->
                state.push()
                state.anns = state.anns + Ann.Box(
                    r.left.toFloat(), r.top.toFloat(),
                    r.right.toFloat(), r.bottom.toFloat(), color, strokeWidthNow(),
                )
            }
            Tool.BLUR -> dragRect()?.let { r ->
                state.push()
                // pixelate against the current composition so already-drawn marks get hidden too
                val basis = flatten(state.bitmap, state.anns)
                state.anns = state.anns + Ann.Blur(r, pixelate(basis, r))
            }
            Tool.CROP -> cropRect = dragRect()
            Tool.TEXT, Tool.SELECT -> {}
        }
        penPoints = emptyList(); dragStart = null; dragEnd = null
    }

    fun switchTool(t: Tool) {
        tool = t
        selected = null
        if (t == Tool.CROP) cropRect = null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = { onClose(null) }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    val sel = selected
                    if (sel != null && state.anns.getOrNull(sel) is Ann.Note) {
                        IconButton(onClick = {
                            textInput = (state.anns[sel] as Ann.Note).text
                            editingNote = sel
                        }) { Icon(Icons.Default.Edit, contentDescription = "Edit text") }
                    }
                    if (sel != null && sel < state.anns.size) {
                        IconButton(onClick = {
                            state.push()
                            state.anns = state.anns.filterIndexed { i, _ -> i != sel }
                            selected = null
                        }) {
                            Icon(
                                Icons.Default.Delete,
                                tint = MaterialTheme.colorScheme.error,
                                contentDescription = "Delete selected",
                            )
                        }
                    }
                    IconButton(
                        onClick = { state.undo(); selected = null },
                        enabled = state.undoStack.isNotEmpty(),
                    ) { Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "Undo") }
                    IconButton(
                        onClick = { state.redo(); selected = null },
                        enabled = state.redoStack.isNotEmpty(),
                    ) { Icon(Icons.AutoMirrored.Filled.Redo, contentDescription = "Redo") }
                    IconButton(onClick = {
                        scope.launch(Dispatchers.IO) {
                            val out = flatten(state.bitmap, state.anns)
                            val f = File(context.cacheDir, "shared").apply { mkdirs() }
                                .resolve("snapski_share.png")
                            f.outputStream().use { out.compress(Bitmap.CompressFormat.PNG, 100, it) }
                            withContext(Dispatchers.Main) { Exporter.share(context, listOf(f)) }
                        }
                    }) { Icon(Icons.Default.Share, contentDescription = "Share") }
                    IconButton(onClick = {
                        scope.launch {
                            val out = withContext(Dispatchers.Default) {
                                flatten(state.bitmap, state.anns)
                            }
                            onClose(library.saveEdited(out, shot))
                        }
                    }) {
                        Icon(
                            Icons.Default.Check,
                            tint = MaterialTheme.colorScheme.primary,
                            contentDescription = "Save",
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        bottomBar = {
            Column(Modifier.background(MaterialTheme.colorScheme.surface)) {
                if (cropRect != null) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { cropRect = null }) { Text("Cancel") }
                        Button(onClick = {
                            val r = cropRect ?: return@Button
                            state.push()
                            val flat = flatten(state.bitmap, state.anns)
                            state.bitmap = Bitmap.createBitmap(
                                flat,
                                r.left.coerceIn(0, flat.width - 1),
                                r.top.coerceIn(0, flat.height - 1),
                                r.width().coerceAtMost(flat.width - r.left),
                                r.height().coerceAtMost(flat.height - r.top),
                            )
                            state.anns = emptyList()
                            cropRect = null
                        }) { Text("Apply crop") }
                    }
                }
                // Style row: picks the style for new marks, or restyles the selection in Move mode.
                val selAnn = selected?.let { state.anns.getOrNull(it) }
                val editingSelection = tool == Tool.SELECT && selAnn != null && selAnn !is Ann.Blur
                if (tool != Tool.CROP && (tool != Tool.SELECT || editingSelection)) {
                    val shownColor = if (editingSelection) selAnn?.annColor else color
                    val shownLevel = if (editingSelection) selAnn?.let { levelOf(it) } else widthLevel
                    Row(
                        Modifier.fillMaxWidth().padding(top = 8.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        palette.forEach { c ->
                            Box(
                                Modifier
                                    .padding(horizontal = 6.dp)
                                    .size(if (c == shownColor) 30.dp else 24.dp)
                                    .clip(CircleShape)
                                    .background(Color(c))
                                    .border(
                                        if (c == shownColor) 2.dp else 1.dp,
                                        if (c == shownColor) MaterialTheme.colorScheme.primary
                                        else Color.White.copy(alpha = 0.4f),
                                        CircleShape,
                                    )
                                    .clickable {
                                        color = c
                                        val i = selected
                                        if (editingSelection && i != null) {
                                            state.push()
                                            state.anns = state.anns.toMutableList().also { l ->
                                                l[i] = l[i].recolored(c)
                                            }
                                        }
                                    },
                            )
                        }
                        listOf("S", "M", "L").forEachIndexed { i, label ->
                            Box(
                                Modifier
                                    .padding(start = if (i == 0) 16.dp else 6.dp)
                                    .size(30.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(
                                        if (shownLevel == i) MaterialTheme.colorScheme.primary
                                        else MaterialTheme.colorScheme.background
                                    )
                                    .clickable {
                                        widthLevel = i
                                        val idx = selected
                                        if (editingSelection && idx != null) {
                                            state.push()
                                            state.anns = state.anns.toMutableList().also { l ->
                                                l[idx] = l[idx].resized(
                                                    strokeWidthFor(i), textSizeFor(i),
                                                )
                                            }
                                        }
                                    },
                                contentAlignment = Alignment.Center,
                            ) { Text(label, style = MaterialTheme.typography.labelMedium) }
                        }
                    }
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    ToolButton(Icons.Default.NearMe, "Move", tool == Tool.SELECT) { switchTool(Tool.SELECT) }
                    ToolButton(Icons.Default.Edit, "Pen", tool == Tool.PEN) { switchTool(Tool.PEN) }
                    ToolButton(Icons.Default.NorthEast, "Arrow", tool == Tool.ARROW) { switchTool(Tool.ARROW) }
                    ToolButton(Icons.Default.CropSquare, "Box", tool == Tool.BOX) { switchTool(Tool.BOX) }
                    ToolButton(Icons.Default.TextFields, "Text", tool == Tool.TEXT) { switchTool(Tool.TEXT) }
                    ToolButton(Icons.Default.BlurOn, "Blur", tool == Tool.BLUR) { switchTool(Tool.BLUR) }
                    ToolButton(Icons.Default.Crop, "Crop", tool == Tool.CROP) { switchTool(Tool.CROP) }
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Canvas(
                Modifier
                    .fillMaxSize()
                    .onSizeChanged { viewSize = it }
                    .pointerInput(tool, state.bitmap) {
                        when (tool) {
                            Tool.TEXT -> detectTapGestures { pos ->
                                val p = toImage(pos)
                                val slop = 24f / fit().scale
                                val noteIdx = state.anns.indexOfLast {
                                    it is Ann.Note && it.hit(p.x, p.y, slop)
                                }
                                if (noteIdx >= 0) {
                                    textInput = (state.anns[noteIdx] as Ann.Note).text
                                    editingNote = noteIdx
                                } else {
                                    textInput = ""
                                    pendingTextAt = p
                                }
                            }
                            Tool.SELECT -> detectTapGestures { pos ->
                                val p = toImage(pos)
                                val slop = 24f / fit().scale
                                val idx = state.anns.indexOfLast { it.hit(p.x, p.y, slop) }
                                selected = if (idx >= 0) idx else null
                            }
                            else -> detectDragGestures(
                                onDragStart = { pos ->
                                    val p = toImage(pos)
                                    dragStart = p; dragEnd = p
                                    if (tool == Tool.PEN) penPoints = listOf(p.x to p.y)
                                    if (tool == Tool.CROP) cropRect = null
                                },
                                onDrag = { change, _ ->
                                    val p = toImage(change.position)
                                    dragEnd = p
                                    if (tool == Tool.PEN) penPoints = penPoints + (p.x to p.y)
                                },
                                onDragEnd = { commitDrag() },
                                onDragCancel = {
                                    penPoints = emptyList(); dragStart = null; dragEnd = null
                                },
                            )
                        }
                    }
                    .pointerInput(tool, state.bitmap) {
                        if (tool != Tool.SELECT && tool != Tool.TEXT) {
                            // A plain tap with any drawing tool grabs an existing mark
                            // and jumps straight into Move mode.
                            detectTapGestures { pos ->
                                val p = toImage(pos)
                                val slop = 24f / fit().scale
                                val idx = state.anns.indexOfLast { it.hit(p.x, p.y, slop) }
                                if (idx >= 0) {
                                    selected = idx
                                    tool = Tool.SELECT
                                }
                            }
                        } else if (tool == Tool.SELECT) {
                            var pushed = false
                            detectDragGestures(
                                onDragStart = { pos ->
                                    val p = toImage(pos)
                                    val slop = 24f / fit().scale
                                    val idx = state.anns.indexOfLast { it.hit(p.x, p.y, slop) }
                                    selected = if (idx >= 0) idx else null
                                    pushed = false
                                },
                                onDrag = { change, amount ->
                                    val i = selected ?: return@detectDragGestures
                                    if (i >= state.anns.size) return@detectDragGestures
                                    if (!pushed) {
                                        state.push(); pushed = true
                                    }
                                    change.consume()
                                    val s = fit().scale
                                    state.anns = state.anns.toMutableList().also { list ->
                                        list[i] = list[i].translated(amount.x / s, amount.y / s)
                                    }
                                },
                            )
                        }
                    },
            ) {
                drawIntoCanvas { canvas ->
                    val f = fit()
                    val c = canvas.nativeCanvas
                    c.save()
                    c.translate(f.dx, f.dy)
                    c.scale(f.scale, f.scale)
                    c.drawBitmap(state.bitmap, null,
                        RectF(0f, 0f, state.bitmap.width.toFloat(), state.bitmap.height.toFloat()),
                        null)
                    state.anns.forEach { c.drawAnn(it) }
                    // live draft
                    val s = dragStart
                    val e = dragEnd
                    when (tool) {
                        Tool.PEN -> if (penPoints.size > 1)
                            c.drawAnn(Ann.Pen(penPoints, color, strokeWidthNow()))
                        Tool.ARROW -> if (s != null && e != null)
                            c.drawAnn(Ann.Arrow(s.x, s.y, e.x, e.y, color, strokeWidthNow()))
                        Tool.BOX -> if (s != null && e != null)
                            c.drawAnn(Ann.Box(s.x, s.y, e.x, e.y, color, strokeWidthNow()))
                        else -> {}
                    }
                    // selection outline
                    val sel = selected
                    if (tool == Tool.SELECT && sel != null && sel < state.anns.size) {
                        val b = state.anns[sel].bounds()
                        b.inset(-8f / f.scale, -8f / f.scale)
                        val paint = android.graphics.Paint().apply {
                            style = android.graphics.Paint.Style.STROKE
                            this.strokeWidth = 3f / f.scale
                            this.color = 0xFF7163EE.toInt()
                            pathEffect = android.graphics.DashPathEffect(
                                floatArrayOf(14f / f.scale, 9f / f.scale), 0f)
                        }
                        c.drawRoundRect(b, 8f / f.scale, 8f / f.scale, paint)
                    }
                    if (tool == Tool.BLUR && s != null && e != null) {
                        val paint = android.graphics.Paint().apply {
                            style = android.graphics.Paint.Style.STROKE
                            this.strokeWidth = 3f / f.scale
                            this.color = android.graphics.Color.WHITE
                            pathEffect = android.graphics.DashPathEffect(
                                floatArrayOf(12f / f.scale, 8f / f.scale), 0f)
                        }
                        c.drawRect(min(s.x, e.x), min(s.y, e.y), max(s.x, e.x), max(s.y, e.y), paint)
                    }
                    // crop overlay: darken everything outside the chosen rect
                    val cr: Rect? = cropRect ?: if (tool == Tool.CROP && s != null && e != null) Rect(
                        min(s.x, e.x).toInt(), min(s.y, e.y).toInt(),
                        max(s.x, e.x).toInt(), max(s.y, e.y).toInt(),
                    ) else null
                    if (cr != null) {
                        val dim = android.graphics.Paint().apply { this.color = 0x99000000.toInt() }
                        val w = state.bitmap.width.toFloat()
                        val h = state.bitmap.height.toFloat()
                        c.drawRect(0f, 0f, w, cr.top.toFloat(), dim)
                        c.drawRect(0f, cr.bottom.toFloat(), w, h, dim)
                        c.drawRect(0f, cr.top.toFloat(), cr.left.toFloat(), cr.bottom.toFloat(), dim)
                        c.drawRect(cr.right.toFloat(), cr.top.toFloat(), w, cr.bottom.toFloat(), dim)
                        val border = android.graphics.Paint().apply {
                            style = android.graphics.Paint.Style.STROKE
                            this.strokeWidth = 3f / f.scale
                            this.color = android.graphics.Color.WHITE
                        }
                        c.drawRect(cr, border)
                    }
                    c.restore()
                }
            }
        }
    }

    val textAt = pendingTextAt
    val noteIdx = editingNote
    if (textAt != null || noteIdx != null) {
        val dismiss = { pendingTextAt = null; editingNote = null }
        AlertDialog(
            onDismissRequest = dismiss,
            title = { Text(if (noteIdx != null) "Edit text" else "Add text") },
            text = {
                OutlinedTextField(
                    value = textInput,
                    onValueChange = { textInput = it },
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (textInput.isNotBlank()) {
                        if (noteIdx != null && noteIdx < state.anns.size) {
                            val old = state.anns[noteIdx]
                            if (old is Ann.Note) {
                                state.push()
                                state.anns = state.anns.toMutableList().also { l ->
                                    l[noteIdx] = old.copy(text = textInput.trim())
                                }
                            }
                        } else if (textAt != null) {
                            state.push()
                            val ts = textSizeNow()
                            state.anns = state.anns + Ann.Note(
                                textAt.x, textAt.y + ts, textInput.trim(), color, ts,
                            )
                        }
                    }
                    dismiss()
                }) { Text(if (noteIdx != null) "Save" else "Add") }
            },
            dismissButton = {
                TextButton(onClick = dismiss) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun ToolButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Column(
        Modifier
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(
                if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.25f)
                else Color.Transparent
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = if (selected) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurface,
        )
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
        )
    }
}

private fun decodeSampled(file: File, maxDim: Int = 4096): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0) return null
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > maxDim) sample *= 2
    val opts = BitmapFactory.Options().apply {
        inSampleSize = sample
        inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeFile(file.absolutePath, opts)
}
