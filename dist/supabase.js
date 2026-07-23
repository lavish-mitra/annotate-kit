// src/adapters/supabase.ts
function createSupabaseAdapter(config) {
  const client = config.client;
  const table = config.table ?? "annotations";
  const bucket = config.bucket ?? "annotations";
  const settingsTable = config.settingsTable ?? "annotate_settings";
  const ttl = config.signedUrlTtl ?? 3600;
  let _adminFromClaims = false;
  async function resolveUser() {
    if (config.currentUser) return await config.currentUser() ?? {};
    const { data } = await client.auth.getUser();
    const u = data.user;
    if (!u) return {};
    const md = u.user_metadata ?? {};
    const am = u.app_metadata ?? {};
    _adminFromClaims = am.role === "admin" || am.annotate_admin === true;
    return {
      email: u.email ?? md.email,
      name: md.full_name || md.name || u.email || void 0,
      role: am.role || md.role || void 0
    };
  }
  async function resolveIsAdmin(user) {
    if (typeof config.isAdmin === "boolean") return config.isAdmin;
    if (typeof config.isAdmin === "function") return !!await config.isAdmin(user);
    return _adminFromClaims;
  }
  const err = (e) => {
    if (e?.message) throw new Error(e.message);
  };
  return {
    async getAccess() {
      const me = await resolveUser();
      const isAdmin = await resolveIsAdmin(me);
      let enabled = true;
      try {
        const { data } = await client.from(settingsTable).select("value").eq("key", "enabled").maybeSingle();
        if (data && data.value != null) enabled = data.value === true || data.value === "true";
      } catch {
      }
      return { enabled, isAdmin, canUse: enabled || isAdmin, seeAll: isAdmin, me };
    },
    async setAccess(enabled) {
      const { error } = await client.from(settingsTable).upsert({ key: "enabled", value: enabled }, { onConflict: "key" });
      err(error);
      return { message: enabled ? "Enabled for all users" : "ADMIN-only" };
    },
    async list() {
      const { data, error } = await client.from(table).select("*").order("id", { ascending: false });
      err(error);
      const rows = data ?? [];
      await Promise.all(rows.map(async (r) => {
        if (r.screenshot_path) {
          const { data: s } = await client.storage.from(bucket).createSignedUrl(r.screenshot_path, ttl);
          r.screenshot_url = s?.signedUrl ?? null;
        }
      }));
      return rows;
    },
    async save(input) {
      const me = await resolveUser();
      const row = { ...input, status: "open", created_by: me.email ?? "", created_by_name: me.name ?? me.email ?? "", created_by_role: me.role ?? null };
      const { data, error } = await client.from(table).insert(row).select("id").single();
      err(error);
      return { id: data.id };
    },
    async update(patch) {
      const { id, ...rest } = patch;
      const { error } = await client.from(table).update(rest).eq("id", id);
      err(error);
    },
    async remove(id) {
      const { data } = await client.from(table).select("screenshot_path").eq("id", id).maybeSingle();
      const { error } = await client.from(table).delete().eq("id", id);
      err(error);
      const path = data?.screenshot_path;
      if (path) await client.storage.from(bucket).remove([path]);
    },
    async addReply(id, note) {
      const me = await resolveUser();
      const { data } = await client.from(table).select("replies").eq("id", id).maybeSingle();
      const replies = Array.isArray(data?.replies) ? data.replies : [];
      replies.push({ note, author: me.name ?? me.email ?? "", at: (/* @__PURE__ */ new Date()).toISOString() });
      const { error } = await client.from(table).update({ replies }).eq("id", id);
      err(error);
    },
    async clearResolved() {
      const { data } = await client.from(table).select("id, screenshot_path").in("status", ["done", "dismissed"]);
      const rows = data ?? [];
      const ids = rows.map((r) => r.id);
      const paths = rows.map((r) => r.screenshot_path).filter(Boolean);
      if (ids.length) {
        const { error } = await client.from(table).delete().in("id", ids);
        err(error);
      }
      if (paths.length) await client.storage.from(bucket).remove(paths);
      return { message: `Cleared ${ids.length} resolved` };
    },
    async uploadScreenshot(file) {
      const me = await resolveUser();
      const safe = (me.email ?? "anon").replace(/[^a-z0-9._-]/gi, "_");
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${safe}/${Date.now()}-${rand}.png`;
      const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type || "image/png", upsert: false });
      err(error);
      return { path };
    }
  };
}
export {
  createSupabaseAdapter
};
