import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { AppSettings } from '../shared/types'
import { DEFAULT_HOTKEY, DEFAULT_FULLSCREEN_HOTKEY } from '../shared/types'

let cache: AppSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaults(): AppSettings {
  return {
    outputFolder: join(app.getPath('pictures'), 'SnapSki'),
    hotkeys: { capture: DEFAULT_HOTKEY, fullscreen: DEFAULT_FULLSCREEN_HOTKEY },
    copyToClipboard: true,
    saveToFolder: true,
    captureMode: 'screenshot',
    autoLaunch: false
  }
}

export function loadSettings(): AppSettings {
  if (cache) return cache
  const base = defaults()
  let resolved: AppSettings = base
  try {
    if (existsSync(settingsPath())) {
      const parsed = JSON.parse(readFileSync(settingsPath(), 'utf-8'))
      resolved = {
        ...base,
        ...parsed,
        hotkeys: { ...base.hotkeys, ...(parsed.hotkeys ?? {}) }
      }
    }
  } catch {
    resolved = base
  }
  cache = resolved
  ensureOutputFolder(resolved.outputFolder)
  return resolved
}

export function saveSettings(next: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  cache = {
    ...current,
    ...next,
    hotkeys: { ...current.hotkeys, ...(next.hotkeys ?? {}) }
  }
  try {
    writeFileSync(settingsPath(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to persist settings:', err)
  }
  ensureOutputFolder(cache.outputFolder)
  return cache
}

export function ensureOutputFolder(folder: string): void {
  try {
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true })
  } catch (err) {
    console.error('Failed to create output folder:', err)
  }
}
