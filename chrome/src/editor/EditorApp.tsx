import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
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

/**
 * Export the finished annotation. Either action is independent: copy the PNG to
 * the clipboard (best-effort — the editor tab is focused, so the async Clipboard
 * API is allowed) and/or save it via the downloads API into a SnapSki/ subfolder.
 */
async function exportImage(
  dataUrl: string,
  opts: { copy: boolean; download: boolean }
): Promise<void> {
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
    await chrome.downloads.download({
      url: dataUrl,
      filename: `SnapSki/snapski_${stamp()}.png`,
      saveAs: false
    })
  }
}

export function EditorApp(): JSX.Element {
  const [capture, setCapture] = useState<CaptureResult | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return <EditorView capture={capture} onClose={() => window.close()} onExport={exportImage} />
}
