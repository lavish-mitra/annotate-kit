import { Component, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { domToBlob } from 'modern-screenshot'
import {
  X, Trash2, Copy, Download, Crosshair, MessageSquarePlus, Camera, ListChecks, CornerDownRight, Target,
  Eraser, Check, MapPin, Square, ArrowUpRight, Circle, Spline, Undo2, Eye, EyeOff, GripVertical, Maximize2,
  Lock, Globe, Settings, Pencil, Keyboard, Send, Filter, Monitor, TerminalSquare, Trash, Highlighter,
} from 'lucide-react'
import type { StorageAdapter } from './adapter'
import {
  ANN_TYPES, ANN_PRIORITIES, ANN_STATUSES, OPEN_STATUSES, ANN_MODES, ANN_COLORS, annDot, annTypeLabel,
  annStatusLabel, annShapeLabel,
} from './constants'
import { buildDevPrompt } from './prompt'
import { sanitizeSnapshot } from './snapshot'
import { ScreenshotEditor } from './ScreenshotEditor'
import type { Delivery } from './delivery'
import type {
  Annotation, AnnType, AnnPriority, AnnStatus, AnnShape, AnnPoint, AnnVisibility, AnnMeta, AnnLog, AnnNetLog, AnnotateAccess,
} from './types'

export type AnnotateProps = {
  /** Your backend binding — see `annotate-kit/supabase` and `annotate-kit/firebase`, or write your own. */
  adapter: StorageAdapter
  /** Current route path. Pass your router's pathname so marks are page-aware in an SPA.
   *  Omit to read `window.location.pathname` (updates on browser back/forward only). */
  route?: string
  /** Navigate to a path (used by "find on page" across routes). Default: full-page `window.location.assign`.
   *  Pass your router's navigate for smooth SPA jumps. */
  onNavigate?: (path: string) => void
  /** Override the current user (else taken from the adapter's access.me). Used for author attribution. */
  user?: { email?: string; name?: string; role?: string }
  /** Hook the widget's toasts into your app's notifications. Omit for a built-in mini-toast. */
  onToast?: (kind: 'success' | 'error', message: string) => void
  /** How often (ms) to refresh marks while the tool/panel is open. Default 15000. */
  pollMs?: number
  /** Capture a rolling console/JS-error buffer with each mark (secrets may appear in logs).
   *  Default false — opt in only if your team needs console context for bug reports. */
  captureConsole?: boolean
  /** Store the full URL (incl. query string + hash) instead of just origin + pathname.
   *  Default false — query strings often carry tokens/PII. */
  captureFullUrl?: boolean
  /** Capture on-screen element text (target text + surrounding labels) with each mark.
   *  Default true; set false for apps that display sensitive data. */
  captureText?: boolean
  /** Enable bare single-key tool shortcuts (P/B/A/C/D). Default true. Set false to avoid
   *  collisions with the host app's own single-key shortcuts. */
  singleKeyShortcuts?: boolean
  /** Capture a rolling buffer of failed/slow network requests (fetch + XHR) with each mark.
   *  Default false — URLs are trimmed + redacted, but opt in deliberately. */
  captureNetwork?: boolean
  /** Capture a sanitised HTML snapshot of the marked element (scripts/handlers stripped, password
   *  values blanked, truncated). Default false — the DOM can contain sensitive content. */
  captureDomSnapshot?: boolean
  /** Blur password fields and any `[data-annot-redact]` element in screenshots. Default true. */
  redactScreenshots?: boolean
  /** Colour theme for the widget's own panels/dock: 'light' (default), 'dark', or 'auto'
   *  (follows the OS via prefers-color-scheme). Does not affect the host page. */
  theme?: 'light' | 'dark' | 'auto'
  /** Override the brand accent colour (any valid CSS colour, e.g. '#0ea5e9'). Themes buttons, active
   *  tools, links, and highlights. Invalid values are ignored. */
  accent?: string
  /** Redact secrets/PII from captured text + console before it is stored. Return the cleaned
   *  string. Default masks JWTs, bearer tokens, emails, and long digit runs (cards/SSNs). */
  redact?: (text: string) => string
  /** Optional "send to…" targets shown in the Send panel (GitHub issue / webhook / Slack / your own).
   *  Off by default — see the `githubIssueDelivery` / `createWebhookDelivery` / `createSlackDelivery` helpers. */
  deliveries?: Delivery[]
}

type Tool = null | 'pin' | AnnShape
const MODE_ICON: Record<string, typeof MapPin> = { pin: MapPin, rect: Square, arrow: ArrowUpRight, circle: Circle, freehand: Spline }
const cn = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ')
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
// Only ever render a URL we trust into href/src (blocks javascript:/vbscript: stored-XSS).
const safeUrl = (u?: string | null): string | undefined => (u && /^(https?:|blob:|data:image\/(png|jpe?g|gif|webp|avif))/i.test(u) ? u : undefined)
// A stored route is only safe to navigate to if it's a same-origin absolute path (not '//evil.com').
const isSafePath = (p?: string | null): p is string => !!p && /^\/(?!\/)/.test(p)
// A brand accent must be a plain CSS colour before we inject it into a <style> (prevents CSS injection).
const safeColor = (c?: string): string | undefined => (c && /^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d%.,\s/]+\))$/.test(c.trim()) ? c.trim() : undefined)
// Default redactor: mask common secrets/PII in captured text + console before it is persisted.
const defaultRedact = (s: string): string => String(s ?? '')
  .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[redacted-jwt]')
  .replace(/\b(bearer|token|api[_-]?key|secret|password|authorization)\b\s*[:=]?\s*[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [redacted]')
  .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]')
  .replace(/\b(?:\d[ -]?){13,19}\b/g, '[redacted-number]')
// Trap Tab focus inside an open dialog (a11y): focus the first control, cycle Tab within, restore on close.
function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    const SEL = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const list = () => Array.from(el.querySelectorAll<HTMLElement>(SEL)).filter((x) => x.offsetParent !== null)
    const restore = document.activeElement as HTMLElement | null
    const items = list()
    ;(items[0] ?? el).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const f = list()
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    el.addEventListener('keydown', onKey)
    return () => { el.removeEventListener('keydown', onKey); restore?.focus?.() }
  }, [active])
  return ref
}

// If the overlay itself throws while rendering a bad row, degrade to nothing rather than crash the host.
class OverlayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.warn('[annotate] overlay render error', e) }
  render() { return this.state.failed ? null : this.props.children }
}

// ---- module-level capture: environment + a rolling console/JS-error buffer (bug-report context) ----
function captureEnv(fullUrl: boolean): AnnMeta {
  const ua = navigator.userAgent
  const browser = /edg/i.test(ua) ? 'Edge' : /opr|opera/i.test(ua) ? 'Opera' : /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser'
  const os = /windows/i.test(ua) ? 'Windows' : /mac os|macintosh/i.test(ua) ? 'macOS' : /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /linux/i.test(ua) ? 'Linux' : 'OS'
  const device = /mobi/i.test(ua) ? 'Mobile' : /tablet|ipad/i.test(ua) ? 'Tablet' : 'Desktop'
  return { browser, os, device, viewport: `${window.innerWidth}×${window.innerHeight}`, screen: `${window.screen?.width}×${window.screen?.height}`, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, url: fullUrl ? window.location.href : window.location.origin + window.location.pathname, ua: ua.slice(0, 200) }
}
const _logBuf: AnnLog[] = []
let _logHooked = false
// Install the console/JS-error capture — ONLY when the tool is active and the integrator opts in.
// Returns an uninstall fn that restores the original console (no permanent global monkeypatch at import).
function hookConsole(redact: (s: string) => string): () => void {
  if (_logHooked || typeof window === 'undefined') return () => {}
  _logHooked = true
  const fmt = (args: unknown[]) => redact(args.map((a) => typeof a === 'string' ? a : a instanceof Error ? (a.stack || a.message) : (() => { try { return JSON.stringify(a) } catch { return String(a) } })()).join(' ')).slice(0, 500)
  const push = (level: string, args: unknown[]) => { try { _logBuf.push({ level, text: fmt(args), at: new Date().toISOString() }); if (_logBuf.length > 50) _logBuf.shift() } catch { /* ignore */ } }
  const orig = { error: console.error, warn: console.warn }
  const onErr = (e: ErrorEvent) => push('error', [e.message + (e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : '')])
  const onRej = (e: PromiseRejectionEvent) => push('error', ['Unhandled promise rejection: ' + String(e.reason)])
  const errOverride = (...a: unknown[]) => { push('error', a); orig.error(...a) }
  const warnOverride = (...a: unknown[]) => { push('warn', a); orig.warn(...a) }
  console.error = errOverride
  console.warn = warnOverride
  window.addEventListener('error', onErr)
  window.addEventListener('unhandledrejection', onRej)
  return () => {
    _logHooked = false
    _logBuf.length = 0
    if (console.error === errOverride) console.error = orig.error   // don't clobber a wrapper installed after us
    if (console.warn === warnOverride) console.warn = orig.warn
    window.removeEventListener('error', onErr)
    window.removeEventListener('unhandledrejection', onRej)
  }
}
const recentLogs = () => _logBuf.slice(-8)

