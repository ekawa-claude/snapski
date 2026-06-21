import { ElectronAPI } from '@electron-toolkit/preload'
import type { SnapApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    snap: SnapApi
  }
}
