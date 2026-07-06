package com.snapski.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val SnapBg = Color(0xFF14161A)
val SnapSurface = Color(0xFF1D2026)
val SnapAccent = Color(0xFF4F8CFF)

private val scheme = darkColorScheme(
    primary = SnapAccent,
    background = SnapBg,
    surface = SnapSurface,
    surfaceContainer = SnapSurface,
    onPrimary = Color.White,
    onBackground = Color(0xFFE7EAF0),
    onSurface = Color(0xFFE7EAF0),
)

@Composable
fun SnapSkiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}
