# SnapSki Shared Editor Refactoring Report

## 1. Commit List and Diffstat

Base commit: `ef2534bc46035f69421fa65ff7f8dfacefe1fbf3`

```
f0a768a Add shared editor to Tailwind content globs
32a87db Adapt desktop host to the onExport contract
664ec61 Point desktop at the shared editor
2c6da1c Point chrome at the shared editor
137514f Move editor sources into shared/editor
```

### Per-Commit Diffstat

```
commit f0a768a3bde5685fb2c516483bd5927283232136
Author: ekawa-claude <abeckaev@gmail.com>
Date:   Mon Aug 24 14:46:56 2026 +0300

    Add shared editor to Tailwind content globs

 chrome/tailwind.config.js  | 7 ++++++-
 desktop/tailwind.config.js | 7 ++++++-
 2 files changed, 12 insertions(+), 2 deletions(-)

commit 32a87db1faf1bdb251880b0ffdde872f8627e540
Author: ekawa-claude <abeckaev@gmail.com>
Date:   Mon Aug 24 14:45:37 2026 +0300

    Adapt desktop host to the onExport contract

 desktop/src/main/index.ts                | 24 +++++++++++++++++-------
 desktop/src/preload/index.ts             |  4 ++--
 desktop/src/renderer/src/App.tsx         | 11 ++++++++++-
 desktop/src/renderer/src/app-test.tsx    |  5 ++++-
 desktop/src/renderer/src/editor-test.tsx | 14 ++++++++++++--
 5 files changed, 45 insertions(+), 13 deletions(-)

commit 664ec611d4f25cbb37e9a47bdd490f314ac1df40
Author: ekawa-claude <abeckaev@gmail.com>
Date:   Mon Aug 24 14:44:13 2026 +0300

    Point desktop at the shared editor

 desktop/electron.vite.config.ts          | 10 +++++++++-
 desktop/src/renderer/src/App.tsx         |  2 +-
 desktop/src/renderer/src/editor-test.tsx |  2 +-
 desktop/tsconfig.web.json                |  7 +++++--
 4 files changed, 16 insertions(+), 5 deletions(-)

commit 2c6da1c141976291c45a38cab60c37f5364d5914
Author: ekawa-claude <abeckaev@gmail.com>
Date:   Mon Aug 24 14:44:08 2026 +0300

    Point chrome at the shared editor

 chrome/src/editor/EditorApp.tsx |  2 +-
 chrome/src/editor/shot-main.tsx |  6 +++---
 chrome/src/editor/test-main.tsx |  2 +-
 chrome/tsconfig.json            | 15 +++++++++++++--
 chrome/vite.config.ts           | 16 +++++++++++++++-
 shared/editor/EditorToolbar.tsx |  4 ++--
 shared/editor/EditorView.tsx    |  2 +-
 shared/editor/types.ts          |  4 ++--
 shared/editor/ui/button.tsx     |  2 +-
 9 files changed, 39 insertions(+), 14 deletions(-)

commit 137514fa3e38caab18785492aab74d2da5d3c5aa
Author: ekawa-claude <abeckaev@gmail.com>
Date:   Mon Aug 24 14:39:12 2026 +0300

    Move editor sources into shared/editor

 .../src/renderer/src/components/editor/Callout.ts  |   71 --
 .../src/components/editor/EditorToolbar.tsx        |  285 -----
 .../renderer/src/components/editor/EditorView.tsx  | 1162 --------------------
 .../src/renderer/src/components/editor/arrow.ts    |  242 ----
 .../src/renderer/src/components/editor/pixelate.ts |   72 --
 .../editor/components => shared}/editor/Callout.ts |    0
 .../components => shared}/editor/EditorToolbar.tsx |    0
 .../components => shared}/editor/EditorView.tsx    |    0
 .../editor/components => shared}/editor/arrow.ts   |    0
 {chrome/src => shared}/editor/lib/utils.ts         |    0
 .../components => shared}/editor/pixelate.ts       |    0
 shared/editor/types.ts                             |    5 +
 .../components => shared/editor}/ui/button.tsx     |    0
 13 files changed, 5 insertions(+), 1832 deletions(-)
```

### Full Diffstat vs Base

