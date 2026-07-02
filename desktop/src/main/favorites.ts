import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

// Favorites are keyed by file name (not full path) so they survive the user
// moving/re-choosing the output folder with the same files inside.
let cache: Set<string> | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'favorites.json')
}

function load(): Set<string> {
  if (cache) return cache
  try {
    if (existsSync(storePath())) {
      const parsed = JSON.parse(readFileSync(storePath(), 'utf-8'))
      if (Array.isArray(parsed)) {
        cache = new Set(parsed.filter((x) => typeof x === 'string'))
        return cache
      }
    }
  } catch {
    // Corrupt store — start fresh.
  }
  cache = new Set()
  return cache
}

function persist(): void {
  try {
    writeFileSync(storePath(), JSON.stringify([...load()], null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to persist favorites:', err)
  }
}

export function isFavorite(name: string): boolean {
  return load().has(name)
}

export function setFavorite(name: string, fav: boolean): void {
  const s = load()
  if (fav) s.add(name)
  else s.delete(name)
  persist()
}
