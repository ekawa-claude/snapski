# SnapSki

A modern, portable screen-capture and annotation tool — a lightweight Snagit alternative.

This is a monorepo containing two versions that share the same annotation editor:

## [`desktop/`](desktop/) — SnapSki Desktop

A portable Windows app (Electron + electron-vite + React + Tailwind).

- Global **PrintScreen** hotkey opens a dim overlay: drag a region, or pick fullscreen / active window.
- Screenshot **and** screen recording (direct-to-mp4 via bundled ffmpeg).
- Full vector annotation editor: rectangle, arrow, numbered steps, text, speech bubbles, highlight, blur, crop.
- Image and video editors (trim + timed blur for clips).
- Auto-copy to clipboard + save to a folder; recent-history grid; tray + auto-launch.

```bash
cd desktop
npm install
npm run dev      # run in development
npm run dist     # build win-unpacked + zip + portable
```

## [`chrome/`](chrome/) — SnapSki for Chrome

A Chrome MV3 extension (Vite) for browser-only capture, built when corporate IT blocked the unsigned desktop exe.

- Capture the visible tab, a region, the full page, or the screen (via `getDisplayMedia`).
- Draggable in-page floating button + popup + hotkeys.
- The same fabric.js annotation editor as the desktop app, ported to the browser.

```bash
cd chrome
npm install
npm run build    # produces a loadable dist/ — load unpacked via chrome://extensions
```

## Shared editor

Both versions use the same fabric.js-based annotation editor (`EditorView` / `EditorToolbar` / tool modules), kept in sync between the two `components/editor/` folders.
