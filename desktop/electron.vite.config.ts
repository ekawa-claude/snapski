import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
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
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          'rec-hud': resolve(__dirname, 'src/renderer/rec-hud.html')
        }
      }
    }
  }
})
