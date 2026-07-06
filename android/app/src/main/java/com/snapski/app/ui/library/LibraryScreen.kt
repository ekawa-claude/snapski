package com.snapski.app.ui.library

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.snapski.app.data.LibraryRepository
import com.snapski.app.data.Shot
import com.snapski.app.util.Exporter
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    library: LibraryRepository,
    onOpen: (Shot) -> Unit,
) {
    val shots by library.shots.collectAsState()
    val sorted = remember(shots) { shots.sortedByDescending { it.createdAt } }
    var selection by remember { mutableStateOf<Set<String>>(emptySet()) }
    var favoritesOnly by remember { mutableStateOf(false) }
    val selecting = selection.isNotEmpty()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(20)
    ) { uris ->
        if (uris.isNotEmpty()) scope.launch { library.importUris(uris, source = "import") }
    }

    val visible = if (favoritesOnly) sorted.filter { it.favorite } else sorted

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(if (selecting) "${selection.size} selected" else "SnapSki")
                },
                navigationIcon = {
                    if (selecting) IconButton(onClick = { selection = emptySet() }) {
                        Icon(Icons.Default.Close, contentDescription = "Cancel")
                    }
                },
                actions = {
                    if (selecting) {
                        IconButton(onClick = {
                            val files = shots.filter { it.id in selection }.map { library.file(it) }
                            Exporter.share(context, files)
                        }) { Icon(Icons.Default.Share, contentDescription = "Share") }
                        IconButton(onClick = {
                            library.delete(selection)
                            selection = emptySet()
                        }) { Icon(Icons.Default.Delete, contentDescription = "Delete") }
                    } else {
                        IconButton(onClick = { favoritesOnly = !favoritesOnly }) {
                            Icon(
                                if (favoritesOnly) Icons.Filled.Star else Icons.Outlined.Star,
                                tint = if (favoritesOnly) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface,
                                contentDescription = "Favorites",
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        floatingActionButton = {
            if (!selecting) FloatingActionButton(onClick = {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }) { Icon(Icons.Default.Add, contentDescription = "Import") }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (visible.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        if (favoritesOnly) "No favorites yet"
                        else "Library is empty",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        if (favoritesOnly) "Star an image to see it here"
                        else "Share a screenshot to SnapSki\nor import from the gallery (+)",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                    )
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(110.dp),
                contentPadding = PaddingValues(
                    start = 8.dp, end = 8.dp,
                    top = padding.calculateTopPadding() + 4.dp, bottom = 88.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(visible, key = { it.id }) { shot ->
                    val selected = shot.id in selection
                    Box(
                        Modifier
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .then(
                                if (selected) Modifier.border(
                                    2.dp, MaterialTheme.colorScheme.primary,
                                    RoundedCornerShape(10.dp),
                                ) else Modifier
                            )
                            .combinedClickable(
                                onClick = {
                                    if (selecting) {
                                        selection =
                                            if (selected) selection - shot.id else selection + shot.id
                                    } else onOpen(shot)
                                },
                                onLongClick = { selection = selection + shot.id },
                            ),
                    ) {
                        AsyncImage(
                            model = library.file(shot),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                        if (shot.favorite) Icon(
                            Icons.Filled.Star,
                            contentDescription = null,
                            tint = Color(0xFFFFC93C),
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(4.dp)
                                .size(18.dp),
                        )
                        if (selected) Icon(
                            Icons.Filled.CheckCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(4.dp)
                                .size(20.dp)
                                .background(Color.Black.copy(alpha = 0.5f), CircleShape),
                        )
                    }
                }
            }
        }
    }
}
