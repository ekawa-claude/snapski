// Temporary standalone harness for the annotation editor (no chrome APIs).
// Mounts EditorView with a generated sample image so renderer-only behaviour
// (e.g. arrow head resize) can be driven in a browser preview.
import ReactDOM from 'react-dom/client'
import { EditorView } from './components/editor/EditorView'
import './index.css'

const cv = document.createElement('canvas')
cv.width = 900
cv.height = 560
const ctx = cv.getContext('2d')!
ctx.fillStyle = '#1f2937'
ctx.fillRect(0, 0, cv.width, cv.height)
ctx.fillStyle = '#9aa4b2'
ctx.font = '40px sans-serif'
ctx.fillText('sample capture', 60, 90)
const dataUrl = cv.toDataURL('image/png')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <EditorView
    capture={{ dataUrl }}
    onClose={() => {}}
    onExport={async () => {}}
  />
)