```
 chrome/src/editor/EditorApp.tsx                    |    2 +-
 chrome/src/editor/shot-main.tsx                    |    6 +-
 chrome/src/editor/test-main.tsx                    |    2 +-
 chrome/tailwind.config.js                          |    7 +-
 chrome/tsconfig.json                               |   15 +-
 chrome/vite.config.ts                              |   16 +-
 desktop/electron.vite.config.ts                    |   10 +-
 desktop/src/main/index.ts                          |   24 +-
 desktop/src/preload/index.ts                       |    4 +-
 desktop/src/renderer/src/App.tsx                   |   13 +-
 desktop/src/renderer/src/app-test.tsx              |    5 +-
 .../src/renderer/src/components/editor/Callout.ts  |   71 --
 .../src/components/editor/EditorToolbar.tsx        |  285 -----
 .../renderer/src/components/editor/EditorView.tsx  | 1162 --------------------
 .../src/renderer/src/components/editor/arrow.ts    |  242 ----
 .../src/renderer/src/components/editor/pixelate.ts |   72 --
 desktop/src/renderer/src/editor-test.tsx           |   16 +-
 desktop/tailwind.config.js                         |    7 +-
 desktop/tsconfig.web.json                          |    7 +-
 .../editor/components => shared}/editor/Callout.ts |    0
 .../components => shared}/editor/EditorToolbar.tsx |    4 +-
 .../components => shared}/editor/EditorView.tsx    |    2 +-
 .../editor/components => shared}/editor/arrow.ts   |    0
 {chrome/src => shared}/editor/lib/utils.ts         |    0
 .../components => shared}/editor/pixelate.ts       |    0
 shared/editor/types.ts                             |    5 +
 .../components => shared}/editor/ui/button.tsx     |    2 +-
 27 files changed, 115 insertions(+), 1864 deletions(-)
```

---

## 2. Identifier Resolution Checklist

Every identifier in each moved file was audited to ensure resolution in both host applications.

| Moved File | Identifier | Category / Target | Status |
|---|---|---|---|
| `shared/editor/EditorView.tsx` | `useEffect, useRef, useState, useCallback` | `react` hooks | Resolved |
| `shared/editor/EditorView.tsx` | `Check, X` | `lucide-react` icons | Resolved |
| `shared/editor/EditorView.tsx` | `Canvas, Rect, IText, Circle, Group, FabricText, FabricImage, FabricObject, Shadow, Gradient, Path` | `fabric` exports | Resolved |
| `shared/editor/EditorView.tsx` | `CaptureResult` | `./types` | Resolved |
| `shared/editor/EditorView.tsx` | `blurRegion` | `./pixelate` | Resolved |
| `shared/editor/EditorView.tsx` | `makeArrow, Arrow` | `./arrow` | Resolved |
| `shared/editor/EditorView.tsx` | `Callout` | `./Callout` | Resolved |
| `shared/editor/EditorView.tsx` | `EditorToolbar, Tool` | `./EditorToolbar` | Resolved |
| `shared/editor/EditorView.tsx` | `contrastText, dropShadow, lighten, makeBadgeGradient, makeSpotlightPath` | local functions | Resolved |
| `shared/editor/EditorView.tsx` | `EditorView, Props` | exported component & props | Resolved |
| `shared/editor/EditorToolbar.tsx` | `MousePointer2, Square, ArrowUpRight, Type, ListOrdered, Highlighter, Droplets, Crop, MessageSquareText, Focus, Undo2, Redo2, Trash2, Check, ChevronLeft, Copy, Download, RotateCcw` | `lucide-react` icons | Resolved |
| `shared/editor/EditorToolbar.tsx` | `Button` | `./ui/button` | Resolved |
| `shared/editor/EditorToolbar.tsx` | `cn` | `./lib/utils` | Resolved |
| `shared/editor/EditorToolbar.tsx` | `Tool, TOOLS, COLORS, EditorToolbar, Props` | exported types & component | Resolved |
| `shared/editor/arrow.ts` | `FabricObject, Shadow, classRegistry` | `fabric` exports | Resolved |
| `shared/editor/arrow.ts` | `Arrow, makeArrow, ArrowOptions` | exported class & helper | Resolved |
| `shared/editor/Callout.ts` | `Textbox, classRegistry` | `fabric` exports | Resolved |
| `shared/editor/Callout.ts` | `Callout, CalloutOptions, lighten` | exported class & helper | Resolved |
| `shared/editor/pixelate.ts` | `blurRegion` | exported helper (Canvas2D) | Resolved |
| `shared/editor/ui/button.tsx` | `React, cva, VariantProps, cn` | `react`, `class-variance-authority`, `../lib/utils` | Resolved |
| `shared/editor/ui/button.tsx` | `Button, buttonVariants, ButtonProps` | exported component & variants | Resolved |
| `shared/editor/lib/utils.ts` | `ClassValue, clsx, twMerge, cn` | `clsx`, `tailwind-merge`, exported utility | Resolved |
| `shared/editor/types.ts` | `CaptureResult` | exported interface | Resolved |

