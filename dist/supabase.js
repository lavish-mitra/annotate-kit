// src/adapters/supabase.ts
function createSupabaseAdapter(config) {
  const client = config.client;
  const table = config.table ?? "annotations";
  const bucket = config.bucket ?? "annotations";
  const settingsTable = config.settingsTable ?? "annotate_settings";
  const ttl = config.signedUrlTtl ?? 3600;
  const listLimit = config.listLimit ?? 1e3;
  const urlCache = /* @__PURE__ */ new Map();
  async function resolveUser() {
    if (config.currentUser) return await config.currentUser() ?? {};
    const { data } = await client.auth.getUser();
    const u = data.user;
    if (!u) return {};
    const md = u.user_metadata ?? {};
    const am = u.app_metadata ?? {};
    return {
      email: u.email ?? md.email,
      name: md.full_name || md.name || u.email || void 0,
      role: am.role || md.role || void 0
    };
  }
  async function resolveIsAdmin(user) {
    if (typeof config.isAdmin === "boolean") return config.isAdmin;
    if (typeof config.isAdmin === "function") return !!await config.isAdmin(user);
    const { data } = await client.auth.getUser();
    const am = data.user?.app_metadata ?? {};
    return am.role === "admin" || am.annotate_admin === true;
  }
  async function uid() {
    const { data } = await client.auth.getUser();
    if (!data.user?.id) throw new Error("annotate: must be signed in to upload a screenshot");
    return data.user.id;
  }
  const err = (e) => {
    if (e?.message) throw new Error(e.message);
  };
  async function signPaths(rows) {
    const now = Date.now();
    const need = [];
    for (const r of rows) {
      if (!r.screenshot_path) continue;
      const hit = urlCache.get(r.screenshot_path);
      if (hit && hit.exp - now > 6e4) r.screenshot_url = hit.url;
      else need.push(r.screenshot_path);
    }
    if (need.length) {
      const { data } = await client.storage.from(bucket).createSignedUrls(need, ttl);
      const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
      const exp = now + ttl * 1e3;
      for (const r of rows) {
        if (r.screenshot_path && !r.screenshot_url) {
          const url = byPath.get(r.screenshot_path) ?? null;
          if (url) urlCache.set(r.screenshot_path, { url, exp });
          r.screenshot_url = url;
        }
      }
    }
  }
  return {
    async getAccess() {
      const me = await resolveUser();
      const isAdmin = await resolveIsAdmin(me);
      let enabled = false;
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
      const { data, error } = await client.from(table).select("*").order("id", { ascending: false }).limit(listLimit);
      err(error);
      const rows = data ?? [];
      await signPaths(rows);
      return rows;
    },
    async save(input) {
      const { data, error } = await client.from(table).insert({ ...input, status: "open" }).select("id").single();
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
      if (path) {
        urlCache.delete(path);
        const { error: se } = await client.storage.from(bucket).remove([path]);
        if (se) console.warn("[annotate] screenshot delete failed", se.message);
      }
    },
    async addReply(id, note) {
      const { error } = await client.rpc("annotate_add_reply", { p_id: id, p_note: note });
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
      if (paths.length) {
        paths.forEach((p) => urlCache.delete(p));
        const { error: se } = await client.storage.from(bucket).remove(paths);
        if (se) console.warn("[annotate] screenshot cleanup failed", se.message);
      }
      return { message: `Cleared ${ids.length} resolved` };
    },
    async uploadScreenshot(file, opts) {
      const vis = opts?.visibility === "public" ? "public" : "private";
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${vis}/${await uid()}/${Date.now()}-${rand}.png`;
      const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type || "image/png", upsert: false });
      err(error);
      return { path };
    },
    subscribe(onChange) {
      const channel = client.channel(`annotate:${table}:${Math.random().toString(36).slice(2, 8)}`).on("postgres_changes", { event: "*", schema: "public", table }, () => onChange()).subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    }
  };
}
export {
  createSupabaseAdapter
};
