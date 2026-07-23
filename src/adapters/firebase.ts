// Firebase storage adapter — Firestore for marks, Cloud Storage for screenshots.
// Apply backend/firebase/firestore.rules + storage.rules once, then create this adapter.
// Security rules are the real gate; this is just the client.
import type { Firestore } from 'firebase/firestore'
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  arrayUnion, runTransaction, onSnapshot,
} from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import type { Auth } from 'firebase/auth'
import type { StorageAdapter } from '../adapter'
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess, AnnVisibility } from '../types'

export type ResolvedUser = { email?: string; name?: string; role?: string }

export type FirebaseAdapterConfig = {
  firestore: Firestore
  storage: FirebaseStorage
  /** Firebase Auth — used to resolve the current user + admin claim (unless currentUser/isAdmin given). */
  auth?: Auth
  /** Firestore collection for marks (default 'annotations'). */
  collectionPath?: string
  /** Firestore doc holding the global toggle, as 'collection/doc' (default: 'annotate_settings/global'). */
  settingsPath?: string
  /** Storage folder for screenshots (default 'annotations'). */
  storagePath?: string
  /** Max docs fetched per list() call (default 1000). Keeps polling bounded on busy projects. */
  listLimit?: number
  /** Is the current viewer an admin? boolean or predicate.
   *  Default: the auth user's custom claim `admin === true` or `role === 'admin'`
   *  (must match backend/firebase/firestore.rules isAdmin()). */
  isAdmin?: boolean | ((user: ResolvedUser) => boolean | Promise<boolean>)
  /** Override current-user resolution (default: auth.currentUser + its ID-token claims). */
  currentUser?: () => Promise<ResolvedUser | null>
}

// Firestore rejects `undefined` field values — strip them (deeply) before writing.
function prune<T>(o: T): T {
  if (Array.isArray(o)) return o.map((v) => prune(v)) as unknown as T
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (v !== undefined) out[k] = prune(v)
    return out as T
  }
  return o
}

