// src/adapters/local.ts
function createLocalAdapter(config = {}) {
  const key = config.storageKey ?? "annotate-kit";
  const me = config.me ?? { email: "you@local", name: "You" };
  const store = config.storage ?? (typeof localStorage !== "undefined" ? localStorage : void 0);
  const now = () => (/* @__PURE__ */ new Date()).toISOString();
  const empty = () => ({ seq: 1, rows: [], settings: { enabled: true }, shots: {} });
  const read = () => {
    if (!store) return empty();
    try {
      const raw = store.getItem(key);
      if (!raw) return empty();
      const s = JSON.parse(raw);
      return {
        seq: typeof s.seq === "number" ? s.seq : 1,
        rows: Array.isArray(s.rows) ? s.rows : [],
        settings: s.settings && typeof s.settings.enabled === "boolean" ? s.settings : { enabled: true },
        shots: s.shots && typeof s.shots === "object" ? s.shots : {}
      };
    } catch {
      return empty();
    }
  };
  const write = (s) => {
    if (!store) return;
    try {
      store.setItem(key, JSON.stringify(s));
    } catch {
      throw new Error("annotate: local storage is full or unavailable \u2014 the change could not be saved");
    }
  };
  const withUrls = (s) => s.rows.map((r) => ({ ...r, screenshot_url: r.screenshot_path ? s.shots[r.screenshot_path] ?? null : null }));
  return {
    async getAccess() {
      return { enabled: read().settings.enabled, isAdmin: true, canUse: true, seeAll: true, me };
    },
    async setAccess(enabled) {
      const s = read();
      s.settings.enabled = enabled;
      write(s);
      return { message: enabled ? "Enabled" : "Disabled" };
    },
    async list() {
      return withUrls(read()).sort((a, b) => b.id - a.id);
    },
    async save(input) {
      const s = read();
      const id = s.seq++;
      s.rows.push({
        ...input,
        id,
        status: "open",
        created_by: me.email ?? "",
        created_by_name: me.name ?? me.email ?? "",
        created_by_role: me.role ?? null,
        created_at: now(),
        updated_at: now()
      });
      write(s);
      return { id };
    },
    async update(patch) {
      const s = read();
      const { id, ...rest } = patch;
      const row = s.rows.find((r) => r.id === id);
      if (row) {
        Object.assign(row, rest, { updated_at: now() });
        write(s);
      }
    },
    async remove(id) {
      const s = read();
      const row = s.rows.find((r) => r.id === id);
      if (row?.screenshot_path) delete s.shots[row.screenshot_path];
      s.rows = s.rows.filter((r) => r.id !== id);
      write(s);
    },
    async addReply(id, note) {
      const s = read();
      const row = s.rows.find((r) => r.id === id);
      if (row) {
        const reply = { note: note.slice(0, 2e3), author: me.name ?? me.email ?? "", at: now() };
        row.replies = [...Array.isArray(row.replies) ? row.replies : [], reply];
        row.updated_at = now();
        write(s);
      }
    },
    async clearResolved() {
      const s = read();
      const before = s.rows.length;
      for (const r of s.rows) if ((r.status === "done" || r.status === "dismissed") && r.screenshot_path) delete s.shots[r.screenshot_path];
      s.rows = s.rows.filter((r) => r.status !== "done" && r.status !== "dismissed");
      const referenced = new Set(s.rows.map((r) => r.screenshot_path).filter(Boolean));
      for (const p of Object.keys(s.shots)) if (!referenced.has(p)) delete s.shots[p];
      write(s);
      return { message: `Cleared ${before - s.rows.length} resolved` };
    },
    async uploadScreenshot(file, _opts) {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error ?? new Error("read failed"));
        fr.readAsDataURL(file);
      });
      const s = read();
      const path = `shot-${s.seq++}-${Date.now()}`;
      s.shots[path] = dataUrl;
      write(s);
      return { path };
    }
  };
}
export {
  createLocalAdapter
};
