// Supabase storage adapter — talks directly to Postgres + Storage via supabase-js.
// No Edge Function to deploy: apply backend/supabase/migration.sql once (table + RLS + bucket + policies)
// and this adapter does the rest. Row-level security is the real gate; this is just the client.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StorageAdapter } from '../adapter'
import type { Annotation, NewAnnotation, AnnotationPatch, AnnotateAccess } from '../types'

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

  let _adminFromClaims = false
  async function resolveUser(): Promise<ResolvedUser> {
    if (config.currentUser) return (await config.currentUser()) ?? {}
    const { data } = await client.auth.getUser()
    const u = data.user
    if (!u) return {}
    const md = (u.user_metadata ?? {}) as Record<string, unknown>
    const am = (u.app_metadata ?? {}) as Record<string, unknown>
    _adminFromClaims = am.role === 'admin' || am.annotate_admin === true
    return {
      email: u.email ?? (md.email as string | undefined),
      name: (md.full_name as string) || (md.name as string) || u.email || undefined,
      role: (am.role as string) || (md.role as string) || undefined,
    }
  }
  async function resolveIsAdmin(user: ResolvedUser): Promise<boolean> {
    if (typeof config.isAdmin === 'boolean') return config.isAdmin
    if (typeof config.isAdmin === 'function') return !!(await config.isAdmin(user))
    return _adminFromClaims
  }
  const err = (e: { message?: string } | null) => { if (e?.message) throw new Error(e.message) }

  return {
    async getAccess(): Promise<AnnotateAccess> {
      const me = await resolveUser()
      const isAdmin = await resolveIsAdmin(me)
      let enabled = true
      try {
        const { data } = await client.from(settingsTable).select('value').eq('key', 'enabled').maybeSingle()
        if (data && data.value != null) enabled = data.value === true || data.value === 'true'
      } catch { /* table missing → default enabled */ }
      return { enabled, isAdmin, canUse: enabled || isAdmin, seeAll: isAdmin, me }
    },

    async setAccess(enabled: boolean) {
      const { error } = await client.from(settingsTable).upsert({ key: 'enabled', value: enabled }, { onConflict: 'key' })
      err(error)
      return { message: enabled ? 'Enabled for all users' : 'ADMIN-only' }
    },

    async list(): Promise<Annotation[]> {
      const { data, error } = await client.from(table).select('*').order('id', { ascending: false })
      err(error)
      const rows = (data ?? []) as Annotation[]
      await Promise.all(rows.map(async (r) => {
        if (r.screenshot_path) {
          const { data: s } = await client.storage.from(bucket).createSignedUrl(r.screenshot_path, ttl)
          r.screenshot_url = s?.signedUrl ?? null
        }
      }))
      return rows
    },

    async save(input: NewAnnotation) {
      const me = await resolveUser()
      const row = { ...input, status: 'open', created_by: me.email ?? '', created_by_name: me.name ?? me.email ?? '', created_by_role: me.role ?? null }
      const { data, error } = await client.from(table).insert(row).select('id').single()
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
      if (path) await client.storage.from(bucket).remove([path])
    },

    async addReply(id: number, note: string) {
      const me = await resolveUser()
      const { data } = await client.from(table).select('replies').eq('id', id).maybeSingle()
      const replies = Array.isArray((data as { replies?: unknown })?.replies) ? (data as { replies: unknown[] }).replies : []
      replies.push({ note, author: me.name ?? me.email ?? '', at: new Date().toISOString() })
      const { error } = await client.from(table).update({ replies }).eq('id', id)
      err(error)
    },

    async clearResolved() {
      const { data } = await client.from(table).select('id, screenshot_path').in('status', ['done', 'dismissed'])
      const rows = (data ?? []) as { id: number; screenshot_path?: string }[]
      const ids = rows.map((r) => r.id)
      const paths = rows.map((r) => r.screenshot_path).filter(Boolean) as string[]
      if (ids.length) { const { error } = await client.from(table).delete().in('id', ids); err(error) }
      if (paths.length) await client.storage.from(bucket).remove(paths)
      return { message: `Cleared ${ids.length} resolved` }
    },

    async uploadScreenshot(file: File) {
      const me = await resolveUser()
      const safe = (me.email ?? 'anon').replace(/[^a-z0-9._-]/gi, '_')
      const rand = Math.random().toString(36).slice(2, 8)
      const path = `${safe}/${Date.now()}-${rand}.png`
      const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type || 'image/png', upsert: false })
      err(error)
      return { path }
    },
  }
}