// ---- module-level network capture (opt-in): rolling buffer of failed/slow fetch + XHR calls ----
const _netBuf: AnnNetLog[] = []
let _netHooked = false
function hookNetwork(redact: (s: string) => string): () => void {
  if (_netHooked || typeof window === 'undefined' || typeof window.fetch !== 'function') return () => {}
  _netHooked = true
  const trim = (u: string) => { try { const x = new URL(u, location.href); return redact(x.origin + x.pathname) } catch { return redact(String(u).slice(0, 200)) } }
  const record = (method: string, url: string, status: number | undefined, ms: number, ok: boolean) => {
    if (ok && status !== undefined && status < 400 && ms < 2000) return   // keep only errors / failures / slow calls
    try { _netBuf.push({ method, url: trim(url), status, ms: Math.round(ms), ok, at: new Date().toISOString() }); if (_netBuf.length > 50) _netBuf.shift() } catch { /* ignore */ }
  }
  const origFetch = window.fetch
  const boundFetch = origFetch.bind(window)
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const start = Date.now()
    const method = (init?.method || (input instanceof Request ? input.method : undefined) || 'GET').toUpperCase()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    try { const res = await boundFetch(input, init); record(method, url, res.status, Date.now() - start, res.ok); return res }
    catch (e) { record(method, url, undefined, Date.now() - start, false); throw e }
  }
  const wrappedFetch = wrapped as typeof window.fetch
  window.fetch = wrappedFetch
  const XHR = window.XMLHttpRequest
  const origOpen = XHR.prototype.open
  const origSend = XHR.prototype.send
  const openOverride = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    ;(this as any).__annot = { method: String(method).toUpperCase(), url: String(url), start: 0 }   // eslint-disable-line @typescript-eslint/no-explicit-any
    return (origOpen as any).call(this, method, url, ...rest)   // eslint-disable-line @typescript-eslint/no-explicit-any
  } as typeof XHR.prototype.open
  const sendOverride = function (this: XMLHttpRequest, ...args: any[]) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const info = (this as any).__annot   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (info) { info.start = Date.now(); this.addEventListener('loadend', () => record(info.method, info.url, this.status || undefined, Date.now() - info.start, this.status >= 200 && this.status < 400), { once: true }) }
    return (origSend as any).apply(this, args)   // eslint-disable-line @typescript-eslint/no-explicit-any
  } as typeof XHR.prototype.send
  XHR.prototype.open = openOverride
  XHR.prototype.send = sendOverride
  return () => {
    _netHooked = false
    _netBuf.length = 0
    if (window.fetch === wrappedFetch) window.fetch = origFetch   // don't clobber a wrapper installed after us
    if (XHR.prototype.open === openOverride) XHR.prototype.open = origOpen
    if (XHR.prototype.send === sendOverride) XHR.prototype.send = origSend
  }
}
const recentNet = () => _netBuf.slice(-8)

// Temporarily blur password fields + [data-annot-redact] elements while a screenshot is captured.
function maskForCapture(): () => void {
  const els = Array.from(document.querySelectorAll<HTMLElement>('input[type="password" i], [data-annot-redact]'))
  const prev = els.map((el) => el.style.filter)
  els.forEach((el) => { el.style.filter = 'blur(10px)' })
  return () => els.forEach((el, i) => { el.style.filter = prev[i] })
}

type Draft = {
  kind: 'pin' | 'shape'; shape_type?: AnnShape
  page_route: string; page_title: string; target_selector: string; target_text: string
  pos_x: number; pos_y: number; x2?: number; y2?: number; points?: AnnPoint[]
  viewport_w: number; viewport_h: number
  note: string; type: AnnType; priority: AnnPriority; color: string; visibility: AnnVisibility; shot: boolean
  styles?: Record<string, string> | null; el_context?: string[] | null; meta?: AnnMeta; console_logs?: AnnLog[]; network_logs?: AnnNetLog[]; dom_snapshot?: string | null
  cx: number; cy: number
}
type Drawing = { shape_type: AnnShape; x: number; y: number; x2: number; y2: number; points: AnnPoint[] } | null

// ---- element identity: a resilient selector + a re-finder so a pin can be relocated on revisit ----
function cssSelector(el: Element | null): string {
  if (!el || el === document.body) return 'body'
  const parts: string[] = []
  let node: Element | null = el
  let depth = 0
  while (node && node.nodeType === 1 && node !== document.body && depth < 6) {
    const h = node as HTMLElement
    if (h.id) { parts.unshift(`#${CSS.escape(h.id)}`); break }
    const stable = h.getAttribute('data-testid') || h.getAttribute('name') || h.getAttribute('aria-label')
    if (stable) { parts.unshift(`${node.tagName.toLowerCase()}[${h.getAttribute('data-testid') ? 'data-testid' : h.getAttribute('name') ? 'name' : 'aria-label'}="${CSS.escape(stable)}"]`); break }
    let part = node.tagName.toLowerCase()
    const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => CSS.escape(c))
    if (cls.length) part += '.' + cls.join('.')
    const parent: Element | null = node.parentElement
    if (parent) {
      const sibs = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = node.parentElement
    depth++
  }
  return parts.join(' > ')
}
const isVisible = (el: Element | null): el is HTMLElement => {
  if (!el) return false
  const r = (el as HTMLElement).getBoundingClientRect()
  return r.width > 0 && r.height > 0
}
function findEl(a: { target_selector?: string; target_text?: string }): HTMLElement | null {
  if (a.target_selector) { try { const el = document.querySelector(a.target_selector); if (isVisible(el)) return el as HTMLElement } catch { /* invalid selector */ } }
  const txt = (a.target_text || '').trim()
  if (txt && txt.length >= 2 && txt.length <= 80) {
    const els = Array.from(document.querySelectorAll('button, a, h1, h2, h3, span, p, td, th, label, div'))
    for (const el of els) { if ((el.textContent || '').replace(/\s+/g, ' ').trim() === txt && isVisible(el) && !el.closest('[data-annot-ui]')) return el as HTMLElement }
  }
  return null
}
const elLabel = (el: HTMLElement): string => {
  const tag = el.tagName.toLowerCase()
  const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36)
  return txt ? `${tag} · “${txt}”` : tag
}
const rgbToHex = (v: string): string => {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v || '')
  if (!m) return v || ''
  if (m[4] !== undefined && Number(m[4]) === 0) return 'transparent'
  const h = (n: string) => Number(n).toString(16).padStart(2, '0')
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`.toUpperCase()
}
function captureStyles(el: HTMLElement): Record<string, string> | null {
  try {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    return { color: rgbToHex(cs.color), background: rgbToHex(cs.backgroundColor), fontSize: cs.fontSize, fontWeight: cs.fontWeight, radius: cs.borderRadius, padding: cs.padding, size: `${Math.round(r.width)}×${Math.round(r.height)}` }
  } catch { return null }
}
function captureContext(el: HTMLElement): string[] {
  const out: string[] = []; let node = el.parentElement; let i = 0
  const own = (el.textContent || '').trim()
  while (node && node.tagName !== 'BODY' && out.length < 3 && i < 12) {
    if (!node.closest('[data-annot-ui]')) {
      const aria = node.getAttribute('aria-label')
      let lbl = aria || ''
      if (!lbl) { const first = (node.textContent || '').trim().split('\n')[0].trim(); if (first.length >= 3 && first.length <= 52) lbl = first }
      if (lbl && lbl !== own && !out.includes(lbl)) out.push(lbl)
    }
    node = node.parentElement; i++
  }
  return out
}

function Highlight({ el, tone = '#6366f1', label }: { el: HTMLElement | null; tone?: string; label?: string }) {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return (
    <div data-annot-ui className="pointer-events-none fixed z-[9996] rounded-md" style={{ left: r.left - 3, top: r.top - 3, width: r.width + 6, height: r.height + 6, boxShadow: `0 0 0 2px ${tone}, 0 0 0 6px ${tone}22`, transition: 'all .08s' }}>
      {label && <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-fg px-1.5 py-0.5 text-[10px] font-medium text-white">{label}</span>}
    </div>
  )
}

function ShapeSvg({ s, dash }: { s: { shape_type?: string | null; pos_x: number; pos_y: number; x2?: number | null; y2?: number | null; points?: AnnPoint[] | null; color?: string | null }; dash?: boolean }) {
  const stroke = s.color || '#6366f1'; const sw = 2.5; const d = dash ? '5 4' : undefined
  const x = s.pos_x, y = s.pos_y, x2 = s.x2 ?? s.pos_x, y2 = s.y2 ?? s.pos_y
  if (s.shape_type === 'rect') return <rect x={Math.min(x, x2)} y={Math.min(y, y2)} width={Math.abs(x2 - x)} height={Math.abs(y2 - y)} rx="5" fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={d} />
  if (s.shape_type === 'circle') return <ellipse cx={(x + x2) / 2} cy={(y + y2) / 2} rx={Math.abs(x2 - x) / 2} ry={Math.abs(y2 - y) / 2} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={d} />
  if (s.shape_type === 'arrow') {
    const mid = `annarr-${Math.round(x)}-${Math.round(y)}`
    return (<>
      <defs><marker id={mid} markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={stroke} /></marker></defs>
      <line x1={x} y1={y} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw + 0.5} strokeDasharray={d} markerEnd={`url(#${mid})`} />
    </>)
  }
  return <polyline points={(Array.isArray(s.points) ? s.points : []).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={d} />
}

