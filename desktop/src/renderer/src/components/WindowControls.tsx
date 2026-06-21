import { useState } from 'react'
import { Minus, Square, X, Copy as CopyIcon } from 'lucide-react'

/** Custom min/max/close controls for the frameless window. */
export function WindowControls(): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  return (
    <div className="no-drag flex items-center">
      <Ctl onClick={() => window.snap.winMinimize()} title="Minimize">
        <Minus className="h-3.5 w-3.5" />
      </Ctl>
      <Ctl
        onClick={async () => setMaximized(await window.snap.winToggleMaximize())}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? <CopyIcon className="h-3 w-3 scale-x-[-1]" /> : <Square className="h-3 w-3" />}
      </Ctl>
      <Ctl onClick={() => window.snap.winClose()} title="Close" danger>
        <X className="h-4 w-4" />
      </Ctl>
    </div>
  )
}

function Ctl({
  children,
  onClick,
  title,
  danger
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  danger?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:text-foreground ' +
        (danger ? 'hover:bg-destructive hover:text-destructive-foreground' : 'hover:bg-accent')
      }
    >
      {children}
    </button>
  )
}
