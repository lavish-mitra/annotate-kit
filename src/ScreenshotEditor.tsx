// A tiny markup editor: draw pen / rectangle / arrow strokes onto a captured screenshot, then copy or
// download the flattened image. Self-contained — one <canvas>, no dependencies beyond React + icons.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { X, Pencil, Square, ArrowUpRight, Undo2, Trash2, Copy, Download } from 'lucide-react'

type Tool = 'pen' | 'rect' | 'arrow'
type Pt = { x: number; y: number }
type Shape =
  | { tool: 'pen'; color: string; pts: Pt[] }
  | { tool: 'rect' | 'arrow'; color: string; x: number; y: number; x2: number; y2: number }

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827', '#ffffff']

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = Math.max(3, ctx.canvas.width / 400)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (s.tool === 'pen') {
    ctx.beginPath()
    s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
  } else if (s.tool === 'rect') {
    ctx.strokeRect(Math.min(s.x, s.x2), Math.min(s.y, s.y2), Math.abs(s.x2 - s.x), Math.abs(s.y2 - s.y))
  } else {
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x2, s.y2); ctx.stroke()
    const ang = Math.atan2(s.y2 - s.y, s.x2 - s.x)
    const h = Math.max(12, ctx.lineWidth * 4)
    ctx.beginPath(); ctx.moveTo(s.x2, s.y2)
    ctx.lineTo(s.x2 - h * Math.cos(ang - Math.PI / 6), s.y2 - h * Math.sin(ang - Math.PI / 6))
    ctx.lineTo(s.x2 - h * Math.cos(ang + Math.PI / 6), s.y2 - h * Math.sin(ang + Math.PI / 6))
    ctx.closePath(); ctx.fill()
  }
}

const TOOLS: { key: Tool; Icon: typeof Pencil; label: string }[] = [
  { key: 'pen', Icon: Pencil, label: 'Draw' },
  { key: 'rect', Icon: Square, label: 'Box' },
  { key: 'arrow', Icon: ArrowUpRight, label: 'Arrow' },
]

export function ScreenshotEditor({ blob, onToast, onClose }: {
  blob: Blob
  onToast: (kind: 'success' | 'error', msg: string) => void
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drawingRef = useRef<Shape | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [shapes, setShapes] = useState<Shape[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { imgRef.current = img; setReady(true) }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob])

  const redraw = () => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    if (canvas.width !== img.naturalWidth) canvas.width = img.naturalWidth
    if (canvas.height !== img.naturalHeight) canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    const all = drawingRef.current ? [...shapes, drawingRef.current] : shapes
    for (const s of all) drawShape(ctx, s)
  }
  useEffect(() => { redraw() }, [ready, shapes])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)   // capture — Escape closes only the editor, not the host panel
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  // focus trap (a11y)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const SEL = 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const list = () => Array.from(el.querySelectorAll<HTMLElement>(SEL)).filter((x) => x.offsetParent !== null)
    ;(list()[0] ?? el).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const f = list()
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [])

  const toCanvas = (e: ReactPointerEvent): Pt => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    // map to the content box (exclude the 1px border via clientLeft/Top + clientWidth/Height)
    return {
      x: (e.clientX - r.left - canvas.clientLeft) * (canvas.width / canvas.clientWidth),
      y: (e.clientY - r.top - canvas.clientTop) * (canvas.height / canvas.clientHeight),
    }
  }
  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    const p = toCanvas(e)
    drawingRef.current = tool === 'pen' ? { tool: 'pen', color, pts: [p] } : { tool, color, x: p.x, y: p.y, x2: p.x, y2: p.y }
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* noop */ }
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drawingRef.current
    if (!d) return
    const p = toCanvas(e)
    if (d.tool === 'pen') d.pts.push(p)
    else { d.x2 = p.x; d.y2 = p.y }
    redraw()
  }
  const onUp = () => {
    const d = drawingRef.current
    if (d) { setShapes((s) => [...s, d]); drawingRef.current = null }
  }

  const exportBlob = (): Promise<Blob | null> =>
    new Promise((res) => (canvasRef.current ? canvasRef.current.toBlob((b) => res(b), 'image/png') : res(null)))

  const copy = async () => {
    const b = await exportBlob()
    if (b && navigator.clipboard && typeof window.ClipboardItem === 'function') {
      try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': b })]); onToast('success', 'Marked-up image copied — paste anywhere'); onClose(); return } catch { /* fall through */ }
    }
    onToast('error', 'Clipboard blocked — use Download')
  }
  const download = async () => {
    const b = await exportBlob()
    if (!b) return
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url
    a.download = `markup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    onToast('success', 'Marked-up image downloaded')
    onClose()
  }

  const btn = 'inline-flex items-center gap-1 rounded-input px-2.5 py-1.5 text-xs font-semibold transition'

  return (
    <div data-annot-ui role="dialog" aria-modal="true" aria-label="Mark up screenshot"
      className="fixed inset-0 z-[10002] flex flex-col bg-fg/70 p-3" onClick={onClose}>
      <div ref={panelRef} tabIndex={-1} className="mx-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-modal border border-line bg-surface shadow-e4 outline-none" onClick={(e) => e.stopPropagation()}>
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
          {TOOLS.map(({ key, Icon, label }) => (
            <button key={key} type="button" title={label} aria-label={label} onClick={() => setTool(key)}
              className={btn + ' ' + (tool === key ? 'bg-brand text-white' : 'text-fg-muted hover:bg-row-alt')}>
              <Icon size={14} /> {label}
            </button>
          ))}
          <span className="mx-1 flex items-center gap-1">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)} style={{ background: c }}
                className={'h-5 w-5 rounded-full border-2 ' + (color === c ? 'scale-110 border-fg-secondary' : 'border-line')} />
            ))}
          </span>
          <button type="button" onClick={() => setShapes((s) => s.slice(0, -1))} disabled={!shapes.length} title="Undo"
            className={btn + ' text-fg-muted hover:bg-row-alt disabled:opacity-40'}><Undo2 size={14} /></button>
          <button type="button" onClick={() => setShapes([])} disabled={!shapes.length} title="Clear all"
            className={btn + ' text-fg-muted hover:bg-row-alt disabled:opacity-40'}><Trash2 size={14} /></button>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={download} className={btn + ' border border-line text-fg-secondary hover:bg-row-alt'}><Download size={14} /> Download</button>
            <button type="button" onClick={copy} className={btn + ' bg-brand text-white'}><Copy size={14} /> Copy</button>
            <button type="button" onClick={onClose} title="Close" aria-label="Close" className="rounded-input p-1.5 text-fg-muted hover:bg-row-alt"><X size={16} /></button>
          </div>
        </div>
        {/* canvas */}
        <div className="grid max-h-[78vh] place-items-center overflow-auto bg-sunken p-3">
          <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            style={{ maxWidth: '100%', maxHeight: '72vh', touchAction: 'none', cursor: 'crosshair' }}
            className="rounded-input border border-line shadow-e2" />
        </div>
      </div>
    </div>
  )
}
