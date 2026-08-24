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
      '@shared': resolve(__dirname, 'src/shared'),
      // The shared editor sits outside this app, and so do the packages it
      // imports: resolution walks up from the FILE, and neither shared/ nor the
      // repo root has a node_modules. Same aliases the two build configs carry.
      '@editor': resolve(__dirname, '../shared/editor'),
      'lucide-react': resolve(__dirname, 'node_modules/lucide-react'),
      fabric: resolve(__dirname, 'node_modules/fabric'),
      clsx: resolve(__dirname, 'node_modules/clsx'),
      'tailwind-merge': resolve(__dirname, 'node_modules/tailwind-merge'),
      'class-variance-authority': resolve(__dirname, 'node_modules/class-variance-authority'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom')
    }
  },
  plugins: [react()],
  // root is src/renderer, so the shared tree is above it — let the dev server read it.
  server: { port: 5199, strictPort: true, fs: { allow: [resolve(__dirname, '..')] } }
})
