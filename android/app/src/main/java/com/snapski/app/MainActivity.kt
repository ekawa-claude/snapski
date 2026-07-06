package com.snapski.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.snapski.app.capture.CaptureService
import com.snapski.app.data.sync.SyncScheduler
import com.snapski.app.ui.editor.EditorScreen
import com.snapski.app.ui.library.LibraryScreen
import com.snapski.app.ui.settings.SettingsScreen
import com.snapski.app.ui.theme.SnapSkiTheme
import com.snapski.app.ui.viewer.ViewerScreen

class MainActivity : ComponentActivity() {

    private var pendingShare by mutableStateOf<List<Uri>?>(null)
    private var pendingOpenShot by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        extractShared(intent)

        val library = (application as SnapSkiApp).library
        setContent {
            SnapSkiTheme {
                val nav = rememberNavController()

                LaunchedEffect(pendingOpenShot) {
                    val id = pendingOpenShot ?: return@LaunchedEffect
                    pendingOpenShot = null
                    if (library.byId(id) != null) nav.navigate("editor/$id")
                }

                LaunchedEffect(pendingShare) {
                    val uris = pendingShare ?: return@LaunchedEffect
                    pendingShare = null
                    val imported = library.importUris(uris)
                    when {
                        imported.size == 1 -> nav.navigate("editor/${imported[0].id}")
                        imported.size > 1 -> nav.navigate("library") {
                            popUpTo("library") { inclusive = true }
                        }
                    }
                }

                NavHost(navController = nav, startDestination = "library") {
                    composable("library") {
                        LibraryScreen(
                            library = library,
                            onOpen = { nav.navigate("viewer/${it.id}") },
                            onSettings = { nav.navigate("settings") },
                        )
                    }
                    composable("settings") {
                        val app = application as SnapSkiApp
                        SettingsScreen(
                            prefs = app.syncPrefs,
                            engine = app.syncEngine,
                            onBack = { nav.popBackStack() },
                        )
                    }
                    composable("viewer/{id}") { entry ->
                        ViewerScreen(
                            library = library,
                            startId = entry.arguments?.getString("id") ?: return@composable,
                            onEdit = { nav.navigate("editor/${it.id}") },
                            onBack = { nav.popBackStack() },
                        )
                    }
                    composable("editor/{id}") { entry ->
                        EditorScreen(
                            library = library,
                            shotId = entry.arguments?.getString("id") ?: return@composable,
                            onClose = { saved ->
                                if (saved != null) {
                                    nav.navigate("viewer/${saved.id}") {
                                        popUpTo("library")
                                    }
                                } else nav.popBackStack()
                            },
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Foreground pull: pick up anything from other devices.
        SyncScheduler.syncNow(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        extractShared(intent)
    }

    private fun extractShared(intent: Intent?) {
        intent ?: return
        intent.getStringExtra(CaptureService.EXTRA_OPEN_SHOT)?.let {
            pendingOpenShot = it
            intent.removeExtra(CaptureService.EXTRA_OPEN_SHOT)
            return
        }
        @Suppress("DEPRECATION")
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE ->
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            else -> emptyList()
        }
        if (uris.isNotEmpty()) pendingShare = uris
    }
}
