package com.snapski.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Ported from desktop/src/renderer/src/index.css (shadcn HSL variables)
val SnapBg = Color(0xFF09090B)        // --background: 240 10% 4%
val SnapSurface = Color(0xFF111114)   // --card: 240 8% 7%
val SnapSecondary = Color(0xFF222226) // --secondary: 240 5% 14%
val SnapAccent = Color(0xFF7163EE)    // --primary: 246 80% 66%
val SnapMuted = Color(0xFF949499)     // --muted-foreground: 240 5% 60%
val SnapBorder = Color(0xFF26262B)    // --border: 240 6% 16%
val SnapDestructive = Color(0xFFDF2C2C) // --destructive: 0 72% 51%

private val scheme = darkColorScheme(
    primary = SnapAccent,
    background = SnapBg,
    surface = SnapSurface,
    surfaceContainer = SnapSurface,
    surfaceVariant = SnapSecondary,
    secondaryContainer = SnapSecondary,
    outline = SnapBorder,
    error = SnapDestructive,
    onPrimary = Color.White,
    onBackground = Color(0xFFFAFAFA),
    onSurface = Color(0xFFFAFAFA),
    onSurfaceVariant = SnapMuted,
)

@Composable
fun SnapSkiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}
