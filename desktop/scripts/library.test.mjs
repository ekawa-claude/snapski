// Captures live in per-day folders, but favourites and — critically — the sync
// engine identify a shot by its bare FILE NAME. If name→path resolution breaks,
// pushShots just skips the file and sync stops uploading without an error.
// That silence is why this has a test.
//
//   npm run test:library
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dayFolder, dayDir, resolveInLibrary, listLibrary } from '../src/main/library.ts'

let fails = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails++
}

const root = mkdtempSync(join(tmpdir(), 'snapski-lib-'))

// legacy flat files + a synced-in file
writeFileSync(join(root, 'Snap_2026-08-01_10-00-00.png'), 'old')
writeFileSync(join(root, 'Sync-abc123.png'), 'from phone')
writeFileSync(join(root, 'notes.txt'), 'ignore me')

// today's folder via the real helper
const today = dayDir(root)
check('dayDir creates today folder', today.endsWith(dayFolder()), today)
writeFileSync(join(today, 'Snap_new.png'), 'new')
writeFileSync(join(today, 'Rec_new.mp4'), 'video')

// an older day folder, plus a non-day folder that must be ignored
const older = join(root, '2026-08-20')
mkdirSync(older)
writeFileSync(join(older, 'Snap_old_day.png'), 'older')
const junk = join(root, 'my random folder')
mkdirSync(junk)
writeFileSync(join(junk, 'Snap_should_not_appear.png'), 'nope')

check('resolves a legacy flat file', resolveInLibrary(root, 'Snap_2026-08-01_10-00-00.png') === join(root, 'Snap_2026-08-01_10-00-00.png'))
check('resolves a synced-in file', resolveInLibrary(root, 'Sync-abc123.png') === join(root, 'Sync-abc123.png'))
check("resolves today's file", resolveInLibrary(root, 'Snap_new.png') === join(today, 'Snap_new.png'))
check('resolves an older day file', resolveInLibrary(root, 'Snap_old_day.png') === join(older, 'Snap_old_day.png'))
check('returns null for a missing file', resolveInLibrary(root, 'nope.png') === null)
check('ignores non-day folders', resolveInLibrary(root, 'Snap_should_not_appear.png') === null)

const items = await listLibrary(root)
const names = items.map((i) => i.name)
check('lists media from root and day folders', names.length === 5, names.join(', '))
check('skips non-media', !names.includes('notes.txt'))
check('skips non-day folders', !names.includes('Snap_should_not_appear.png'))
check('tags video type', items.find((i) => i.name === 'Rec_new.mp4')?.type === 'video')
check('newest first', items.every((it, i) => i === 0 || items[i - 1].mtime >= it.mtime))

rmSync(root, { recursive: true, force: true })
console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
