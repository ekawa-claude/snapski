// Renderer-only Vite server for testing UI (e.g. the annotation editor) in a
// plain browser, without launching Electron. Used by .claude/launch.json.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
