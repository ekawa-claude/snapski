import { useEffect, useState } from 'react'
import { ImageOff, Link2, FolderOpen, Trash2, X, Check } from 'lucide-react'
import { EditorView } from './components/editor/EditorView'
import type { CaptureResult } from './types'

/** Convert a data URL into a Blob so it can go on the clipboard / to downloads. */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(
    d.getMinutes()
  )}-${p(d.getSeconds())}`
}

interface SavedFile {
  id: number
  /** Absolute path on disk, as reported by the downloads API. */
  filename: string
}

/** Poll the downloads API until the item lands on disk (or fails). */
function waitForDownload(id: number): Promise<string | null> {
  return new Promise((resolve) => {
    const check = async (): Promise<void> => {
      const [d] = await chrome.downloads.search({ id })
      if (d?.state === 'complete' && d.filename) return resolve(d.filename)
      if (!d || d.state === 'interrupted') return resolve(null)
      setTimeout(() => void check(), 250)
    }
    void check()
  })
}

export function EditorApp(): JSX.Element {
  const [capture, setCapture] = useState<CaptureResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedFile | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const flashNote = (msg: string): void => {
    setNote(msg)
    setTimeout(() => setNote(null), 1800)
  }

  /**
   * Export the finished annotation. Either action is independent: copy the PNG to
   * the clipboard (best-effort — the editor tab is focused, so the async Clipboard
   * API is allowed) and/or save it via the downloads API into a SnapSki/ subfolder.
   */
  const exportImage = async (
    dataUrl: string,
    opts: { copy: boolean; download: boolean }
  ): Promise<void> => {
    if (opts.copy) {
      try {
        const blob = await dataUrlToBlob(dataUrl)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      } catch (e) {
        // Clipboard can fail if the tab lost focus.
        console.warn('clipboard write failed', e)
      }
    }
    if (opts.download) {
      const id = await chrome.downloads.download({
        url: dataUrl,
        filename: `SnapSki/snapski_${stamp()}.png`,
        saveAs: false
      })
      const filename = await waitForDownload(id)
      if (filename) setSaved({ id, filename })
    }
  }

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id')
    if (!id) {
      setError('No capture id — open the editor from the SnapSki popup.')
      return
    }
    const key = `cap_${id}`
    chrome.storage.local.get(key).then((store) => {
      const cap = store[key] as CaptureResult | undefined
      if (!cap) {
        setError('That capture has expired. Take a new screenshot.')
        return
      }
      setCapture(cap)
      // One-shot: free the storage once we own the pixels.
      void chrome.storage.local.remove(key)
    })
  }, [])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <ImageOff className="h-10 w-10 opacity-60" />
        <p className="text-sm">{error}</p>
      </div>
    )
  }

  if (!capture) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading capture…
      </div>
    )
  }

  return (
    <>
      <EditorView capture={capture} onClose={() => window.close()} onExport={exportImage} />

      {/* Post-save actions for the file on disk: copy its path, reveal, delete. */}
      {saved && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-xl border border-border/70 bg-popover/95 p-1.5 pl-3 shadow-2xl backdrop-blur">
          <span
            className="max-w-[260px] truncate text-xs text-muted-foreground"
            title={saved.filename}
          >
            {saved.filename.split(/[\\/]/).pop()}
          </span>
          <SavedBtn
            label="Copy path"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(saved.filename)
                flashNote('Path copied')
              } catch {
                flashNote('Copy failed')
              }
            }}
          >
            <Link2 className="h-3.5 w-3.5" />
          </SavedBtn>
          <SavedBtn label="Show in folder" onClick={() => chrome.downloads.show(saved.id)}>
            <FolderOpen className="h-3.5 w-3.5" />
          </SavedBtn>
          <SavedBtn
            label="Delete file"
            danger
            onClick={async () => {
              try {
                await chrome.downloads.removeFile(saved.id)
                await chrome.downloads.erase({ id: saved.id })
                setSaved(null)
                flashNote('File deleted')
              } catch {
                flashNote('Delete failed')
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </SavedBtn>
          <SavedBtn label="Dismiss" onClick={() => setSaved(null)}>
            <X className="h-3.5 w-3.5" />
          </SavedBtn>
        </div>
      )}

      {note && (
        <div className="fixed bottom-20 right-4 z-50 flex items-center gap-1.5 rounded-full border border-border/70 bg-popover/95 px-3 py-1.5 text-xs font-medium shadow-xl backdrop-blur">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          {note}
        </div>
      )}
    </>
  )
}

function SavedBtn({
  label,
  onClick,
  children,
  danger = false
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}): JSX.Element {
  return (
    <button
      title={label}
      onClick={onClick}
      className={
        'flex h-7 w-7 items-center justify-center rounded-lg transition-colors ' +
        (danger
          ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground')
      }
    >
      {children}
    </button>
  )
}
