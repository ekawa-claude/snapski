// Where captures live on disk, and how to find one again.
//
// Shots used to pile into a single flat folder. They now go into a per-day
// subfolder of the output folder, which means two things elsewhere in the app
// can no longer assume `join(outputFolder, name)`:
//
//  * the gallery, which listed the folder with a flat readdir;
//  * the sync engine, which identifies a shot by its FILE NAME (that identity is
//    shared with the phone, so it must not change) and resolved it to a path by
//    joining. A miss there is silent — pushShots just skips a file that isn't
//    where it looked — so name→path resolution goes through resolveInLibrary().
//
// Files written before this change, and shots arriving from sync, stay in the
// root; resolveInLibrary and listLibrary cover both layouts.

import { existsSync, mkdirSync, readdirSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Day folder name, e.g. `2026-08-24`. Sortable, and unique across years. */
export function dayFolder(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today's folder inside the library, created if missing. */
export function dayDir(root: string, d = new Date()): string {
  const dir = join(root, dayFolder(d))
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return root // can't create it — better a flat save than a lost capture
  }
  return dir
}

/** Day folders inside the library, newest name first. */
function dayFolders(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a))
  } catch {
    return []
  }
}

/**
 * Absolute path for a capture's file name, or null if it's gone.
 * Looks in the root first (legacy and synced-in files), then newest day first.
 */
export function resolveInLibrary(root: string, name: string): string | null {
  const flat = join(root, name)
  if (existsSync(flat)) return flat
  for (const day of dayFolders(root)) {
    const p = join(root, day, name)
    if (existsSync(p)) return p
  }
  return null
}

export interface LibraryFile {
  path: string
  name: string
  mtime: number
  type: 'image' | 'video'
}

/**
 * Every capture in the library, newest first: the root plus one level of day
 * folders. Deliberately not a full recursive walk — the library is ours, one
 * level is the whole layout, and a deep walk over a user-chosen folder (which
 * may be Pictures itself) could be enormous.
 */
export async function listLibrary(root: string): Promise<LibraryFile[]> {
  const dirs = [root, ...dayFolders(root).map((d) => join(root, d))]
  const found: LibraryFile[] = []
  const seen = new Set<string>()

  for (const dir of dirs) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names.filter((n) => /\.(png|mp4)$/i.test(n))) {
      // File names carry a timestamp, so a duplicate name across folders would
      // confuse favourites and sync, which are keyed by name. First one wins.
      if (seen.has(name)) continue
      const full = join(dir, name)
      try {
        const s = await stat(full)
        seen.add(name)
        found.push({
          path: full,
          name,
          mtime: s.mtimeMs,
          type: name.toLowerCase().endsWith('.mp4') ? 'video' : 'image'
        })
      } catch {
        // vanished between readdir and stat
      }
    }
  }

  return found.sort((a, b) => b.mtime - a.mtime)
}
