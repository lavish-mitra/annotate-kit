// Firebase storage adapter — Firestore for marks, Cloud Storage for screenshots.
// Apply backend/firebase/firestore.rules + storage.rules once, then create this adapter.
// Security rules are the real gate; this is just the client.
import type { Firestore } from 'firebase/firestore'
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy,
} from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import type { Auth } from 'firebase/auth'
import type { StorageAdapter } from '../adapter'
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess } from '../types'

export type ResolvedUser = { email?: string; name?: string; role?: string }

export type FirebaseAdapterConfig = {
  firestore: Firestore
  storage: FirebaseStorage
  /** Firebase Auth — used to resolve the current user + admin claim (unless currentUser/isAdmin given). */
  auth?: Auth
  /** Firestore collection for marks (default 'annotations'). */
  collectionPath?: string
  /** Firestore doc holding the global toggle (default: 'annotate_settings/global'). */
  settingsPath?: string
  /** Storage folder for screenshots (default 'annotations'). */
  storagePath?: string
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
  const [settingsColl, settingsId] = (config.settingsPath ?? 'annotate_settings/global').split('/')
  const storageDir = config.storagePath ?? 'annotations'
  const col = collection(db, collPath)

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
    try { return await getDownloadURL(ref(storage, path)) } catch { return null }
  }

  return {
    async getAccess(): Promise<AnnotateAccess> {
      const me = await resolveUser()
      const isAdmin = await resolveIsAdmin(me)
      let enabled = true
      try {
        const snap = await getDoc(doc(db, settingsColl, settingsId))
        if (snap.exists() && typeof snap.data().enabled === 'boolean') enabled = snap.data().enabled
      } catch { /* missing → default enabled */ }
      return { enabled, isAdmin, canUse: enabled || isAdmin, seeAll: isAdmin, me }
    },

    async setAccess(enabled: boolean) {
      await setDoc(doc(db, settingsColl, settingsId), { enabled }, { merge: true })
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
        const s = await getDocs(query(col, orderBy('id', 'desc')))
        collect(s.docs)
      } else {
        const [pub, mine] = await Promise.all([
          getDocs(query(col, where('visibility', '==', 'public'))),
          me.email ? getDocs(query(col, where('created_by', '==', me.email))) : Promise.resolve({ docs: [] as never[] }),
        ])
        collect(pub.docs); collect(mine.docs)
      }
      const rows = [...seen.values()].sort((a, b) => b.id - a.id)
      await Promise.all(rows.map(async (r) => { if (r.screenshot_path) r.screenshot_url = await urlFor(r.screenshot_path) }))
      return rows
    },

    async save(input: NewAnnotation) {
      const me = await resolveUser()
      const id = Date.now()
      const row = prune({
        ...input, id, status: 'open',
        created_by: me.email ?? '', created_by_name: me.name ?? me.email ?? '', created_by_role: me.role ?? null,
        created_at: new Date().toISOString(),
      })
      await setDoc(doc(col, String(id)), row as Record<string, unknown>)
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
      if (path) { try { await deleteObject(ref(storage, path)) } catch { /* already gone */ } }
    },

    async addReply(id: number, note: string) {
      const me = await resolveUser()
      const snap = await getDoc(doc(col, String(id)))
      const replies = snap.exists() && Array.isArray(snap.data().replies) ? (snap.data().replies as unknown[]) : []
      replies.push({ note, author: me.name ?? me.email ?? '', at: new Date().toISOString() })
      await updateDoc(doc(col, String(id)), { replies })
    },

    async clearResolved() {
      const s = await getDocs(query(col, where('status', 'in', ['done', 'dismissed'])))
      await Promise.all(s.docs.map(async (d) => {
        const path = d.data().screenshot_path as string | undefined
        await deleteDoc(d.ref)
        if (path) { try { await deleteObject(ref(storage, path)) } catch { /* already gone */ } }
      }))
      return { message: `Cleared ${s.docs.length} resolved` }
    },

    async uploadScreenshot(file: File) {
      const me = await resolveUser()
      const safe = (me.email ?? 'anon').replace(/[^a-z0-9._-]/gi, '_')
      const rand = Math.random().toString(36).slice(2, 8)
      const path = `${storageDir}/${safe}/${Date.now()}-${rand}.png`
      await uploadBytes(ref(storage, path), file, { contentType: file.type || 'image/png' })
      return { path }
    },
  }
}
