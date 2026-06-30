import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, cpSync, writeFileSync, mkdirSync } from 'node:fs'

// TEMP dev-only endpoint so the store-screenshot harness can save PNGs to disk.
function saveShots() {
  return {
    name: 'save-shots',
    configureServer(server: { middlewares: { use: (p: string, h: unknown) => void } }) {
      server.middlewares.use('/__save', (req: never, res: never) => {
        const rq = req as unknown as { method: string; on: (e: string, cb: (c?: unknown) => void) => void }
        const rs = res as unknown as { statusCode: number; end: (s?: string) => void }
        if (rq.method !== 'POST') { rs.statusCode = 405; return rs.end('POST only') }
        let body = ''
        rq.on('data', (c) => { body += c })
        rq.on('end', () => {
          const { name, data } = JSON.parse(body) as { name: string; data: string }
          const b64 = data.replace(/^data:image\/png;base64,/, '')
          mkdirSync(resolve(__dirname, 'store-shots'), { recursive: true })
          writeFileSync(resolve(__dirname, 'store-shots', name), Buffer.from(b64, 'base64'))
          rs.end('ok')
        })
      })
    }
  }
}

// Copies the static manifest + icons into dist/ after the bundle is written, so
// the build output is a directly loadable unpacked extension.
function copyStatic() {
  return {
    name: 'copy-static',
    closeBundle() {
      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(__dirname, 'dist/manifest.json'))
      cpSync(resolve(__dirname, 'icons'), resolve(__dirname, 'dist/icons'), {
        recursive: true,
        filter: (src) => !src.endsWith('_preview.png')
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), copyStatic(), saveShots()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/editor')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'editor.html'),
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background.ts')
      },
      output: {
        // The service worker must have a stable, manifest-referenced name.
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})
