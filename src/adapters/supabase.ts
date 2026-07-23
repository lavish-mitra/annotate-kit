// Supabase storage adapter — talks directly to Postgres + Storage via supabase-js.
// No Edge Function to deploy: apply backend/supabase/migration.sql once (table + RLS + trigger +
// reply RPC + private bucket + policies) and this adapter does the rest. Row-level security and the
// author-stamping trigger are the real gate; this is just the client.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StorageAdapter } from '../adapter'
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess, AnnVisibility } from '../types'

export type SupabaseAdapterConfig = {
  client: SupabaseClient
  /** Table name (default 'annotations'). */
  table?: string
  /** Private storage bucket for screenshots (default 'annotations'). */
  bucket?: string
  /** Single-row global toggle table (default 'annotate_settings'). */
  settingsTable?: string
  /** Signed-URL lifetime for screenshots, seconds (default 3600). */
  signedUrlTtl?: number
  /** Max rows fetched per list() call (default 1000). Keeps polling bounded on busy projects. */
  listLimit?: number
  /** Is the current viewer an admin? A boolean, or a predicate over the resolved user.
   *  Default: true when the auth user's `app_metadata.role === 'admin'` or `app_metadata.annotate_admin === true`
   *  (must match backend/supabase/migration.sql's annotate_is_admin()). */
  isAdmin?: boolean | ((user: ResolvedUser) => boolean | Promise<boolean>)
  /** Override how the current user is resolved (default: supabase.auth.getUser()). */
  currentUser?: () => Promise<ResolvedUser | null>
}

export type ResolvedUser = { email?: string; name?: string; role?: string }

