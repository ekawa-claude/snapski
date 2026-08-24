import { Trash2, HardDriveDownload, ImageOff } from 'lucide-react'
import type { ShotSummary } from '../shared/shots-db'

/** Relative age, so a strip of thumbnails reads as a timeline. */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

interface Props {
  shots: ShotSummary[]
  activeId: string | null
  onPick: (id: string) => void
  onDelete: (id: string) => void
  onClear: () => void
}

/**
 * Recent captures along the bottom of the editor. Everything SnapSki grabs lands
 * here, including shots dismissed straight from the toast — that's the point:
 * closing a toast should not lose a screenshot.
 */
export function ShotStrip({ shots, activeId, onPick, onDelete, onClear }: Props): JSX.Element {
  return (
    <div className="flex h-[124px] shrink-0 flex-col border-t border-border/70 bg-card/40">
      <div className="flex items-center gap-2 px-4 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent captures
        </span>
        <span className="text-[11px] text-muted-foreground/70">{shots.length}</span>
        {shots.length > 0 && (
          <button
            onClick={onClear}
            className="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-destructive"
          >
            Clear history
          </button>
        )}
      </div>

      {shots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <ImageOff className="h-4 w-4 opacity-60" />
          Captures you take will show up here.
        </div>
      ) : (
        <div className="flex flex-1 items-center gap-2 overflow-x-auto px-4 pb-2">
          {shots.map((s) => (
            <div
              key={s.id}
              data-strip-item
              className={`group relative h-[74px] w-[132px] shrink-0 overflow-hidden rounded-lg border transition-colors ${
                s.id === activeId
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border/70 hover:border-primary/60'
              }`}
            >
              <button
                onClick={() => onPick(s.id)}
                className="block h-full w-full"
                title={`${s.width}×${s.height} · ${ago(s.ts)}`}
              >
                <img src={s.thumb} alt="" className="h-full w-full bg-black/40 object-cover" />
              </button>

              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-0.5 pt-3 text-[10px] font-medium text-white/90">
                {ago(s.ts)}
                {s.saved && <HardDriveDownload className="h-3 w-3 opacity-80" />}
              </span>

              <button
                onClick={() => onDelete(s.id)}
                title="Delete from history"
                className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white/80 transition-colors hover:bg-red-500/80 hover:text-white group-hover:flex"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
