import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Content scripts are injected as classic scripts (no ES module support), so
// they must be a self-contained IIFE. Built separately from the page/SW bundle.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false, // keep the main build's output
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'snapski',
      fileName: () => 'content.js'
    },
    rollupOptions: {
      output: { extend: true }
    }
  }
})