export function createSupabaseAdapter(config: SupabaseAdapterConfig): StorageAdapter {
  const client = config.client
  const table = config.table ?? 'annotations'
  const bucket = config.bucket ?? 'annotations'
  const settingsTable = config.settingsTable ?? 'annotate_settings'
  const ttl = config.signedUrlTtl ?? 3600
  const listLimit = config.listLimit ?? 1000

  // cache resolved signed URLs by path so we don't re-sign the whole table on every poll
  const urlCache = new Map<string, { url: string; exp: number }>()

  async function resolveUser(): Promise<ResolvedUser> {
    if (config.currentUser) return (await config.currentUser()) ?? {}
    const { data } = await client.auth.getUser()
    const u = data.user
    if (!u) return {}
    const md = (u.user_metadata ?? {}) as Record<string, unknown>
    const am = (u.app_metadata ?? {}) as Record<string, unknown>
    return {
      email: u.email ?? (md.email as string | undefined),
      name: (md.full_name as string) || (md.name as string) || u.email || undefined,
      role: (am.role as string) || (md.role as string) || undefined,
    }
  }
  async function resolveIsAdmin(user: ResolvedUser): Promise<boolean> {
    if (typeof config.isAdmin === 'boolean') return config.isAdmin
    if (typeof config.isAdmin === 'function') return !!(await config.isAdmin(user))
    // default: derive from the auth user's app_metadata directly (independent of a currentUser override)
    const { data } = await client.auth.getUser()
    const am = (data.user?.app_metadata ?? {}) as Record<string, unknown>
    return am.role === 'admin' || am.annotate_admin === true
  }
  async function uid(): Promise<string> {
    const { data } = await client.auth.getUser()
    if (!data.user?.id) throw new Error('annotate: must be signed in to upload a screenshot')
    return data.user.id
  }
  const err = (e: { message?: string } | null) => { if (e?.message) throw new Error(e.message) }

  // resolve screenshot_url for a batch of paths, using the cache and one batched sign call
  async function signPaths(rows: Annotation[]): Promise<void> {
    const now = Date.now()
    const need: string[] = []
    for (const r of rows) {
      if (!r.screenshot_path) continue
      const hit = urlCache.get(r.screenshot_path)
      if (hit && hit.exp - now > 60_000) r.screenshot_url = hit.url
      else need.push(r.screenshot_path)
    }
    if (need.length) {
      const { data } = await client.storage.from(bucket).createSignedUrls(need, ttl)
      const byPath = new Map((data ?? []).map((d) => [d.path as string, d.signedUrl as string]))
      const exp = now + ttl * 1000
      for (const r of rows) {
        if (r.screenshot_path && !r.screenshot_url) {
          const url = byPath.get(r.screenshot_path) ?? null
          if (url) urlCache.set(r.screenshot_path, { url, exp })
          r.screenshot_url = url
        }
      }
    }
  }

  return {
    async getAccess(): Promise<AnnotateAccess> {
      const me = await resolveUser()
      const isAdmin = await resolveIsAdmin(me)
      let enabled = false
      try {
        const { data } = await client.from(settingsTable).select('value').eq('key', 'enabled').maybeSingle()
        if (data && data.value != null) enabled = data.value === true || data.value === 'true'
      } catch { /* table missing → treat as disabled (admin-only) */ }
      return { enabled, isAdmin, canUse: enabled || isAdmin, seeAll: isAdmin, me }
    },

    async setAccess(enabled: boolean) {
      const { error } = await client.from(settingsTable).upsert({ key: 'enabled', value: enabled }, { onConflict: 'key' })
      err(error)
      return { message: enabled ? 'Enabled for all users' : 'ADMIN-only' }
    },

    async list(): Promise<Annotation[]> {
      const { data, error } = await client.from(table).select('*').order('id', { ascending: false }).limit(listLimit)
      err(error)
      const rows = (data ?? []) as Annotation[]
      await signPaths(rows)
      return rows
    },

    async save(input: NewAnnotation) {
      // created_by / name / role + timestamps are stamped server-side by the trigger (never trusted
      // from the client), so we only send the mark's own fields.
      const { data, error } = await client.from(table).insert({ ...input, status: 'open' }).select('id').single()
      err(error)
      return { id: (data as { id: number }).id }
    },

    async update(patch: AnnotationPatch) {
      const { id, ...rest } = patch
      const { error } = await client.from(table).update(rest).eq('id', id)
      err(error)
    },

    async remove(id: number) {
      const { data } = await client.from(table).select('screenshot_path').eq('id', id).maybeSingle()
      const { error } = await client.from(table).delete().eq('id', id)
      err(error)
      const path = (data as { screenshot_path?: string } | null)?.screenshot_path
      if (path) {
        urlCache.delete(path)
        const { error: se } = await client.storage.from(bucket).remove([path])
        if (se) console.warn('[annotate] screenshot delete failed', se.message)
      }
    },

    async addReply(id: number, note: string) {
      // atomic append via SQL RPC — no read-modify-write race
      const { error } = await client.rpc('annotate_add_reply', { p_id: id, p_note: note })
      err(error)
    },

    async clearResolved() {
      const { data } = await client.from(table).select('id, screenshot_path').in('status', ['done', 'dismissed'])
      const rows = (data ?? []) as { id: number; screenshot_path?: string }[]
      const ids = rows.map((r) => r.id)
      const paths = rows.map((r) => r.screenshot_path).filter(Boolean) as string[]
      if (ids.length) { const { error } = await client.from(table).delete().in('id', ids); err(error) }
      if (paths.length) {
        paths.forEach((p) => urlCache.delete(p))
        const { error: se } = await client.storage.from(bucket).remove(paths)
        if (se) console.warn('[annotate] screenshot cleanup failed', se.message)
      }
      return { message: `Cleared ${ids.length} resolved` }
    },

    async uploadScreenshot(file: File, opts?: { visibility?: AnnVisibility }) {
      const vis = opts?.visibility === 'public' ? 'public' : 'private'
      const rand = Math.random().toString(36).slice(2, 8)
      const path = `${vis}/${await uid()}/${Date.now()}-${rand}.png`
      const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type || 'image/png', upsert: false })
      err(error)
      return { path }
    },

    subscribe(onChange: () => void) {
      // Realtime is RLS-aware; onChange just triggers a re-list(). Requires the table to be in the
      // supabase_realtime publication (the migration adds it).
      const channel = client
        .channel(`annotate:${table}:${Math.random().toString(36).slice(2, 8)}`)   // unique topic — no duplicate-subscribe clash
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
        .subscribe()
      return () => { void client.removeChannel(channel) }
    },
  }
}
