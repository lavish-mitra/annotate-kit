// IndexedDB adapter — zero-backend like `annotate-kit/local`, but with real capacity: marks live in
// an object store and screenshots are kept as native Blobs (no base64 bloat, no ~5MB localStorage cap).
// Ideal for demos, offline, or single-user setups that take many/large screenshots.
//
//   import { createIdbAdapter } from 'annotate-kit/idb'
//   <Annotate adapter={createIdbAdapter()} />
//
// SECURITY: like the local adapter, this is single-browser storage with NO multi-user boundary — it is
// fully visible to whoever uses that browser. Use it for one user / demos, not shared data.
import type { StorageAdapter } from '../adapter'
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess, AnnVisibility, AnnReply } from '../types'

export type IdbAdapterConfig = {
  /** Database name (default 'annotate-kit'). */
  dbName?: string
  /** The single local user shown as author. */
  me?: { email?: string; name?: string; role?: string }
  /** IndexedDB factory (default globalThis.indexedDB). Inject a fake for tests / non-browser envs. */
  factory?: IDBFactory
}

const MARKS = 'marks'
const SHOTS = 'shots'
const SETTINGS = 'settings'

export function createIdbAdapter(config: IdbAdapterConfig = {}): StorageAdapter {
  const dbName = config.dbName ?? 'annotate-kit'
  const me = config.me ?? { email: 'you@local', name: 'You' }
  const idb = config.factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined)
  // Do NOT throw at construction — it must be SSR-safe (e.g. inline `createIdbAdapter()` on the server).
  const now = () => new Date().toISOString()
  const canObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
  const urlCache = new Map<string, string>()

  let dbp: Promise<IDBDatabase> | null = null
  function db(): Promise<IDBDatabase> {
    if (!idb) return Promise.reject(new Error('annotate: IndexedDB is unavailable — pass config.factory or use another adapter'))
    if (!dbp) dbp = new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains(MARKS)) d.createObjectStore(MARKS, { keyPath: 'id', autoIncrement: true })
        if (!d.objectStoreNames.contains(SHOTS)) d.createObjectStore(SHOTS)
        if (!d.objectStoreNames.contains(SETTINGS)) d.createObjectStore(SETTINGS)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return dbp
  }
  // Run a transaction whose body issues its requests synchronously (so the tx never goes inactive),
  // resolving with `out.value` once the tx commits.
  function run<T>(stores: string[], mode: IDBTransactionMode, body: (t: IDBTransaction, out: { value?: T }) => void): Promise<T | undefined> {
    return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
      const t = d.transaction(stores, mode)
      const out: { value?: T } = {}
      try { body(t, out) } catch (e) { reject(e); try { t.abort() } catch { /* noop */ } return }
      t.oncomplete = () => resolve(out.value)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    }))
  }

  return {
    async getAccess(): Promise<AnnotateAccess> {
      const enabled = await run<boolean>([SETTINGS], 'readonly', (t, out) => {
        const g = t.objectStore(SETTINGS).get('enabled')
        g.onsuccess = () => { out.value = g.result === undefined ? true : !!g.result }
      })
      return { enabled: enabled ?? true, isAdmin: true, canUse: true, seeAll: true, me }
    },
    async setAccess(enabled: boolean) {
      await run([SETTINGS], 'readwrite', (t) => { t.objectStore(SETTINGS).put(enabled, 'enabled') })
      return { message: enabled ? 'Enabled' : 'Disabled' }
    },
    async list(): Promise<Annotation[]> {
      const rows = await run<Annotation[]>([MARKS, SHOTS], 'readonly', (t, out) => {
        const shots = t.objectStore(SHOTS)
        const ga = t.objectStore(MARKS).getAll()
        ga.onsuccess = () => {
          const all = (ga.result || []) as Annotation[]
          for (const r of all) {
            if (r.screenshot_path && canObjectUrl) {
              const cached = urlCache.get(r.screenshot_path)
              if (cached) r.screenshot_url = cached
              else {
                const sr = shots.get(r.screenshot_path)
                sr.onsuccess = () => { const b = sr.result as Blob | undefined; if (b) { const u = URL.createObjectURL(b); urlCache.set(r.screenshot_path!, u); r.screenshot_url = u } }
              }
            }
          }
          out.value = all
        }
      })
      return (rows ?? []).sort((a, b) => b.id - a.id)
    },
    async save(input: NewAnnotation) {
      const row = {
        ...input, status: 'open',
        created_by: me.email ?? '', created_by_name: me.name ?? me.email ?? '', created_by_role: me.role ?? null,
        created_at: now(), updated_at: now(),
      }
      const id = await run<number>([MARKS], 'readwrite', (t, out) => {
        const add = t.objectStore(MARKS).add(row)   // autoIncrement fills row.id in the stored value
        add.onsuccess = () => { out.value = Number(add.result) }
      })
      return { id: id ?? 0 }
    },
    async update(patch: AnnotationPatch) {
      const { id, ...rest } = patch
      await run([MARKS], 'readwrite', (t) => {
        const store = t.objectStore(MARKS)
        const g = store.get(id)
        g.onsuccess = () => { const row = g.result; if (row) { Object.assign(row, rest, { updated_at: now() }); store.put(row) } }
      })
    },
    async remove(id: number) {
      await run([MARKS, SHOTS], 'readwrite', (t) => {
        const marks = t.objectStore(MARKS)
        const g = marks.get(id)
        g.onsuccess = () => {
          const row = g.result as Annotation | undefined
          marks.delete(id)
          if (row?.screenshot_path) {
            t.objectStore(SHOTS).delete(row.screenshot_path)
            const u = urlCache.get(row.screenshot_path); if (u && canObjectUrl) URL.revokeObjectURL(u)
            urlCache.delete(row.screenshot_path)
          }
        }
      })
    },
    async addReply(id: number, note: string) {
      await run([MARKS], 'readwrite', (t) => {
        const store = t.objectStore(MARKS)
        const g = store.get(id)
        g.onsuccess = () => {
          const row = g.result as Annotation | undefined
          if (row) {
            const reply: AnnReply = { note: note.slice(0, 2000), author: me.name ?? me.email ?? '', at: now() }
            row.replies = [...(Array.isArray(row.replies) ? row.replies : []), reply]
            row.updated_at = now()
            store.put(row)
          }
        }
      })
    },
    async clearResolved() {
      const removed = await run<number>([MARKS, SHOTS], 'readwrite', (t, out) => {
        const marks = t.objectStore(MARKS)
        const shots = t.objectStore(SHOTS)
        const ga = marks.getAll()
        ga.onsuccess = () => {
          const all = (ga.result || []) as Annotation[]
          let n = 0
          const referenced = new Set<string>()
          for (const r of all) {
            if (r.status === 'done' || r.status === 'dismissed') {
              marks.delete(r.id); n++
              if (r.screenshot_path) { const u = urlCache.get(r.screenshot_path); if (u && canObjectUrl) URL.revokeObjectURL(u); urlCache.delete(r.screenshot_path) }
            } else if (r.screenshot_path) referenced.add(r.screenshot_path)
          }
          // reclaim every shot no longer referenced by a surviving mark (incl. abandoned uploads)
          const gk = shots.getAllKeys()
          gk.onsuccess = () => {
            for (const k of (gk.result || []) as IDBValidKey[]) {
              const key = String(k)
              if (!referenced.has(key)) { shots.delete(k); const u = urlCache.get(key); if (u && canObjectUrl) URL.revokeObjectURL(u); urlCache.delete(key) }
            }
          }
          out.value = n
        }
      })
      return { message: `Cleared ${removed ?? 0} resolved` }
    },
    async uploadScreenshot(file: File, _opts?: { visibility?: AnnVisibility }) {
      const path = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await run([SHOTS], 'readwrite', (t) => { t.objectStore(SHOTS).put(file, path) })
      return { path }
    },
  }
}
