import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { copyFileSync, cpSync } from 'node:fs'

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
  plugins: [react(), copyStatic()],
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