export function createFirebaseAdapter(config: FirebaseAdapterConfig): StorageAdapter {
  const db = config.firestore
  const storage = config.storage
  const auth = config.auth
  const collPath = config.collectionPath ?? 'annotations'
  const settingsFullPath = config.settingsPath ?? 'annotate_settings/global'
  if (settingsFullPath.split('/').filter(Boolean).length % 2 !== 0) {
    throw new Error(`annotate: settingsPath must be a document path like 'collection/doc' (got '${settingsFullPath}')`)
  }
  const storageDir = config.storagePath ?? 'annotations'
  const listLimit = config.listLimit ?? 1000
  const col = collection(db, collPath)
  const settingsRef = doc(db, settingsFullPath)
  const urlCache = new Map<string, string>()   // download URLs are long-lived; cache per session

  async function claims(): Promise<Record<string, unknown>> {
    if (!auth?.currentUser) return {}
    try { return (await auth.currentUser.getIdTokenResult()).claims as Record<string, unknown> } catch { return {} }
  }
  async function resolveUser(): Promise<ResolvedUser> {
    if (config.currentUser) return (await config.currentUser()) ?? {}
    const u = auth?.currentUser
    if (!u) return {}
    const c = await claims()
    return { email: u.email ?? undefined, name: u.displayName ?? u.email ?? undefined, role: (c.role as string) || undefined }
  }
  async function resolveIsAdmin(user: ResolvedUser): Promise<boolean> {
    if (typeof config.isAdmin === 'boolean') return config.isAdmin
    if (typeof config.isAdmin === 'function') return !!(await config.isAdmin(user))
    const c = await claims()
    return c.admin === true || c.role === 'admin'
  }
  async function urlFor(path?: string | null): Promise<string | null> {
    if (!path) return null
    const hit = urlCache.get(path)
    if (hit) return hit
    try { const u = await getDownloadURL(ref(storage, path)); urlCache.set(path, u); return u } catch { return null }
  }

  return {
    async getAccess(): Promise<AnnotateAccess> {
      const me = await resolveUser()
      const isAdmin = await resolveIsAdmin(me)
      let enabled = false
      try {
        const snap = await getDoc(settingsRef)
        if (snap.exists() && typeof snap.data().enabled === 'boolean') enabled = snap.data().enabled
      } catch { /* missing → treat as disabled (admin-only) */ }
      return { enabled, isAdmin, canUse: enabled || isAdmin, seeAll: isAdmin, me }
    },

    async setAccess(enabled: boolean) {
      await setDoc(settingsRef, { enabled }, { merge: true })
      return { message: enabled ? 'Enabled for all users' : 'ADMIN-only' }
    },

    async list(): Promise<Annotation[]> {
      const me = await resolveUser()
      const isAdmin = await resolveIsAdmin(me)
      const seen = new Map<number, Annotation>()
      const collect = (docs: { id: string; data: () => Record<string, unknown> }[]) => {
        for (const d of docs) {
          const data = d.data()
          const id = typeof data.id === 'number' ? data.id : Number(d.id)
          seen.set(id, { ...(data as Annotation), id })
        }
      }
      if (isAdmin) {
        const s = await getDocs(query(col, orderBy('id', 'desc'), limit(listLimit)))
        collect(s.docs)
      } else {
        const [pub, mine] = await Promise.all([
          getDocs(query(col, where('visibility', '==', 'public'), orderBy('id', 'desc'), limit(listLimit))),
          me.email ? getDocs(query(col, where('created_by', '==', me.email), orderBy('id', 'desc'), limit(listLimit))) : Promise.resolve({ docs: [] as never[] }),
        ])
        collect(pub.docs); collect(mine.docs)
      }
      const rows = [...seen.values()].sort((a, b) => b.id - a.id)
      await Promise.all(rows.map(async (r) => { if (r.screenshot_path) r.screenshot_url = await urlFor(r.screenshot_path) }))
      return rows
    },

    async save(input: NewAnnotation) {
      const me = await resolveUser()
      const base = {
        ...input, status: 'open',
        created_by: me.email ?? '', created_by_name: me.name ?? me.email ?? '', created_by_role: me.role ?? null,
        created_at: new Date().toISOString(),
      }
      // Allocate a collision-free numeric id transactionally (never overwrite an existing mark).
      let id = 0
      await runTransaction(db, async (tx) => {
        for (let i = 0; i < 6; i++) {
          const cand = Date.now() * 1000 + Math.floor(Math.random() * 1000)
          const dref = doc(col, String(cand))
          const snap = await tx.get(dref)
          if (!snap.exists()) { id = cand; tx.set(dref, prune({ ...base, id }) as Record<string, unknown>); return }
        }
        throw new Error('annotate: could not allocate a unique id — retry')
      })
      return { id }
    },

    async update(patch: AnnotationPatch) {
      const { id, ...rest } = patch
      await updateDoc(doc(col, String(id)), { ...prune(rest), updated_at: new Date().toISOString() })
    },

    async remove(id: number) {
      const snap = await getDoc(doc(col, String(id)))
      const path = snap.exists() ? (snap.data().screenshot_path as string | undefined) : undefined
      await deleteDoc(doc(col, String(id)))
      if (path) { urlCache.delete(path); try { await deleteObject(ref(storage, path)) } catch (e) { console.warn('[annotate] screenshot delete failed', e) } }
    },

    async addReply(id: number, note: string) {
      const me = await resolveUser()
      const reply = { note: note.slice(0, 2000), author: me.name ?? me.email ?? '', at: new Date().toISOString() }
      // atomic append — no read-modify-write race
      await updateDoc(doc(col, String(id)), { replies: arrayUnion(reply), updated_at: new Date().toISOString() })
    },

    async clearResolved() {
      const s = await getDocs(query(col, where('status', 'in', ['done', 'dismissed'])))
      await Promise.all(s.docs.map(async (d) => {
        const path = d.data().screenshot_path as string | undefined
        await deleteDoc(d.ref)
        if (path) { urlCache.delete(path); try { await deleteObject(ref(storage, path)) } catch (e) { console.warn('[annotate] screenshot delete failed', e) } }
      }))
      return { message: `Cleared ${s.docs.length} resolved` }
    },

    async uploadScreenshot(file: File, opts?: { visibility?: AnnVisibility }) {
      const vis = opts?.visibility === 'public' ? 'public' : 'private'
      const uid = auth?.currentUser?.uid
      if (!uid) throw new Error('annotate: must be signed in to upload a screenshot')
      const rand = Math.random().toString(36).slice(2, 8)
      const path = `${storageDir}/${vis}/${uid}/${Date.now()}-${rand}.png`
      await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/png' })
      return { path }
    },

    subscribe(onChange: () => void) {
      // Live for public marks (any signed-in user may read them); the overlay's slow safety poll
      // covers own/admin-only changes.
      return onSnapshot(query(col, where('visibility', '==', 'public')), () => onChange(), () => { /* ignore */ })
    },
  }
}
