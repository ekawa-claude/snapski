package com.snapski.app.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.snapski.app.data.ScreenshotImporter
import com.snapski.app.data.sync.Pairing
import com.snapski.app.data.sync.SyncEngine
import com.snapski.app.data.sync.SyncPrefs
import com.snapski.app.data.sync.SyncScheduler
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    prefs: SyncPrefs,
    engine: SyncEngine,
    importer: ScreenshotImporter,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val status by engine.status.collectAsState()
    var paired by remember { mutableStateOf(prefs.isPaired) }
    var enabled by remember { mutableStateOf(prefs.enabled) }
    var manualCode by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    fun applyPairing(raw: String) {
        val p = Pairing.parse(raw)
        if (p == null) {
            error = "Не похоже на код синка SnapSki"
            return
        }
        prefs.applyPairing(p)
        paired = true
        enabled = true
        error = null
        engine.refreshStatus()
        SyncScheduler.syncNow(context)
    }

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { applyPairing(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Настройки") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Spacer(Modifier.height(4.dp))

            ScreenshotSection(importer)

            HorizontalDivider()

            if (!paired) {
                Text(
                    "Подключите устройство к своей группе, чтобы избранное и выбранные " +
                        "скриншоты синхронизировались между телефоном и ПК.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                )
                Button(
                    onClick = {
                        scanner.launch(
                            ScanOptions()
                                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                                .setPrompt("Наведите на QR-код с ПК")
                                .setBeepEnabled(false)
                                .setOrientationLocked(false),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                    Spacer(Modifier.height(0.dp))
                    Text("  Сканировать QR")
                }
                OutlinedTextField(
                    value = manualCode,
                    onValueChange = { manualCode = it },
                    label = { Text("…или вставьте код (snapski://…)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(
                    onClick = { applyPairing(manualCode) },
                    enabled = manualCode.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Присоединиться по коду") }
            } else {
                // Master toggle
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Синхронизация", style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (enabled) "Включена" else "Выключена — очередь стоит",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                        )
                    }
                    Switch(
                        checked = enabled,
                        onCheckedChange = {
                            enabled = it
                            prefs.enabled = it
                            engine.refreshStatus()
                            if (it) SyncScheduler.syncNow(context)
                        },
                    )
                }

                HorizontalDivider()

                StatRow("Последний синк", formatTime(status.lastSyncAt))
                StatRow("В очереди", "${status.queued}")
                StatRow(
                    "На сервере",
                    if (status.serverQuota > 0)
                        "${formatBytes(status.serverUsed)} из ${formatBytes(status.serverQuota)}"
                    else formatBytes(status.serverUsed),
                )
                prefs.hubUrl?.let {
                    StatRow("Сервер", it.removePrefix("https://").removePrefix("http://"))
                }

                if (status.storageFull) Text(
                    "⚠️ Хранилище группы заполнено — новые скриншоты не заливаются.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                status.lastError?.let {
                    Text(
                        "Ошибка синка: $it",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                HorizontalDivider()

                Button(
                    onClick = { SyncScheduler.syncNow(context) },
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (status.running) "Синхронизирую…" else "Синхронизировать сейчас") }

                OutlinedButton(
                    onClick = {
                        prefs.unpair()
                        paired = false
                        enabled = false
                        engine.refreshStatus()
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Отвязать устройство") }
            }

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun formatTime(ts: Long): String =
    if (ts <= 0) "—"
    else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(ts))

private fun formatBytes(b: Long): String = when {
    b <= 0 -> "0 МБ"
    b < 1024 * 1024 -> "${b / 1024} КБ"
    b < 1024L * 1024 * 1024 -> "%.1f МБ".format(b / (1024.0 * 1024))
    else -> "%.2f ГБ".format(b / (1024.0 * 1024 * 1024))
}
