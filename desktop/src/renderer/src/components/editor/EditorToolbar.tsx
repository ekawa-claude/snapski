import {
  MousePointer2,
  Square,
  ArrowUpRight,
  Type,
  ListOrdered,
  Highlighter,
  Droplets,
  Crop,
  MessageSquareText,
  Focus,
  Undo2,
  Redo2,
  Trash2,
  Check,
  ChevronLeft,
  Copy,
  RotateCcw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type Tool =
  | 'select'
  | 'crop'
  | 'rect'
  | 'arrow'
  | 'text'
  | 'bubble'
  | 'badge'
  | 'highlight'
  | 'blur'
  | 'spotlight'

const TOOLS: { id: Tool; icon: React.ReactNode; label: string }[] = [
  { id: 'select', icon: <MousePointer2 className="h-[18px] w-[18px]" />, label: 'Select (Esc)' },
  { id: 'crop', icon: <Crop className="h-[18px] w-[18px]" />, label: 'Crop' },
  { id: 'rect', icon: <Square className="h-[18px] w-[18px]" />, label: 'Rectangle' },
  { id: 'arrow', icon: <ArrowUpRight className="h-[18px] w-[18px]" />, label: 'Arrow' },
  { id: 'badge', icon: <ListOrdered className="h-[18px] w-[18px]" />, label: 'Numbered step' },
  { id: 'text', icon: <Type className="h-[18px] w-[18px]" />, label: 'Text' },
  { id: 'bubble', icon: <MessageSquareText className="h-[18px] w-[18px]" />, label: 'Speech bubble' },
  { id: 'highlight', icon: <Highlighter className="h-[18px] w-[18px]" />, label: 'Highlight' },
  { id: 'blur', icon: <Droplets className="h-[18px] w-[18px]" />, label: 'Blur region' },
  { id: 'spotlight', icon: <Focus className="h-[18px] w-[18px]" />, label: 'Spotlight (dim background)' }
]

// Softer, evenly-weighted hues (Tailwind 400s) instead of saturated 500-defaults —
// reads less "primary-color-picker", more coordinated with the app's own indigo
// accent. Brand violet/white/black anchors kept as-is.
const COLORS = ['#fb7185', '#fb923c', '#fbbf24', '#4ade80', '#38bdf8', '#7c7cf5', '#ffffff', '#111114']

interface Props {
  tool: Tool
  setTool: (t: Tool) => void
  selectedKind: string | null
  color: string
  setColor: (c: string) => void
  strokeWidth: number
  setStrokeWidth: (n: number) => void
  nextBadge: number
  onResetBadge: () => void
  textBg: boolean
  onToggleTextBg: () => void
  textOutline: boolean
  onToggleTextOutline: () => void
  bubbleArrow: boolean
  onToggleBubbleArrow: () => void
  onAddPointer: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onSave: () => void
  onClose: () => void
  saving: boolean
  savedNote: boolean
}

export function EditorToolbar(props: Props): JSX.Element {
  // Context = the active drawing tool, or (in select mode) the selected object.
  const ctx = props.tool !== 'select' ? props.tool : props.selectedKind
  // Crop has its own Apply/Cancel bar, no color/width props.
  const showProps = ctx != null && ctx !== 'crop'
  const isText = ctx === 'text' || ctx === 'label'
  const showWidth = ctx === 'rect' || ctx === 'arrow' || isText
  const showColor = ctx != null && ctx !== 'blur' && ctx !== 'spotlight'

  return (
    <>
      {/* Top bar */}
      <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-border/60 pl-2 pr-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="no-drag gap-1.5" onClick={props.onClose}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="ml-1 text-sm font-semibold tracking-tight">Annotate</span>
        </div>
        <div className="no-drag flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!props.canUndo}
            onClick={props.onUndo}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!props.canRedo}
            onClick={props.onRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button size="sm" className="ml-1.5 gap-1.5" onClick={props.onSave} disabled={props.saving}>
            {props.savedNote ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {props.savedNote ? 'Copied & saved' : props.saving ? 'Saving…' : 'Copy & save'}
          </Button>
        </div>
      </header>

      {/* Floating left tool rail */}
      <div className="pointer-events-none absolute left-5 top-1/2 z-50 -translate-y-1/2">
        <div className="pointer-events-auto flex flex-col gap-1 rounded-2xl border border-border/70 bg-popover/90 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.label}
              onClick={() => props.setTool(t.id)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
                props.tool === t.id
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {t.icon}
            </button>
          ))}
          <div className="my-0.5 h-px bg-border/70" />
          <button
            title="Delete (Del)"
            onClick={props.onDelete}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* Floating properties panel */}
      {showProps && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/70 bg-popover/90 px-3 py-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
            {showColor && (
              <div className="flex items-center gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => props.setColor(c)}
                    className={cn(
                      'h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-popover transition-transform hover:scale-110',
                      props.color === c ? 'ring-white/80' : 'ring-transparent'
                    )}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            )}

            {showWidth && (
              <>
                <div className="h-6 w-px bg-border/70" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {isText ? 'Size' : 'Width'}
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={props.strokeWidth}
                    onChange={(e) => props.setStrokeWidth(Number(e.target.value))}
                    className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                  />
                  <span className="w-5 text-center text-[11px] tabular-nums text-foreground">
                    {props.strokeWidth}
                  </span>
                </div>
              </>
            )}

            {isText && (
              <>
                <div className="h-6 w-px bg-border/70" />
                <button
                  onClick={props.onToggleTextOutline}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                    props.textOutline
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                  title="Contrasting outline around the text"
                >
                  Outline
                </button>
                <button
                  onClick={props.onToggleTextBg}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                    props.textBg
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                  title="Solid background behind text"
                >
                  Background
                </button>
              </>
            )}

            {props.tool === 'bubble' && (
              <>
                <div className="h-6 w-px bg-border/70" />
                <button
                  onClick={props.onToggleBubbleArrow}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors',
                    props.bubbleArrow
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                  title="Add a pointer arrow after you place the bubble"
                >
                  Pointer
                </button>
              </>
            )}

            {ctx === 'callout' && (
              <>
                <div className="h-6 w-px bg-border/70" />
                <button
                  onClick={props.onAddPointer}
                  className="rounded-lg bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  title="Draw a pointer arrow from this bubble"
                >
                  Add pointer
                </button>
              </>
            )}

            {props.tool === 'badge' && (
              <>
                <div className="h-6 w-px bg-border/70" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Next <span className="text-foreground tabular-nums">{props.nextBadge}</span>
                  </span>
                  <button
                    onClick={props.onResetBadge}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    title="Reset counter to 1"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
