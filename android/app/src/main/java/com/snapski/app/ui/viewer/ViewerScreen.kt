package com.snapski.app.ui.viewer

import android.widget.Toast
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.compose.AsyncImage
import com.snapski.app.data.LibraryRepository
import com.snapski.app.data.Shot
import com.snapski.app.util.Exporter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewerScreen(
    library: LibraryRepository,
    startId: String,
    onEdit: (Shot) -> Unit,
    onBack: () -> Unit,
) {
    val shots by library.shots.collectAsState()
    val sorted = remember(shots) { shots.sortedByDescending { it.createdAt } }
    if (sorted.isEmpty()) {
        onBack(); return
    }
    val startIndex = sorted.indexOfFirst { it.id == startId }.coerceAtLeast(0)
    val pager = rememberPagerState(initialPage = startIndex) { sorted.size }
    val current = sorted[pager.currentPage.coerceIn(sorted.indices)]
    val context = LocalContext.current
    var chromeVisible by remember { mutableStateOf(true) }

    Scaffold(
        topBar = {
            if (chromeVisible) TopAppBar(
                title = { Text("${pager.currentPage + 1} / ${sorted.size}") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { library.toggleFavorite(current.id) }) {
                        Icon(
                            if (current.favorite) Icons.Filled.Star else Icons.Outlined.Star,
                            tint = if (current.favorite) Color(0xFFFFC93C)
                            else MaterialTheme.colorScheme.onSurface,
                            contentDescription = "Favorite",
                        )
                    }
                    IconButton(onClick = { onEdit(current) }) {
                        Icon(Icons.Default.Edit, contentDescription = "Edit")
                    }
                    IconButton(onClick = { Exporter.share(context, listOf(library.file(current))) }) {
                        Icon(Icons.Default.Share, contentDescription = "Share")
                    }
                    IconButton(onClick = {
                        val ok = Exporter.saveToGallery(context, current, library.file(current))
                        Toast.makeText(
                            context,
                            if (ok) "Saved to Pictures/SnapSki" else "Save failed",
                            Toast.LENGTH_SHORT,
                        ).show()
                    }) { Icon(Icons.Default.SaveAlt, contentDescription = "Save to gallery") }
                    IconButton(onClick = {
                        library.delete(setOf(current.id))
                        if (sorted.size <= 1) onBack()
                    }) { Icon(Icons.Default.Delete, contentDescription = "Delete") }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Black.copy(alpha = 0.4f),
                ),
            )
        },
        containerColor = Color.Black,
    ) { _ ->
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            val shot = sorted[page]
            var scale by remember(shot.id) { mutableFloatStateOf(1f) }
            var offsetX by remember(shot.id) { mutableFloatStateOf(0f) }
            var offsetY by remember(shot.id) { mutableFloatStateOf(0f) }

            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(shot.id) {
                        detectTapGestures(
                            onTap = { chromeVisible = !chromeVisible },
                            onDoubleTap = {
                                if (scale > 1f) {
                                    scale = 1f; offsetX = 0f; offsetY = 0f
                                } else scale = 2.5f
                            },
                        )
                    }
                    .pointerInput(shot.id) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 6f)
                            if (scale > 1f) {
                                offsetX += pan.x
                                offsetY += pan.y
                            } else {
                                offsetX = 0f; offsetY = 0f
                            }
                        }
                    },
            ) {
                AsyncImage(
                    model = library.file(shot),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationX = offsetX
                            translationY = offsetY
                        },
                )
            }
        }
    }
}
