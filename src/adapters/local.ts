// Zero-backend adapter — persists everything to the browser's localStorage, screenshots inlined as
// data URLs. No server, no signup, no config: drop it in and it just works for demos, local dev,
// offline use, or a personal single-user setup.
//
//   import { createLocalAdapter } from 'annotate-kit/local'
//   <Annotate adapter={createLocalAdapter()} />
//
// SECURITY: there is NO multi-user boundary here. Everything lives in ONE browser profile and is fully
// visible to whoever uses that browser — there is no server to enforce anything. Use it for a single
// user / demos, NOT for shared multi-tenant data. For real multi-user access control use the Supabase,
// Firebase, or REST adapters, where a server enforces authorization.
import type { StorageAdapter } from '../adapter'
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess, AnnVisibility, AnnReply } from '../types'

export type LocalAdapterConfig = {
  /** localStorage key holding all data (default 'annotate-kit'). */
  storageKey?: string
  /** The single local user shown as author. */
  me?: { email?: string; name?: string; role?: string }
  /** Storage backend (default globalThis.localStorage). Pass a mock for tests / non-browser envs. */
  storage?: Storage
}

type Store = { seq: number; rows: Annotation[]; settings: { enabled: boolean }; shots: Record<string, string> }

export function createLocalAdapter(config: LocalAdapterConfig = {}): StorageAdapter {
  const key = config.storageKey ?? 'annotate-kit'
  const me = config.me ?? { email: 'you@local', name: 'You' }
  const store: Storage | undefined = config.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
  const now = () => new Date().toISOString()

  const empty = (): Store => ({ seq: 1, rows: [], settings: { enabled: true }, shots: {} })
  const read = (): Store => {
    if (!store) return empty()
    try {
      const raw = store.getItem(key)
      if (!raw) return empty()
      const s = JSON.parse(raw)
      return {
        seq: typeof s.seq === 'number' ? s.seq : 1,
        rows: Array.isArray(s.rows) ? s.rows : [],
        settings: s.settings && typeof s.settings.enabled === 'boolean' ? s.settings : { enabled: true },
        shots: s.shots && typeof s.shots === 'object' ? s.shots : {},
      }
    } catch { return empty() }
  }
  const write = (s: Store) => {
    if (!store) return   // non-browser env: nothing to persist to, treat as no-op
    try { store.setItem(key, JSON.stringify(s)) }
    catch { throw new Error('annotate: local storage is full or unavailable — the change could not be saved') }
  }
  const withUrls = (s: Store): Annotation[] =>
    s.rows.map((r) => ({ ...r, screenshot_url: r.screenshot_path ? (s.shots[r.screenshot_path] ?? null) : null }))

  return {
    async getAccess(): Promise<AnnotateAccess> {
      return { enabled: read().settings.enabled, isAdmin: true, canUse: true, seeAll: true, me }
    },
    async setAccess(enabled: boolean) {
      const s = read(); s.settings.enabled = enabled; write(s)
      return { message: enabled ? 'Enabled' : 'Disabled' }
    },
    async list(): Promise<Annotation[]> {
      return withUrls(read()).sort((a, b) => b.id - a.id)
    },
    async save(input: NewAnnotation) {
      const s = read(); const id = s.seq++
      s.rows.push({
        ...input, id, status: 'open',
        created_by: me.email ?? '', created_by_name: me.name ?? me.email ?? '', created_by_role: me.role ?? null,
        created_at: now(), updated_at: now(),
      } as Annotation)
      write(s); return { id }
    },
    async update(patch: AnnotationPatch) {
      const s = read(); const { id, ...rest } = patch
      const row = s.rows.find((r) => r.id === id)
      if (row) { Object.assign(row, rest, { updated_at: now() }); write(s) }
    },
    async remove(id: number) {
      const s = read(); const row = s.rows.find((r) => r.id === id)
      if (row?.screenshot_path) delete s.shots[row.screenshot_path]
      s.rows = s.rows.filter((r) => r.id !== id); write(s)
    },
    async addReply(id: number, note: string) {
      const s = read(); const row = s.rows.find((r) => r.id === id)
      if (row) {
        const reply: AnnReply = { note: note.slice(0, 2000), author: me.name ?? me.email ?? '', at: now() }
        row.replies = [...(Array.isArray(row.replies) ? row.replies : []), reply]
        row.updated_at = now(); write(s)
      }
    },
    async clearResolved() {
      const s = read(); const before = s.rows.length
      for (const r of s.rows) if ((r.status === 'done' || r.status === 'dismissed') && r.screenshot_path) delete s.shots[r.screenshot_path]
      s.rows = s.rows.filter((r) => r.status !== 'done' && r.status !== 'dismissed')
      // reclaim any screenshots no longer referenced by a row (e.g. an upload whose mark was never saved)
      const referenced = new Set(s.rows.map((r) => r.screenshot_path).filter(Boolean))
      for (const p of Object.keys(s.shots)) if (!referenced.has(p)) delete s.shots[p]
      write(s); return { message: `Cleared ${before - s.rows.length} resolved` }
    },
    async uploadScreenshot(file: File, _opts?: { visibility?: AnnVisibility }) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(fr.error ?? new Error('read failed'))
        fr.readAsDataURL(file)
      })
      const s = read(); const path = `shot-${s.seq++}-${Date.now()}`
      s.shots[path] = dataUrl; write(s)
      return { path }
    },
  }
}
