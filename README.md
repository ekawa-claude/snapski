# SnapSki

A modern, portable screen-capture and annotation tool — a free, local-first Snagit alternative with opt-in sync between your PC and phone.

This is a monorepo with four components that share one philosophy (no accounts, no cloud lock-in) and, where possible, the same annotation editor:

📦 **[Download the latest builds from Releases](https://github.com/ekawa-claude/snapski/releases)** — Windows installer/portable, Android APK, Chrome extension.

## [`desktop/`](desktop/) — SnapSki Desktop

A portable Windows app (Electron + electron-vite + React + Tailwind).

- Global **PrintScreen** hotkey opens a dim overlay: drag a region, or pick fullscreen / active window; **Alt+PrintScreen** = instant silent fullscreen shot (game-friendly).
- Screenshot **and** screen recording (direct-to-mp4 via bundled ffmpeg).
- Full vector annotation editor: rectangle, curved arrows, numbered steps, text, speech bubbles, highlight, blur, spotlight, crop.
- Image and video editors (trim + timed blur for clips).
- Fullscreen gallery viewer with favorites, import, delete-to-recycle-bin.
- Auto-copy to clipboard + save to a folder; tray + auto-launch; built-in auto-update (installer build).
- Opt-in **cross-device sync** with the Android app (see below).

```bash
cd desktop
npm install
npm run dev      # run in development
npm run dist     # build win-unpacked + zip + portable
```

## [`android/`](android/) — SnapSki for Android

A native Android app (Kotlin + Jetpack Compose, minSdk 26).

- Full annotation editor: pen, arrow, box, text, blur, crop — with undo/redo.
- Share any image into SnapSki to annotate it instantly; photo-picker import.
- Screenshot capture via a Quick Settings tile (MediaProjection).
- Library with favorites, multi-select share/delete; optional auto-import from the system Screenshots folder.
- Opt-in **cross-device sync**: pair with the desktop app by scanning a QR code — shots you choose (or favorite) sync between phone and PC, live over SSE while both apps are open.

```bash
cd android
./gradlew assembleDebug   # APK in app/build/outputs/apk/debug/
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

## [`hub/`](hub/) — sync hub

A small self-hostable server (FastAPI + SQLite + flat files) that powers phone↔PC sync.

- Devices pair into a *sync group* (one person = their devices); auth is a bearer token, the server stores only its hash.
- Shots are immutable; favorites/deletes are an ops log with last-write-wins; clients pull by server sequence number.
- `GET /events` (SSE) pushes live change notifications while clients are connected.

```bash
cd hub
pip install -r requirements.txt
uvicorn app:app --port 8790
```

## Shared editor

The desktop app and the Chrome extension use the same fabric.js-based annotation editor (`EditorView` / `EditorToolbar` / tool modules), kept in sync between the two `components/editor/` folders. The Android app implements the same tool set natively in Compose.