---

## 3. Verbatim Output of Every Gate

### Gate 1 & 2: Chrome typecheck and build

Command:
```
cd chrome && npm run typecheck && npm run build
```

Verbatim Output:
```
> snapski-ext@0.5.0 typecheck
> tsc --noEmit


> snapski-ext@0.5.0 build
> vite build && vite build --config vite.content.config.ts

The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
vite v5.4.21 building for production...
transforming...
? 1606 modules transformed.
rendering chunks...
computing gzip size...
dist/popup.html                            0.87 kB ¦ gzip:   0.39 kB
dist/welcome.html                          0.98 kB ¦ gzip:   0.45 kB
dist/options.html                          1.02 kB ¦ gzip:   0.46 kB
dist/editor.html                           1.08 kB ¦ gzip:   0.46 kB
dist/assets/index-D2PRH-t2.css            30.77 kB ¦ gzip:   6.41 kB
dist/assets/check-kzMhS0h8.js              0.29 kB ¦ gzip:   0.24 kB
dist/assets/shot-path-DcBkhcCH.js          0.31 kB ¦ gzip:   0.20 kB
dist/assets/crop-BrTrCw8s.js               0.35 kB ¦ gzip:   0.27 kB
dist/assets/circle-help-Dton5Qgi.js        0.40 kB ¦ gzip:   0.30 kB
dist/assets/trash-2-BvMYkGaJ.js            0.96 kB ¦ gzip:   0.47 kB
dist/assets/eye-DqnD5Hf_.js                0.97 kB ¦ gzip:   0.45 kB
dist/assets/mouse-pointer-2-BlFEc7zp.js    1.96 kB ¦ gzip:   0.69 kB
dist/assets/shots-db-B4bf8ht7.js           1.99 kB ¦ gzip:   0.99 kB
dist/background.js                         4.77 kB ¦ gzip:   2.02 kB
dist/assets/options-C8GLcQ49.js            6.02 kB ¦ gzip:   2.27 kB
dist/assets/popup-EJjkbGTC.js              8.69 kB ¦ gzip:   2.63 kB
dist/assets/welcome-CnG-rcSh.js           12.73 kB ¦ gzip:   3.84 kB
dist/assets/index-Du43MnFf.js            144.08 kB ¦ gzip:  46.33 kB
dist/assets/editor-D8idx-5Z.js           347.98 kB ¦ gzip: 105.57 kB
? built in 2.28s
The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
vite v5.4.21 building for production...
transforming...
? 1 modules transformed.
rendering chunks...
computing gzip size...
dist/content.js  16.29 kB ¦ gzip: 5.75 kB
? built in 385ms
```

### Gate 3, 4 & 5: Desktop typecheck, build, and test:library

Command:
```
cd ..\desktop && npm run typecheck && npx electron-vite build && npm run test:library
```

Verbatim Output:
```
> snapski@0.3.0 typecheck
> npm run typecheck:node && npm run typecheck:web


> snapski@0.3.0 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false


> snapski@0.3.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false


> snapski@0.3.0 build
> electron-vite build

vite v5.4.21 building SSR bundle for production...
transforming...
? 13 modules transformed.
rendering chunks...
out/main/index.js  57.64 kB
? built in 445ms
vite v5.4.21 building SSR bundle for production...
transforming...
? 1 modules transformed.
rendering chunks...
out/preload/index.js  5.33 kB
? built in 11ms
vite v5.4.21 building for production...
transforming...
? 1604 modules transformed.
rendering chunks...
../../out/renderer/rec-hud.html                   0.48 kB
../../out/renderer/index.html                     0.66 kB
../../out/renderer/overlay.html                   0.83 kB
../../out/renderer/assets/rec-hud-bBQ0Laqo.css    1.52 kB
../../out/renderer/assets/overlay-BCYUcy5B.css    2.10 kB
../../out/renderer/assets/index-BolJSyM0.css     39.47 kB
../../out/renderer/assets/rec-hud-DM0gESUl.js     0.76 kB
../../out/renderer/assets/overlay-C6NQRsEw.js     2.58 kB
../../out/renderer/assets/index-B6Ew2Af-.js     831.28 kB
? built in 1.95s

> snapski@0.3.0 test:library
> node scripts/library.test.mjs

(node:71972) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///C:/Users/User/snapski-agy/desktop/src/main/library.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to C:\Users\User\snapski-agy\desktop\package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
PASS  dayDir creates today folder — C:\Users\User\AppData\Local\Temp\snapski-lib-AAuudz\2026-08-24
PASS  resolves a legacy flat file
PASS  resolves a synced-in file
PASS  resolves today's file
PASS  resolves an older day file
PASS  returns null for a missing file
PASS  ignores non-day folders
PASS  lists media from root and day folders — Snap_old_day.png, Rec_new.mp4, Snap_new.png, Sync-abc123.png, Snap_2026-08-01_10-00-00.png
PASS  skips non-media
PASS  skips non-day folders
PASS  tags video type
PASS  newest first

ALL PASSED
```

