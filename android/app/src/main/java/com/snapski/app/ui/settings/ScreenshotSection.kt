package com.snapski.app.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.snapski.app.data.ScreenshotImporter
import kotlinx.coroutines.launch

/** Settings row: opt-in auto-import of new system screenshots. */
@Composable
fun ScreenshotSection(importer: ScreenshotImporter) {
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(importer.enabled && importer.hasPermission()) }

    fun enable() {
        importer.setEnabled(true)
        on = true
        scope.launch { importer.importNew() }
    }

    val permission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        // Android 14 "selected photos" reports false but grants partial access.
        if (importer.hasPermission()) enable()
    }

    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("Автоимпорт скриншотов", style = MaterialTheme.typography.titleMedium)
            Text(
                if (on) "Новые скриншоты подтягиваются при открытии приложения"
                else "Выключен — скриншоты добавляются вручную",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
        }
        Switch(
            checked = on,
            onCheckedChange = { want ->
                when {
                    !want -> { importer.setEnabled(false); on = false }
                    importer.hasPermission() -> enable()
                    else -> permission.launch(importer.permissionToRequest())
                }
            },
        )
    }
}