const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium'

export function Annotate({ adapter, route, onNavigate, user, onToast, pollMs = 15_000, captureConsole = false, captureFullUrl = false, captureText = true, singleKeyShortcuts = true, captureNetwork = false, captureDomSnapshot = false, redactScreenshots = true, theme = 'light', accent, redact, deliveries = [] }: AnnotateProps) {
  // --- route + navigation (framework-agnostic) ---
  const [browserPath, setBrowserPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'))
  useEffect(() => {
    if (route !== undefined) return
    const on = () => setBrowserPath(window.location.pathname)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [route])
  const pathname = route ?? browserPath
  const navigate = useCallback((p: string) => { if (onNavigate) onNavigate(p); else window.location.assign(p) }, [onNavigate])
  const redactFn = useCallback((s: string) => (redact ? redact(s) : defaultRedact(s)), [redact])
  const accentCss = safeColor(accent)

  // --- built-in mini-toast (used only when onToast is not supplied) ---
  const [toasts, setToasts] = useState<{ id: number; kind: 'success' | 'error'; msg: string }[]>([])
  const toastSeq = useRef(0)
  const toast = useCallback((kind: 'success' | 'error', msg: string) => {
    if (onToast) { onToast(kind, msg); return }
    const id = ++toastSeq.current
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600)
  }, [onToast])

  // --- access + identity (from the adapter) ---
  const [access, setAccessData] = useState<AnnotateAccess | null>(null)
  const [accessLoading, setAccessLoading] = useState(true)
  const [accessBusy, setAccessBusy] = useState(false)
  const refreshAccess = useCallback(async () => {
    try { setAccessData(await adapter.getAccess()) } catch (e) { console.warn('[annotate] getAccess failed', e) } finally { setAccessLoading(false) }
  }, [adapter])
  useEffect(() => { refreshAccess() }, [refreshAccess])
  const canUse = !!access?.canUse
  const isAdmin = !!access?.isAdmin
  const seeAll = !!access?.seeAll
  const enabled = !!access?.enabled
  const me = user ?? access?.me ?? {}
  const meEmail = me.email || ''
  const meName = me.name || me.email || 'me'

  // Console/JS-error capture is installed lazily — only when the tool is usable AND opted in — and
  // torn down on cleanup. No global console monkeypatch happens at import time.
  useEffect(() => {
    if (!canUse || !captureConsole) return
    return hookConsole(redactFn)
  }, [canUse, captureConsole, redactFn])

  // Network capture — same lazy, opt-in, cleaned-up-on-unmount treatment as the console hook.
  useEffect(() => {
    if (!canUse || !captureNetwork) return
    return hookNetwork(redactFn)
  }, [canUse, captureNetwork, redactFn])

  const [tool, setTool] = useState<Tool>(null)
  const [color, setColor] = useState(ANN_COLORS[0])
  const [panel, setPanel] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drawing, setDrawing] = useState<Drawing>(null)
  const [active, setActive] = useState<Annotation | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const [flashId, setFlashId] = useState<number | null>(null)
  const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null)
  const [filter, setFilter] = useState<'all' | AnnStatus>('all')
  const [typeFilter, setTypeFilter] = useState<'' | AnnType>('')
  const [prioFilter, setPrioFilter] = useState<'' | AnnPriority>('')
  const [thisPageOnly, setThisPageOnly] = useState(false)
  const [authorFilter, setAuthorFilter] = useState('')
  const [search, setSearch] = useState('')
  const [reply, setReply] = useState('')
  const [peek, setPeek] = useState(false)
  const [shotBusy, setShotBusy] = useState(false)
  const [markupBlob, setMarkupBlob] = useState<Blob | null>(null)
  const [delivering, setDelivering] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const sendTrap = useFocusTrap(sendOpen)
  const helpTrap = useFocusTrap(helpOpen)
  const panelTrap = useFocusTrap(panel)
  const [editRow, setEditRow] = useState<number | null>(null)
  const [hintSeen, setHintSeen] = useState(() => { try { return localStorage.getItem('annot-hint') === '1' } catch { return true } })
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const p = JSON.parse(localStorage.getItem('annot-pos') || 'null')
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        const mx = (typeof window !== 'undefined' ? window.innerWidth : 9999) - 64
        const my = (typeof window !== 'undefined' ? window.innerHeight : 9999) - 64
        return { x: Math.min(Math.max(4, p.x), mx), y: Math.min(Math.max(4, p.y), my) }
      }
    } catch { /* ignore */ }
    return null
  })

  const draftElRef = useRef<HTMLElement | null>(null)
  const hoverRef = useRef<HTMLElement | null>(null)
  const drawRef = useRef<Drawing>(null)
  const undoStackRef = useRef<number[]>([])

  // --- annotations list (plain state + polling while the tool/panel is open) ---
  const [all, setAll] = useState<Annotation[]>([])
  const refresh = useCallback(async () => {
    try { setAll(await adapter.list()) } catch (e) { console.warn('[annotate] list failed', e) }
  }, [adapter])
  const invalidate = refresh
  useEffect(() => { if (canUse) refresh() }, [canUse, refresh])
  // realtime subscription (adapters that support it) — NOT re-run on tool/panel toggles.
  // Backstop is a refresh when the tab regains focus (no continuous polling while idle).
  useEffect(() => {
    if (!canUse || !adapter.subscribe) return
    const un = adapter.subscribe(() => { refresh() })
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { un(); document.removeEventListener('visibilitychange', onVis) }
  }, [canUse, adapter, refresh])
  // fallback poll while the tool/panel is open (only for adapters without realtime)
  useEffect(() => {
    if (!canUse || adapter.subscribe || !(tool || panel)) return
    const id = setInterval(refresh, pollMs)
    return () => clearInterval(id)
  }, [canUse, tool, panel, pollMs, refresh, adapter])

  const openCount = all.filter((a) => OPEN_STATUSES.includes(a.status)).length

  const marksShown = !peek && (!!tool || panel || flashId != null)
  const pageMarks = useMemo(() => all.filter((a) => a.page_route === pathname && (OPEN_STATUSES.includes(a.status) || a.id === flashId)), [all, pathname, flashId])
  // Resolve each visible pin's element ONCE per frame (keyed on scroll/resize tick) instead of
  // re-running findEl (with its querySelectorAll fallback) on every render for every mark.
  const markEls = useMemo(() => {
    const m = new Map<number, HTMLElement | null>()
    for (const a of pageMarks) m.set(a.id, a.kind === 'shape' ? null : findEl(a))
    return m
  }, [pageMarks, tick, pathname])   // eslint-disable-line react-hooks/exhaustive-deps

  const dismissHint = () => { setHintSeen(true); try { localStorage.setItem('annot-hint', '1') } catch { /* ignore */ } }

  // ---- PIN tool ----
  useEffect(() => {
    if (tool !== 'pin') { if (tool === null) { setHoverEl(null); hoverRef.current = null } return }
    document.body.style.cursor = 'crosshair'
    const onMove = (e: MouseEvent) => {
      if (draftElRef.current) return
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const t = el && !el.closest('[data-annot-ui]') ? el : null
      if (t !== hoverRef.current) { hoverRef.current = t; setHoverEl(t) }
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element
      if (t.closest('[data-annot-ui]')) return
      e.preventDefault(); e.stopPropagation()
      const el = t as HTMLElement
      draftElRef.current = el; setHoverEl(el); setActive(null)
      setDraft({
        kind: 'pin', page_route: pathname, page_title: document.title || pathname,
        target_selector: cssSelector(el), target_text: captureText ? redactFn((el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)) : '',
        pos_x: Math.round(e.pageX), pos_y: Math.round(e.pageY), viewport_w: window.innerWidth, viewport_h: window.innerHeight,
        note: '', type: 'change', priority: 'med', color, visibility: 'private', shot: false,
        styles: captureStyles(el), el_context: captureText ? captureContext(el).map(redactFn) : [], meta: captureEnv(captureFullUrl), console_logs: captureConsole ? recentLogs() : [], network_logs: captureNetwork ? recentNet() : [], dom_snapshot: captureDomSnapshot ? redactFn(sanitizeSnapshot(el.outerHTML)) : null,
        cx: e.clientX, cy: e.clientY,
      })
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('click', onClick, true)
    return () => { document.body.style.cursor = ''; document.removeEventListener('mousemove', onMove, true); document.removeEventListener('click', onClick, true) }
  }, [tool, pathname, color, isAdmin, canUse, captureText, captureFullUrl, captureConsole, captureNetwork, captureDomSnapshot, redactFn])

  // ---- SHAPE tools ----
  useEffect(() => {
    if (!tool || tool === 'pin') return
    document.body.style.cursor = 'crosshair'
    const prevTouch = document.body.style.touchAction
    document.body.style.touchAction = 'none'
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest?.('[data-annot-ui]')) return
      e.preventDefault(); e.stopPropagation()
      const start: Drawing = { shape_type: tool, x: e.pageX, y: e.pageY, x2: e.pageX, y2: e.pageY, points: [{ x: e.pageX, y: e.pageY }] }
      drawRef.current = start; setDrawing(start); setActive(null)
    }
    const onMove = (e: PointerEvent) => {
      const d = drawRef.current; if (!d) return
      e.preventDefault()
      const next: Drawing = tool === 'freehand'
        ? { ...d, x2: e.pageX, y2: e.pageY, points: (Math.hypot(e.pageX - d.points[d.points.length - 1].x, e.pageY - d.points[d.points.length - 1].y) > 3 ? [...d.points, { x: e.pageX, y: e.pageY }] : d.points) }
        : { ...d, x2: e.pageX, y2: e.pageY }
      drawRef.current = next; setDrawing(next)
    }
    const onUp = (e: PointerEvent) => {
      const d = drawRef.current; drawRef.current = null; setDrawing(null)
      if (!d) return
      const w = Math.abs(d.x2 - d.x), h = Math.abs(d.y2 - d.y)
      if (d.shape_type === 'freehand' ? d.points.length < 3 : (w < 8 && h < 8)) return
      const anchor = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      setDraft({
        kind: 'shape', shape_type: d.shape_type, page_route: pathname, page_title: document.title || pathname,
        target_selector: anchor && !anchor.closest('[data-annot-ui]') ? cssSelector(anchor) : '', target_text: '',
        pos_x: Math.round(d.x), pos_y: Math.round(d.y), x2: Math.round(d.x2), y2: Math.round(d.y2), points: d.shape_type === 'freehand' ? d.points : undefined,
        viewport_w: window.innerWidth, viewport_h: window.innerHeight,
        note: '', type: 'change', priority: 'med', color, visibility: 'private', shot: false,
        meta: captureEnv(captureFullUrl), console_logs: captureConsole ? recentLogs() : [], network_logs: captureNetwork ? recentNet() : [], cx: e.clientX, cy: e.clientY,
      })
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointermove', onMove, { capture: true, passive: false })
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onUp, true)
    return () => {
      document.body.style.cursor = ''; document.body.style.touchAction = prevTouch
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointermove', onMove, { capture: true } as EventListenerOptions)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onUp, true)
      drawRef.current = null; setDrawing(null)
    }
  }, [tool, pathname, color, isAdmin, canUse, captureText, captureFullUrl, captureConsole, captureNetwork, captureDomSnapshot, redactFn])

  useEffect(() => {
    if (!canUse) return
    let raf = 0
    const on = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; setTick((x) => x + 1) }) }
    window.addEventListener('scroll', on, true); window.addEventListener('resize', on)
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on) }
  }, [canUse])

  useEffect(() => {
    if (!canUse) return   // never attach global key handlers for a viewer who can't use the tool
    const h = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as Element)?.tagName || '') || (e.target as HTMLElement)?.isContentEditable
      if (e.key === 'Escape') { if (helpOpen) setHelpOpen(false); else if (sendOpen) setSendOpen(false); else if (draft) closeDraft(); else if (panel) setPanel(false); else if (tool) setTool(null); return }
      if (typing) return
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undoLast(); return }
      if (e.key === '?') { e.preventDefault(); setHelpOpen((v) => !v); return }
      if (e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); setPeek((v) => !v); return }
      if (e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); setTool((m) => (m === 'pin' ? null : 'pin')); return }
      if (!singleKeyShortcuts) return   // bare-letter tool hotkeys are opt-out (avoid host-app collisions)
      const map: Record<string, Tool> = { p: 'pin', b: 'rect', a: 'arrow', c: 'circle', d: 'freehand' }
      const t = map[e.key.toLowerCase()]
      if (t && !e.shiftKey && !meta) { e.preventDefault(); setTool((cur) => (cur === t ? null : t)) }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [tool, draft, helpOpen, sendOpen, panel, canUse, singleKeyShortcuts])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (active) { const f = all.find((a) => a.id === active.id); if (f && f !== active) setActive(f) } }, [all])   // eslint-disable-line react-hooks/exhaustive-deps

  async function uploadShot(el: HTMLElement, visibility: AnnVisibility): Promise<string | null> {
    const unmask = redactScreenshots ? maskForCapture() : () => {}
    let blob: Blob | null = null
    try { blob = await domToBlob(el, { backgroundColor: '#ffffff', scale: 2, quality: 0.95, style: { margin: '0' } }) }
    catch (e) { console.warn('[annotate] screenshot failed', e) }
    finally { unmask() }
    try {
      if (!blob) return null
      const shot = new File([blob], 'shot.png', { type: blob.type || 'image/png' })
      const { path } = await adapter.uploadScreenshot(shot, { visibility })
      return path
    } catch (e) { console.warn('[annotate] screenshot failed', e); return null }
  }

  async function captureBlob(full: boolean): Promise<Blob | null> {
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)))
    const target = full ? document.body : document.documentElement
    const pageW = full ? Math.max(document.documentElement.scrollWidth, window.innerWidth) : window.innerWidth
    const pageH = full ? Math.max(document.documentElement.scrollHeight, window.innerHeight) : window.innerHeight
    let scale = Math.min(2, window.devicePixelRatio || 1)
    // stay under browser canvas limits — cap total area AND each dimension (~16k px hard cap)
    while (scale > 0.5 && (pageW * pageH * scale * scale > 24_000_000 || pageW * scale > 16000 || pageH * scale > 16000)) scale -= 0.5
    const unmask = redactScreenshots ? maskForCapture() : () => {}
    try {
      return await domToBlob(target, {
        backgroundColor: '#ffffff', scale,
        width: full ? undefined : window.innerWidth, height: full ? undefined : window.innerHeight,
        filter: (n: Node) => !(n instanceof HTMLElement && n.hasAttribute('data-annot-ui')),
      })
    } finally { unmask() }
  }

  async function startMarkup() {
    if (shotBusy) return
    setShotBusy(true)
    try {
      const blob = await captureBlob(false)
      if (!blob) throw new Error('capture failed')
      setMarkupBlob(blob)
    } catch (e) { toast('error', errMsg(e) || 'Capture failed') } finally { setShotBusy(false) }
  }

  async function capturePage(full: boolean) {
    if (shotBusy) return
    setShotBusy(true)
    try {
      const blob = await captureBlob(full)
      if (!blob) throw new Error('capture failed')
      const canClip = !!navigator.clipboard && typeof window.ClipboardItem === 'function'
      if (canClip) { try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]); toast('success', `${full ? 'Full page' : 'Viewport'} copied — paste anywhere`); return } catch { /* download */ } }
      const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = `screenshot-${full ? 'fullpage' : 'viewport'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 500)
      toast('success', 'Screenshot downloaded')
    } catch (e) { toast('error', errMsg(e) || 'Screenshot failed') } finally { setShotBusy(false) }
  }

  const submitDraft = async () => {
    if (!draft) return
    if (draft.kind === 'pin' && !draft.note.trim()) return
    setBusy(true)
    try {
      let screenshot_path: string | null = null
      if (draft.shot && draftElRef.current) { screenshot_path = await uploadShot(draftElRef.current, draft.visibility); if (!screenshot_path) toast('error', 'Screenshot failed — saved without it') }
      const { cx: _cx, cy: _cy, shot: _shot, ...body } = draft   // eslint-disable-line @typescript-eslint/no-unused-vars
      const saved = await adapter.save({ ...body, screenshot_path })
      if (saved?.id) { undoStackRef.current.push(saved.id); if (undoStackRef.current.length > 30) undoStackRef.current.shift() }
      invalidate(); closeDraft(); dismissHint(); toast('success', 'Saved ✓')
    } catch (e) { toast('error', errMsg(e)) } finally { setBusy(false) }
  }
  const closeDraft = () => { setDraft(null); draftElRef.current = null; setHoverEl(null) }

  const doUpdate = (patch: { id: number } & Record<string, unknown>) => adapter.update(patch as never).then(invalidate).catch((e) => toast('error', errMsg(e)))
  const doDelete = (id: number) => adapter.remove(id).then(() => { invalidate(); setActive(null); toast('success', 'Deleted') }).catch((e) => toast('error', errMsg(e)))
  const doAddReply = (id: number, note: string) => adapter.addReply(id, note).then(() => { invalidate(); setReply(''); toast('success', 'Reply added') }).catch((e) => toast('error', errMsg(e)))
  const doClearResolved = () => adapter.clearResolved().then((r) => { invalidate(); toast('success', r?.message || 'Cleared') }).catch((e) => toast('error', errMsg(e)))
  const toggleAccess = async (next: boolean) => {
    setAccessBusy(true)
    try { const r = await adapter.setAccess(next); await refreshAccess(); toast('success', r?.message || 'Saved') }
    catch (e) { toast('error', errMsg(e)) } finally { setAccessBusy(false) }
  }

  const undoLast = () => { const id = undoStackRef.current.pop(); if (id) doDelete(id) }

  const jumpTo = (a: Annotation) => {
    const go = () => {
      const el = findEl(a)
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHoverEl(el) }
      else window.scrollTo({ top: Math.max(0, a.pos_y - 140), behavior: 'smooth' })
      setActive(a); setFlashId(a.id); setTimeout(() => setFlashId(null), 4000)
    }
    if (a.page_route !== pathname && isSafePath(a.page_route)) { setPanel(false); navigate(a.page_route); setTimeout(go, 400) } else go()
  }

  const copyPrompt = async (items: Annotation[]) => { try { await navigator.clipboard.writeText(buildDevPrompt(items)); toast('success', `Copied ${items.length} mark(s) — paste to your developer`) } catch { toast('error', 'Clipboard blocked — use Download') } }
  const downloadMd = (items: Annotation[]) => {
    const blob = new Blob([buildDevPrompt(items)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `annotations-${new Date().toISOString().slice(0, 10)}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const doDeliver = async (d: Delivery) => {
    if (delivering || !d.run) return
    setDelivering(true)
    try { await d.run(openItems); toast('success', `Sent to ${d.label}`); setSendOpen(false) }
    catch (e) { toast('error', errMsg(e)) } finally { setDelivering(false) }
  }

  const canEdit = (a: Annotation) => seeAll || a.created_by === meEmail || a.created_by === meName
  const listed = useMemo(() => {
    let r = all
    if (thisPageOnly) r = r.filter((a) => a.page_route === pathname)
    if (filter !== 'all') r = r.filter((a) => a.status === filter)
    if (typeFilter) r = r.filter((a) => a.type === typeFilter)
    if (prioFilter) r = r.filter((a) => a.priority === prioFilter)
    if (authorFilter) r = r.filter((a) => (a.created_by || '') === authorFilter)
    const q = search.trim().toLowerCase()
    if (q) r = r.filter((a) => (a.note + a.page_route + a.target_text + (a.created_by_name || '')).toLowerCase().includes(q))
    return [...r].sort((a, b) => b.id - a.id)
  }, [all, thisPageOnly, filter, typeFilter, prioFilter, authorFilter, search, pathname])
  const grouped = useMemo(() => {
    const m = new Map<string, Annotation[]>()
    for (const a of listed) { const k = a.page_route; if (!m.has(k)) m.set(k, []); m.get(k)!.push(a) }
    return [...m.entries()]
  }, [listed])
  const openItems = all.filter((a) => OPEN_STATUSES.includes(a.status))
  const authors = useMemo(() => { const m = new Map<string, string>(); for (const a of all) if (a.created_by) m.set(a.created_by, a.created_by_name || a.created_by); return [...m.entries()] }, [all])
  const anyFilter = filter !== 'all' || !!typeFilter || !!prioFilter || !!authorFilter || thisPageOnly || !!search.trim()

  const beginDrag = (e: ReactPointerEvent, onTap?: () => void) => {
    e.preventDefault()
    const el = (e.currentTarget as HTMLElement); const rect = el.getBoundingClientRect()
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top, sx = e.clientX, sy = e.clientY
    let moved = false
    const onMove = (ev: PointerEvent) => { if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return; moved = true; setPos({ x: Math.min(Math.max(4, ev.clientX - offX), window.innerWidth - 64), y: Math.min(Math.max(4, ev.clientY - offY), window.innerHeight - 64) }) }
    const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); if (moved) setPos((p) => { if (p) { try { localStorage.setItem('annot-pos', JSON.stringify(p)) } catch { /* ignore */ } } return p }); else onTap?.() }
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp)
  }

  if (accessLoading || !canUse) return null

  const highlightEl = draft?.kind === 'pin' ? draftElRef.current : (hoverEl || (active && active.page_route === pathname ? (markEls.get(active.id) ?? findEl(active)) : null))
  const highlightTone = draft ? annDot(draft.type) : active ? annDot(active.type) : '#6366f1'
  const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth)
  const docH = Math.max(document.documentElement.scrollHeight, window.innerHeight)
  const fabStyle: CSSProperties = pos ? { position: 'fixed', left: pos.x, top: pos.y } : { position: 'fixed', right: 20, bottom: 20 }

  return createPortal(
    <OverlayBoundary key={pathname}>
    {accentCss && <style data-annot-ui>{`[data-annot-ui],[data-annot-ui][data-annot-theme="dark"],[data-annot-theme="dark"] [data-annot-ui]{--color-brand:${accentCss};--color-brand-strong:${accentCss};--color-brand-tint:color-mix(in srgb, ${accentCss} 14%, transparent);--color-brand-hairline:color-mix(in srgb, ${accentCss} 32%, transparent);}`}</style>}
    <div data-annot-ui data-annot-theme={theme}>
      <Highlight el={highlightEl} tone={highlightTone} label={highlightEl ? elLabel(highlightEl) : undefined} />

      {marksShown && (
        <svg width={docW} height={docH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', zIndex: 9994, pointerEvents: 'none' }}>
          {pageMarks.filter((m) => m.kind === 'shape').map((s) => <ShapeSvg key={s.id} s={s} />)}
          {draft?.kind === 'shape' && <ShapeSvg s={{ ...draft, color: draft.color }} dash />}
        </svg>
      )}
      {drawing && (
        <svg width={docW} height={docH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', zIndex: 9994, pointerEvents: 'none' }}>
          <ShapeSvg s={{ shape_type: drawing.shape_type, pos_x: drawing.x, pos_y: drawing.y, x2: drawing.x2, y2: drawing.y2, points: drawing.points, color }} dash />
        </svg>
      )}

      {marksShown && pageMarks.map((a, i) => {
        const el = markEls.get(a.id) ?? null
        const r = el?.getBoundingClientRect()
        const left = r ? r.left : a.pos_x - window.scrollX
        const top = r ? r.top : a.pos_y - window.scrollY
        const lost = a.kind !== 'shape' && !el
        return (
          <button key={a.id} type="button" data-annot-ui
            onMouseEnter={() => el && setHoverEl(el)} onMouseLeave={() => tool !== 'pin' && setHoverEl(null)}
            onClick={(e) => { e.stopPropagation(); setActive(a); closeDraft() }}
            title={`${a.note || annShapeLabel(a.shape_type)}${lost ? '  (element moved)' : ''}`}
            className={cn('fixed z-[9997] grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[11px] font-bold text-white shadow-md ring-2 ring-white', a.id === flashId && 'animate-bounce ring-4 ring-warning', lost && 'opacity-70')}
            style={{ left, top, background: a.color || annDot(a.type) }}>{i + 1}</button>
        )
      })}

      {/* ---------------- floating tool dock ---------------- */}
      <div style={fabStyle} className="z-[9998]">
        {tool === null && !panel ? (
          <div className="flex flex-col items-end gap-2">
            {!hintSeen && (
              <div data-annot-ui className="max-w-[220px] rounded-card bg-fg px-3 py-2 text-[11px] text-white shadow-e4">
                <b>Feedback tool</b> — tap here, then click any element or draw to leave a note for the developer.
                <button type="button" onClick={dismissHint} className="mt-1 block text-[10px] font-semibold text-brand-strong">Got it</button>
              </div>
            )}
            <button type="button" data-annot-ui aria-label="Open feedback tool" onPointerDown={(e) => beginDrag(e, () => setTool('pin'))} title="Annotate · drag to move · Shift+A" style={{ touchAction: 'none' }}
              className="relative grid h-12 w-12 place-items-center rounded-full bg-fg text-white shadow-e4 transition hover:bg-ink-hover cursor-grab active:cursor-grabbing">
              <MessageSquarePlus size={20} />
              {openCount > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-white ring-2 ring-white">{openCount}</span>}
            </button>
          </div>
        ) : (
          <div data-annot-ui className="w-[252px] overflow-hidden rounded-card border border-line bg-surface shadow-e4">
            <div className="flex items-center gap-1 bg-fg px-2 py-1.5 text-white">
              <button type="button" onPointerDown={(e) => beginDrag(e)} title="Drag" style={{ touchAction: 'none' }} className="cursor-grab p-1 text-fg-disabled hover:text-white active:cursor-grabbing"><GripVertical size={14} /></button>
              <span className="flex-1 truncate text-[12px] font-bold">Feedback ({all.length})</span>
              <button type="button" onClick={() => setPeek((v) => !v)} title={peek ? 'Show marks (Shift+H)' : 'Hide marks (Shift+H)'} className="rounded p-1 text-fg-disabled hover:bg-ink-hover hover:text-white">{peek ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              <button type="button" onClick={undoLast} title="Undo (Ctrl+Z)" className="rounded p-1 text-fg-disabled hover:bg-ink-hover hover:text-white"><Undo2 size={15} /></button>
              <button type="button" onClick={() => capturePage(false)} disabled={shotBusy} title="Viewport screenshot" className="rounded p-1 text-fg-disabled hover:bg-ink-hover hover:text-white disabled:opacity-40"><Camera size={15} className={shotBusy ? 'animate-pulse' : ''} /></button>
              <button type="button" onClick={() => capturePage(true)} disabled={shotBusy} title="Full-page screenshot" className="rounded p-1 text-fg-disabled hover:bg-ink-hover hover:text-white disabled:opacity-40"><Maximize2 size={15} className={shotBusy ? 'animate-pulse' : ''} /></button>
              <button type="button" onClick={startMarkup} disabled={shotBusy} title="Screenshot & mark up" className="rounded p-1 text-fg-disabled hover:bg-ink-hover hover:text-white disabled:opacity-40"><Highlighter size={15} className={shotBusy ? 'animate-pulse' : ''} /></button>
              <button type="button" onClick={() => setHelpOpen(true)} title="Shortcuts (?)" className="rounded p-1 text-fg-disabled hover:bg-ink-hover hover:text-white"><Keyboard size={15} /></button>
              <button type="button" onClick={() => { setTool(null); closeDraft() }} title="Close" className="rounded p-1 text-fg-disabled hover:bg-ink-hover hover:text-white"><X size={15} /></button>
            </div>
            <div className="space-y-2 p-2">
              <div className="grid grid-cols-5 gap-1">
                {ANN_MODES.map((m) => {
                  const Ico = MODE_ICON[m.key]; const on = tool === m.key
                  return (
                    <button key={m.key} type="button" title={`${m.label} (${m.kbd})`} onClick={() => setTool(on ? null : (m.key as Tool))}
                      className={cn('flex flex-col items-center gap-0.5 rounded-input border py-1.5 transition', on ? 'border-brand bg-brand text-white' : 'border-line text-fg-muted hover:bg-row-alt')}>
                      <Ico size={15} /><span className="text-[9px] font-bold">{m.label}</span>
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-1.5">
                {ANN_COLORS.map((c) => (<button key={c} type="button" onClick={() => setColor(c)} style={{ background: c }} title="Colour" className={cn('h-5 w-5 rounded-full border-2 transition', color === c ? 'scale-110 border-fg-secondary' : 'border-line')} />))}
                {peek && <span className="ml-auto rounded bg-warning-tint px-1.5 py-0.5 text-[10px] font-bold text-warning-text ring-1 ring-warning-hairline">Peek</span>}
              </div>
              {tool && (<div className="flex items-center gap-1.5 rounded-input bg-brand-tint px-2 py-1 text-[11px] font-semibold text-brand-strong ring-1 ring-brand-hairline"><Crosshair size={12} /> {tool === 'pin' ? 'Hover an element & click' : 'Drag to draw'} <span className="ml-auto text-brand-strong">Esc</span></div>)}
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setPanel(true)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-input border border-line py-1.5 text-[12px] font-bold text-fg-secondary hover:bg-row-alt"><ListChecks size={14} /> Review</button>
                <button type="button" onClick={() => setSendOpen(true)} disabled={!openItems.length} className="inline-flex flex-1 items-center justify-center gap-1 rounded-input bg-fg py-1.5 text-[12px] font-bold text-white hover:bg-ink-hover disabled:opacity-40"><Send size={14} /> Send</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- draft (create) popover ---------------- */}
      {draft && (
        <div data-annot-ui className="fixed z-[9999] w-[19rem] rounded-card border border-line bg-surface p-3.5 shadow-e4"
          style={{ left: Math.min(draft.cx, window.innerWidth - 320), top: Math.min(Math.max(12, draft.cy + 14), window.innerHeight - 380) }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-fg-secondary">{draft.kind === 'shape' ? `New ${annShapeLabel(draft.shape_type)} mark` : 'New annotation'}</span>
            <button type="button" onClick={closeDraft} className="text-fg-muted hover:text-fg-secondary"><X size={16} /></button>
          </div>
          {(draft.target_text || draft.target_selector) && (
            <p className="mb-1.5 flex items-center gap-1 truncate rounded-input bg-brand-tint px-2 py-1 text-[11px] font-medium text-brand-strong" title={draft.target_selector}><Target size={12} className="shrink-0" /> {draft.target_text ? `“${draft.target_text.slice(0, 38)}”` : draft.target_selector}</p>
          )}
          {/* captured context chip */}
          <div className="mb-2 flex flex-wrap gap-1 text-[10px] text-fg-muted">
            {draft.styles?.size && <span className={cn(chip, 'bg-sunken')}>{draft.styles.size}px</span>}
            {draft.styles?.color && <span className={cn(chip, 'bg-sunken')}><span className="h-2 w-2 rounded-full" style={{ background: draft.styles.color }} /> text</span>}
            {draft.meta && <span className={cn(chip, 'bg-sunken')}><Monitor size={10} /> {draft.meta.browser} · {draft.meta.viewport}</span>}
            {!!draft.console_logs?.length && <span className={cn(chip, 'bg-danger-tint text-danger-text')}><TerminalSquare size={10} /> {draft.console_logs.length} log</span>}
            {!!draft.network_logs?.length && <span className={cn(chip, 'bg-warning-tint text-warning-text')}><Globe size={10} /> {draft.network_logs.length} net</span>}
          </div>
          <textarea autoFocus rows={3} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitDraft() }}
            placeholder={draft.kind === 'shape' ? 'What about this area? (optional)' : 'What should change here?'}
            className="w-full resize-none rounded-input border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/25" />
          <div className="mt-2 flex flex-wrap gap-1">
            {ANN_TYPES.map((t) => (<button key={t.key} type="button" onClick={() => setDraft({ ...draft, type: t.key })} className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition', draft.type === t.key ? 'bg-fg text-white ring-fg' : 'bg-surface text-fg-muted ring-line hover:bg-row-alt')}><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />{t.label}</button>))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex gap-1">
              {ANN_PRIORITIES.map((pr) => (<button key={pr.key} type="button" onClick={() => setDraft({ ...draft, priority: pr.key })} className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 transition', draft.priority === pr.key ? (pr.key === 'high' ? 'bg-danger text-white ring-danger' : pr.key === 'med' ? 'bg-warning text-white ring-warning' : 'bg-fg-disabled text-white ring-fg-disabled') : 'bg-surface text-fg-muted ring-line hover:bg-row-alt')}>{pr.label}</button>))}
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => setDraft({ ...draft, visibility: draft.visibility === 'private' ? 'public' : 'private' })} title={draft.visibility === 'private' ? 'Only you see this' : 'Shared'} className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', draft.visibility === 'private' ? 'bg-surface text-fg-muted ring-line' : 'bg-success-tint text-success-text ring-success-hairline')}>{draft.visibility === 'private' ? <Lock size={11} /> : <Globe size={11} />}{draft.visibility === 'private' ? 'Private' : 'Public'}</button>
              {draft.kind === 'pin' && <button type="button" onClick={() => setDraft({ ...draft, shot: !draft.shot })} title="Attach element screenshot" className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', draft.shot ? 'bg-success-tint text-success-text ring-success-hairline' : 'bg-surface text-fg-muted ring-line')}><Camera size={11} />{draft.shot ? 'Shot' : 'No shot'}</button>}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] text-fg-disabled">⌘/Ctrl+Enter</span>
            <div className="flex gap-2">
              <button type="button" onClick={closeDraft} className="rounded-input px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-sunken">Cancel</button>
              <button type="button" onClick={submitDraft} disabled={busy || (draft.kind === 'pin' && !draft.note.trim())} className="inline-flex items-center gap-1 rounded-input bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : <><Check size={13} /> Save</>}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- detail popover ---------------- */}
      {active && (
        <div data-annot-ui className="fixed bottom-24 right-5 z-[9999] max-h-[75vh] w-[22rem] overflow-y-auto rounded-card border border-line bg-surface p-4 shadow-e4">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold text-fg-secondary"><span className="h-2.5 w-2.5 rounded-full" style={{ background: active.color || annDot(active.type) }} /> {active.kind === 'shape' ? `${annShapeLabel(active.shape_type)} · ` : ''}{annTypeLabel(active.type)}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => jumpTo(active)} title="Find on page" className="rounded p-1 text-fg-muted hover:bg-brand-tint hover:text-brand-strong"><Target size={15} /></button>
              {canEdit(active) && <button type="button" onClick={() => doDelete(active.id)} title="Delete" className="rounded p-1 text-fg-muted hover:bg-danger-tint hover:text-danger-text"><Trash2 size={15} /></button>}
              <button type="button" onClick={() => setActive(null)} className="rounded p-1 text-fg-muted hover:bg-sunken"><X size={16} /></button>
            </div>
          </div>
          <p className="mb-1 truncate text-[11px] text-fg-muted" title={active.target_selector}>{active.page_route} · {active.target_text || active.target_selector || annShapeLabel(active.shape_type)}</p>
          <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
            <span className="font-semibold text-fg-secondary">{active.created_by_name || active.created_by || '—'}</span>
            {active.created_by_role && <span className="rounded bg-sunken px-1.5 text-[10px] font-medium text-fg-muted">{active.created_by_role}</span>}
            {active.visibility === 'private' && <Lock size={11} className="text-fg-muted" />}
            {active.meta && <span className={cn(chip, 'bg-sunken')}><Monitor size={10} /> {active.meta.browser} · {active.meta.os} · {active.meta.viewport}</span>}
          </p>
          {canEdit(active)
            ? <textarea rows={2} defaultValue={active.note} key={active.id} onBlur={(e) => { if (e.target.value !== active.note) doUpdate({ id: active.id, note: e.target.value }) }} placeholder="Add a note…" className="w-full resize-none rounded-input border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            : <p className="rounded-input bg-sunken px-3 py-2 text-sm text-fg-secondary">{active.note || <span className="italic text-fg-muted">(no note)</span>}</p>}
          {canEdit(active) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {ANN_STATUSES.map((st) => (<button key={st.key} type="button" onClick={() => doUpdate({ id: active.id, status: st.key })} className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition', active.status === st.key ? (st.key === 'done' ? 'bg-success text-white ring-success' : st.key === 'dismissed' ? 'bg-fg-disabled text-white ring-fg-disabled' : st.key === 'in_progress' ? 'bg-warning text-white ring-warning' : 'bg-brand text-white ring-brand') : 'bg-surface text-fg-muted ring-line hover:bg-row-alt')}>{st.label}</button>))}
            </div>
          )}
          {!!active.console_logs?.length && (
            <details className="mt-2 rounded-input bg-fg p-2 text-[10px] text-white">
              <summary className="cursor-pointer font-semibold text-rose-300">Console ({active.console_logs.length})</summary>
              <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto font-mono">{active.console_logs.slice(-8).map((l, i) => <div key={i} className="truncate" title={l.text}><span className="text-rose-400">[{l.level}]</span> {l.text}</div>)}</div>
            </details>
          )}
          {!!active.network_logs?.length && (
            <details className="mt-2 rounded-input bg-fg p-2 text-[10px] text-white">
              <summary className="cursor-pointer font-semibold text-amber-300">Network ({active.network_logs.length})</summary>
              <div className="mt-1 max-h-28 space-y-0.5 overflow-y-auto font-mono">{active.network_logs.slice(-8).map((nl, i) => <div key={i} className="truncate" title={nl.url}><span className="text-amber-400">{nl.method}</span> {nl.url} → {nl.status ?? 'ERR'}</div>)}</div>
            </details>
          )}
          {active.dom_snapshot && (
            <details className="mt-2 rounded-input bg-fg p-2 text-[10px] text-white">
              <summary className="cursor-pointer font-semibold text-sky-300">DOM snapshot</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-snug">{active.dom_snapshot}</pre>
            </details>
          )}
          {safeUrl(active.screenshot_url) && <a href={safeUrl(active.screenshot_url)} target="_blank" rel="noreferrer" className="mt-2 block"><img src={safeUrl(active.screenshot_url)} alt="screenshot" className="max-h-44 w-full rounded-input border border-line object-contain" /></a>}
          {(active.replies ?? []).length > 0 && (
            <div className="mt-2 space-y-1 border-t border-line pt-2">{(active.replies ?? []).map((r, i) => <p key={i} className="flex items-start gap-1 text-xs text-fg-muted"><CornerDownRight size={12} className="mt-0.5 shrink-0 text-fg-disabled" /> <span><b className="text-fg-muted">{r.author || ''}</b> {r.note}</span></p>)}</div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add a follow-up…" onKeyDown={(e) => { if (e.key === 'Enter' && reply.trim()) doAddReply(active.id, reply.trim()) }} className="flex-1 rounded-input border border-line px-2.5 py-1.5 text-xs outline-none focus:border-brand" />
            <button type="button" onClick={() => reply.trim() && doAddReply(active.id, reply.trim())} className="rounded-input bg-sunken p-1.5 text-fg-secondary hover:bg-row-alt"><MessageSquarePlus size={15} /></button>
          </div>
        </div>
      )}

      {/* ---------------- review drawer ---------------- */}
      {panel && (
        <>
          <div data-annot-ui className="fixed inset-0 z-[9998] bg-fg/20" onClick={() => setPanel(false)} />
          <div ref={panelTrap} tabIndex={-1} data-annot-ui role="dialog" aria-modal="true" aria-label="Annotations" className="fixed right-0 top-0 z-[9999] flex h-full w-[27rem] max-w-[94vw] flex-col border-l border-line bg-surface shadow-e4 outline-none">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2 font-bold text-fg-secondary"><ListChecks size={18} className="text-brand-strong" /> Annotations <span className="rounded-full bg-sunken px-2 text-xs text-fg-muted">{anyFilter ? `${listed.length}/${all.length}` : all.length}</span></span>
              <button type="button" onClick={() => setPanel(false)} className="text-fg-muted hover:text-fg-secondary"><X size={18} /></button>
            </div>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <button type="button" onClick={() => setSendOpen(true)} disabled={!openItems.length} className="inline-flex flex-1 items-center justify-center gap-1 rounded-input bg-brand px-2.5 py-2 text-xs font-semibold text-white disabled:opacity-40"><Send size={13} /> Send to developer ({openItems.length})</button>
              <button type="button" onClick={() => downloadMd(openItems)} disabled={!openItems.length} title="Download .md" className="inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-2 text-xs text-fg-muted disabled:opacity-40"><Download size={13} /></button>
              <button type="button" onClick={() => setHelpOpen(true)} title="Shortcuts" className="inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-2 text-xs text-fg-muted"><Keyboard size={13} /></button>
            </div>
            {isAdmin && (
              <button type="button" onClick={() => toggleAccess(!enabled)} disabled={accessBusy} className={cn('flex items-center gap-2 border-b border-line px-3 py-2 text-left text-[11.5px] font-semibold', enabled ? 'text-success-text' : 'text-fg-muted')}>
                <Settings size={13} /> {enabled ? 'Visible to ALL users (testing) — click to make ADMIN-only' : 'ADMIN-only — click to enable for all users'}
              </button>
            )}
            {/* filters */}
            <div className="space-y-1.5 border-b border-line px-3 py-2">
              <div className="flex flex-wrap items-center gap-1">
                <Filter size={12} className="text-fg-muted" />
                {(['all', ...ANN_STATUSES.map((s) => s.key)] as const).map((f) => (<button key={f} type="button" onClick={() => setFilter(f as 'all' | AnnStatus)} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', filter === f ? 'bg-brand-tint text-brand-strong ring-1 ring-brand-hairline' : 'text-fg-muted hover:bg-sunken')}>{f === 'all' ? 'All' : annStatusLabel(f)}</button>))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {ANN_TYPES.map((t) => (<button key={t.key} type="button" onClick={() => setTypeFilter((v) => v === t.key ? '' : t.key)} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', typeFilter === t.key ? 'bg-fg text-white ring-fg' : 'bg-surface text-fg-muted ring-line hover:bg-row-alt')}><span className="h-1.5 w-1.5 rounded-full" style={{ background: t.dot }} />{t.label}</button>))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {ANN_PRIORITIES.map((pr) => (<button key={pr.key} type="button" onClick={() => setPrioFilter((v) => v === pr.key ? '' : pr.key)} className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', prioFilter === pr.key ? 'bg-ink-hover text-white ring-fg-secondary' : 'bg-surface text-fg-muted ring-line hover:bg-row-alt')}>{pr.label}</button>))}
                <label className="ml-1 inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-fg-muted"><input type="checkbox" checked={thisPageOnly} onChange={(e) => setThisPageOnly(e.target.checked)} className="h-3 w-3" /> This page</label>
                {seeAll && <button type="button" onClick={() => doClearResolved()} title="Delete done/dismissed" className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-danger-text hover:bg-danger-tint"><Eraser size={11} /> Clear resolved</button>}
              </div>
              <div className="flex items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="flex-1 rounded-input border border-line px-2.5 py-1.5 text-xs outline-none focus:border-brand" />
                {seeAll && authors.length > 1 && (<select value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} className="max-w-[9rem] rounded-input border border-line px-2 py-1.5 text-xs text-fg-muted"><option value="">Everyone</option>{authors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>)}
              </div>
            </div>
            {/* list grouped by page */}
            <div className="flex-1 overflow-y-auto p-2">
              {listed.length === 0 ? (
                <p className="p-6 text-center text-sm text-fg-muted">{all.length ? 'Nothing matches these filters.' : 'No annotations yet. Open the dock, pick Pin or a shape, and mark anything.'}</p>
              ) : grouped.map(([page, items]) => (
                <div key={page} className="mb-2">
                  <p className="mb-1 flex items-center gap-1 px-1 text-[10px] font-mono font-bold text-fg-muted"><span className={cn('h-1.5 w-1.5 rounded-full', page === pathname ? 'bg-success' : 'bg-fg-disabled')} /><span className="truncate">{page}</span><span className="text-fg-disabled">· {items.length}</span></p>
                  {items.map((a) => {
                    const editing = editRow === a.id
                    return (
                      <div key={a.id} onMouseEnter={() => a.page_route === pathname && a.kind !== 'shape' && setHoverEl(findEl(a))} onMouseLeave={() => setHoverEl(null)} className="mb-1.5 rounded-card border border-line hover:bg-row-alt">
                        <div className="flex items-start gap-2 p-2.5">
                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: a.color || annDot(a.type) }}>{a.kind === 'shape' ? annShapeLabel(a.shape_type)[0] : annTypeLabel(a.type)[0]}</span>
                          <button type="button" onClick={() => jumpTo(a)} className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-sm font-medium text-fg-secondary">{a.note || <span className="italic text-fg-muted">{annShapeLabel(a.shape_type)} mark</span>}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10.5px] text-fg-muted">
                              <span className="font-semibold text-fg-muted">{a.created_by_name || a.created_by}</span>
                              {a.created_by_role && <span className="rounded bg-sunken px-1 text-fg-muted">{a.created_by_role}</span>}
                              <span className="uppercase">· {a.priority}</span>
                              <span className={cn('rounded px-1', a.status === 'done' ? 'bg-success-tint text-success-text' : a.status === 'dismissed' ? 'bg-sunken text-fg-muted' : a.status === 'in_progress' ? 'bg-warning-tint text-warning-text' : 'bg-brand-tint text-brand-strong')}>{annStatusLabel(a.status)}</span>
                              {a.visibility === 'private' && <Lock size={10} />}{a.screenshot_url && <Camera size={10} />}{!!a.console_logs?.length && <TerminalSquare size={10} className="text-danger-text" />}{(a.replies ?? []).length > 0 && <span>💬{(a.replies ?? []).length}</span>}
                            </span>
                          </button>
                          {/* per-row actions — no need to open the mark */}
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button type="button" onClick={() => jumpTo(a)} title="Find on page" className="rounded p-1 text-fg-disabled hover:bg-brand-tint hover:text-brand-strong"><Target size={14} /></button>
                            {canEdit(a) && <button type="button" onClick={() => setEditRow(editing ? null : a.id)} title="Edit" className={cn('rounded p-1 hover:bg-sunken', editing ? 'bg-brand-tint text-brand-strong' : 'text-fg-disabled hover:text-fg-secondary')}><Pencil size={14} /></button>}
                            {canEdit(a) && a.status !== 'done' && <button type="button" onClick={() => doUpdate({ id: a.id, status: 'done' })} title="Mark done" className="rounded p-1 text-fg-disabled hover:bg-success-tint hover:text-success-text"><Check size={14} /></button>}
                            {canEdit(a) && <button type="button" onClick={() => doDelete(a.id)} title="Delete" className="rounded p-1 text-fg-disabled hover:bg-danger-tint hover:text-danger-text"><Trash size={14} /></button>}
                          </div>
                        </div>
                        {editing && canEdit(a) && (
                          <div className="space-y-2 border-t border-line p-2.5">
                            <textarea rows={2} defaultValue={a.note} onBlur={(e) => { if (e.target.value !== a.note) doUpdate({ id: a.id, note: e.target.value }) }} placeholder="Edit note…" className="w-full resize-none rounded-input border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand" />
                            <div className="flex flex-wrap items-center gap-1">
                              {ANN_STATUSES.map((st) => (<button key={st.key} type="button" onClick={() => doUpdate({ id: a.id, status: st.key })} className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', a.status === st.key ? (st.key === 'done' ? 'bg-success text-white ring-success' : st.key === 'dismissed' ? 'bg-fg-disabled text-white ring-fg-disabled' : st.key === 'in_progress' ? 'bg-warning text-white ring-warning' : 'bg-brand text-white ring-brand') : 'bg-surface text-fg-muted ring-line')}>{st.label}</button>))}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <select value={a.type} onChange={(e) => doUpdate({ id: a.id, type: e.target.value })} className="flex-1 rounded-input border border-line px-2 py-1 text-[11px]">{ANN_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                              <select value={a.priority} onChange={(e) => doUpdate({ id: a.id, priority: e.target.value })} className="flex-1 rounded-input border border-line px-2 py-1 text-[11px]">{ANN_PRIORITIES.map((pr) => <option key={pr.key} value={pr.key}>{pr.label}</option>)}</select>
                              <button type="button" onClick={() => setEditRow(null)} className="rounded-input bg-fg px-2.5 py-1 text-[11px] font-semibold text-white">Done</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---------------- send preview modal ---------------- */}
      {sendOpen && (
        <div data-annot-ui className="fixed inset-0 z-[10000] grid place-items-center bg-fg/50 p-4" onClick={() => setSendOpen(false)}>
          <div ref={sendTrap} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Send to developer" className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-modal bg-surface shadow-e4 outline-none" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Send size={16} className="text-fg-secondary" /><span className="flex-1 text-sm font-bold text-fg-secondary">Send to developer — {openItems.length} open item(s)</span>
              <button type="button" onClick={() => setSendOpen(false)} className="text-fg-muted hover:text-fg-secondary"><X size={18} /></button>
            </div>
            <p className="px-4 pt-3 text-[12px] text-fg-muted">This exact markdown reaches your developer — each mark's element, note, environment, and console are included. Copy, then paste in the chat.</p>
            <pre className="m-4 flex-1 overflow-auto whitespace-pre-wrap rounded-input bg-fg p-3 font-mono text-[11.5px] leading-relaxed text-white">{buildDevPrompt(openItems) || '(no open marks)'}</pre>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-3">
              {deliveries.map((d, i) => d.href
                ? <a key={i} href={safeUrl(d.href(openItems))} target="_blank" rel="noreferrer" onClick={() => setSendOpen(false)} className="inline-flex items-center gap-1.5 rounded-input border border-line-strong px-3 py-2 text-[12.5px] font-bold text-fg-secondary hover:bg-sunken"><Send size={14} /> {d.label}</a>
                : <button key={i} type="button" disabled={delivering} onClick={() => doDeliver(d)} className="inline-flex items-center gap-1.5 rounded-input border border-line-strong px-3 py-2 text-[12.5px] font-bold text-fg-secondary hover:bg-sunken disabled:opacity-40"><Send size={14} /> {d.label}</button>)}
              <button type="button" onClick={() => downloadMd(openItems)} className="inline-flex items-center gap-1.5 rounded-input border border-line-strong px-4 py-2 text-[12.5px] font-bold text-fg-secondary hover:bg-sunken"><Download size={15} /> Download .md</button>
              <button type="button" onClick={() => { copyPrompt(openItems); setSendOpen(false) }} className="inline-flex items-center gap-1.5 rounded-input bg-fg px-4 py-2 text-[12.5px] font-bold text-white hover:bg-ink-hover"><Copy size={15} /> Copy — paste to developer</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- keyboard cheat-sheet ---------------- */}
      {helpOpen && (
        <div data-annot-ui className="fixed inset-0 z-[10000] grid place-items-center bg-fg/50 p-4" onClick={() => setHelpOpen(false)}>
          <div ref={helpTrap} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="w-full max-w-sm rounded-modal bg-surface p-4 shadow-e4 outline-none" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2"><Keyboard size={16} className="text-brand-strong" /><span className="flex-1 text-sm font-bold text-fg-secondary">Shortcuts</span><button type="button" onClick={() => setHelpOpen(false)} className="text-fg-muted hover:text-fg-secondary"><X size={16} /></button></div>
            <div className="grid grid-cols-2 gap-y-1.5 text-[12px] text-fg-muted">
              {[['Shift+A', 'Pin tool'], ['P / B / A / C / D', 'Pin · Box · Arrow · Circle · Draw'], ['Esc', 'Cancel / exit'], ['⌘/Ctrl+Enter', 'Save note'], ['Ctrl+Z', 'Undo last mark'], ['Shift+H', 'Hide / show marks'], ['?', 'This help']].map(([k, v]) => (
                <div key={k} className="contents"><kbd className="w-fit rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg-secondary">{k}</kbd><span>{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {markupBlob && <ScreenshotEditor blob={markupBlob} onToast={toast} onClose={() => setMarkupBlob(null)} />}

      {/* ---------------- built-in mini-toast (skipped when onToast is provided) ---------------- */}
      {toasts.length > 0 && (
        <div data-annot-ui className="fixed bottom-6 left-1/2 z-[10001] flex -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map((t) => (
            <div key={t.id} className={cn('rounded-input px-3 py-2 text-xs font-semibold shadow-e4 ring-1', t.kind === 'success' ? 'bg-success-tint text-success-text ring-success-hairline' : 'bg-danger-tint text-danger-text ring-danger-hairline')}>{t.msg}</div>
          ))}
        </div>
      )}
    </div>
    </OverlayBoundary>,
    document.body,
  )
}