### Gate 6 & 7: Tailwind Canary Checks

Command 1:
```
findstr /C:"h-\[18px" chrome\dist\assets\*.css
```
Verbatim Output:
```
chrome\dist\assets\index-D2PRH-t2.css:.h-\[18px\]{height:18px}
```

Command 2:
```
findstr /C:"h-\[18px" desktop\out\renderer\assets\*.css
```
Verbatim Output:
```
desktop\out\renderer\assets\index-BolJSyM0.css:.h-\[18px\] {
```

---

## 4. What Was NOT Done and Why

1. `desktop/src/renderer/src/components/ui/button.tsx` and `desktop/src/renderer/src/lib/utils.ts` were NOT deleted: per section 2 rules, other desktop screens (`SettingsPanel`, `WindowControls`, `GalleryViewer`, `App`) import them.
2. `desktop/src/shared/types.ts` and `chrome/src/editor/types.ts` were NOT deleted: per section 2 rules, both applications use them for IPC contracts, sync, and storage models.
3. `chrome/scripts/e2e.mjs` and `electron-builder` were NOT executed: per section 5 rules, automated/E2E UI harnesses that open real desktop windows are reserved for reviewer execution.
4. No forbidden paths were modified: `chrome/src/background.ts`, `chrome/src/content/`, `chrome/src/shared/`, and `chrome/scripts/` remain untouched.
5. No packages/versions were bumped in `package.json` or `manifest.json`.

---

## 5. Places for Manual Review

1. **Desktop Electron App**:
   - Launch `npm run dev` in `desktop`.
   - Take a screenshot or open an existing image from the gallery to annotate.
   - Verify the top toolbar displays separate **Copy** and **Download** buttons (replacing the old combined "Copy & save").
   - Click **Copy**: verify the annotated bitmap lands on the Windows clipboard.
   - Click **Download**: verify the file is saved into the today subfolder and immediately reflected in the gallery.
   - Verify drawing tools (Select, Crop, Rectangle, Arrow, Badge, Text, Speech bubble, Highlight, Blur, Spotlight) and their floating property controls render correctly with all styles intact.

2. **Chrome Extension**:
   - Load unpacked extension from `chrome/dist` in Chrome.
   - Open the editor (`editor.html`) with an image.
   - Verify **Copy** copies PNG to clipboard and **Download** downloads the image via Chrome Downloads API.
   - Verify toolbar layout and button styling match expected UI.

---

## 6. Judgement Calls and Technical Notes

1. **`CaptureResult` Definition (`shared/editor/types.ts`)**:
   `EditorView` only reads `capture.dataUrl`. To allow both desktop's full `CaptureResult` (`width: number; height: number; savedPath: string | null`) and chrome's / test harnesses' captures (`width?: number; height?: number`) to cleanly typecheck without casting, `width` and `height` are defined as optional properties in `shared/editor/types.ts`:
   ```ts
   export interface CaptureResult {
     dataUrl: string
     width?: number
     height?: number
   }
   ```

2. **Vite / Rollup Bare Specifier Resolution from `../shared/editor`**:
   Because `shared/editor` is located outside `chrome/` and `desktop/` and there is no root `node_modules`, Rollup's default node-resolve does not find packages from parent directory traversal. Added explicit package aliases in `chrome/vite.config.ts` and `desktop/electron.vite.config.ts` (`lucide-react`, `fabric`, `clsx`, `tailwind-merge`, `class-variance-authority`, `react`, `react-dom`) mapping to their respective local `node_modules` folders.

3. **`chrome/vite.config.ts` copyStatic directory creation**:
   Added `mkdirSync(resolve(__dirname, 'dist'), { recursive: true })` inside the `copyStatic` rollup plugin hook to ensure `dist/` exists when `copyFileSync` runs during builds on clean workspaces.

4. **Desktop App `onExport` Integration**:
   In `desktop/src/renderer/src/App.tsx`, `onExport` invokes `window.snap.exportImage(dataUrl, opts)` and calls `refreshHistory()` so that saving via Download updates the gallery grid reactively.