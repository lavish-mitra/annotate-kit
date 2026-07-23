// Generic REST adapter — map the 9 StorageAdapter methods to your OWN HTTP API, on any platform
// (Node/Express, Next.js route handlers, Django, Rails, Go, serverless…). Your DB credentials stay
// server-side and your backend enforces authorization (exactly like Supabase RLS does). No third-party
// service and no signup — you point it at your endpoints.
//
//   import { createRestAdapter } from 'annotate-kit/rest'
//   const adapter = createRestAdapter({ baseUrl: '/api/annotations', headers: () => ({ Authorization: `Bearer ${token()}` }) })
//
// Default endpoints (override any via `endpoints`):
//   GET    {baseUrl}/access            → AnnotateAccess
//   PUT    {baseUrl}/access            ← { enabled }
//   GET    {baseUrl}                   → Annotation[]  (each with screenshot_url resolved server-side)
//   POST   {baseUrl}                   ← NewAnnotation           → { id }
//   PATCH  {baseUrl}/{id}              ← partial patch
//   DELETE {baseUrl}/{id}
//   POST   {baseUrl}/{id}/replies      ← { note }
//   POST   {baseUrl}/clear-resolved    → { message }
//   POST   {baseUrl}/screenshots       ← multipart form { file, visibility } → { path }
import type { StorageAdapter } from '../adapter'
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess, AnnVisibility } from '../types'

export type RestEndpoints = {
  access: string
  list: string
  create: string
  item: (id: number) => string
  replies: (id: number) => string
  clearResolved: string
  screenshots: string
}

export type RestAdapterConfig = {
  /** Base URL of your annotations API, e.g. '/api/annotations' or 'https://api.example.com/annotations'. */
  baseUrl: string
  /** Extra headers (e.g. Authorization). A function is re-evaluated per request, so tokens stay fresh. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  /** Cookie policy for requests (default 'same-origin'). Use 'include' for cross-origin cookies. */
  credentials?: RequestCredentials
  /** Custom fetch implementation (default: global fetch). */
  fetch?: typeof fetch
  /** Override any endpoint (absolute URL or relative to baseUrl). */
  endpoints?: Partial<RestEndpoints>
}

export function createRestAdapter(config: RestAdapterConfig): StorageAdapter {
  const base = config.baseUrl.replace(/\/+$/, '')
  const doFetch = config.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined)
  if (!doFetch) throw new Error('annotate: no fetch available — pass config.fetch')
  const ep: RestEndpoints = {
    access: `${base}/access`,
    list: base,
    create: base,
    item: (id) => `${base}/${encodeURIComponent(String(id))}`,
    replies: (id) => `${base}/${encodeURIComponent(String(id))}/replies`,
    clearResolved: `${base}/clear-resolved`,
    screenshots: `${base}/screenshots`,
    ...config.endpoints,
  }

  async function baseHeaders(): Promise<Record<string, string>> {
    return typeof config.headers === 'function' ? await config.headers() : (config.headers ?? {})
  }
  async function req<T>(url: string, opts?: { method?: string; json?: unknown; body?: BodyInit }): Promise<T> {
    const headers = { ...(await baseHeaders()) }   // copy — never mutate the caller's headers object
    if (opts?.json !== undefined) headers['content-type'] = 'application/json'
    const res = await doFetch!(url, {
      method: opts?.method ?? 'GET',
      credentials: config.credentials ?? 'same-origin',
      headers,
      body: opts?.json !== undefined ? JSON.stringify(opts.json) : opts?.body,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText)
      throw new Error(`annotate REST ${res.status}: ${detail.slice(0, 300)}`)
    }
    const text = await res.text()
    if (!text) return undefined as T   // 204 / empty body
    const ct = res.headers.get('content-type') || ''
    return (ct.includes('json') ? JSON.parse(text) : text) as T
  }

  return {
    getAccess: () => req<AnnotateAccess>(ep.access),
    setAccess: (enabled: boolean) => req<{ message?: string }>(ep.access, { method: 'PUT', json: { enabled } }),
    list: () => req<Annotation[]>(ep.list).then((r) => r ?? []),
    save: (input: NewAnnotation) => req<{ id: number }>(ep.create, { method: 'POST', json: input }),
    async update(patch: AnnotationPatch) { const { id, ...rest } = patch; await req(ep.item(id), { method: 'PATCH', json: rest }) },
    async remove(id: number) { await req(ep.item(id), { method: 'DELETE' }) },
    async addReply(id: number, note: string) { await req(ep.replies(id), { method: 'POST', json: { note } }) },
    clearResolved: () => req<{ message?: string }>(ep.clearResolved, { method: 'POST' }),
    async uploadScreenshot(file: File, opts?: { visibility?: AnnVisibility }) {
      const fd = new FormData()
      fd.append('file', file)
      if (opts?.visibility) fd.append('visibility', opts.visibility)
      return req<{ path: string }>(ep.screenshots, { method: 'POST', body: fd })
    },
  }
}
