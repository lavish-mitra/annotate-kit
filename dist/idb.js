// src/adapters/idb.ts
var MARKS = "marks";
var SHOTS = "shots";
var SETTINGS = "settings";
function createIdbAdapter(config = {}) {
  const dbName = config.dbName ?? "annotate-kit";
  const me = config.me ?? { email: "you@local", name: "You" };
  const idb = config.factory ?? (typeof indexedDB !== "undefined" ? indexedDB : void 0);
  const now = () => (/* @__PURE__ */ new Date()).toISOString();
  const canObjectUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  const urlCache = /* @__PURE__ */ new Map();
  let dbp = null;
  function db() {
    if (!idb) return Promise.reject(new Error("annotate: IndexedDB is unavailable \u2014 pass config.factory or use another adapter"));
    if (!dbp) dbp = new Promise((resolve, reject) => {
      const req = idb.open(dbName, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(MARKS)) d.createObjectStore(MARKS, { keyPath: "id", autoIncrement: true });
        if (!d.objectStoreNames.contains(SHOTS)) d.createObjectStore(SHOTS);
        if (!d.objectStoreNames.contains(SETTINGS)) d.createObjectStore(SETTINGS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function run(stores, mode, body) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      const out = {};
      try {
        body(t, out);
      } catch (e) {
        reject(e);
        try {
          t.abort();
        } catch {
        }
        return;
      }
      t.oncomplete = () => resolve(out.value);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  return {
    async getAccess() {
      const enabled = await run([SETTINGS], "readonly", (t, out) => {
        const g = t.objectStore(SETTINGS).get("enabled");
        g.onsuccess = () => {
          out.value = g.result === void 0 ? true : !!g.result;
        };
      });
      return { enabled: enabled ?? true, isAdmin: true, canUse: true, seeAll: true, me };
    },
    async setAccess(enabled) {
      await run([SETTINGS], "readwrite", (t) => {
        t.objectStore(SETTINGS).put(enabled, "enabled");
      });
      return { message: enabled ? "Enabled" : "Disabled" };
    },
    async list() {
      const rows = await run([MARKS, SHOTS], "readonly", (t, out) => {
        const shots = t.objectStore(SHOTS);
        const ga = t.objectStore(MARKS).getAll();
        ga.onsuccess = () => {
          const all = ga.result || [];
          for (const r of all) {
            if (r.screenshot_path && canObjectUrl) {
              const cached = urlCache.get(r.screenshot_path);
              if (cached) r.screenshot_url = cached;
              else {
                const sr = shots.get(r.screenshot_path);
                sr.onsuccess = () => {
                  const b = sr.result;
                  if (b) {
                    const u = URL.createObjectURL(b);
                    urlCache.set(r.screenshot_path, u);
                    r.screenshot_url = u;
                  }
                };
              }
            }
          }
          out.value = all;
        };
      });
      return (rows ?? []).sort((a, b) => b.id - a.id);
    },
    async save(input) {
      const row = {
        ...input,
        status: "open",
        created_by: me.email ?? "",
        created_by_name: me.name ?? me.email ?? "",
        created_by_role: me.role ?? null,
        created_at: now(),
        updated_at: now()
      };
      const id = await run([MARKS], "readwrite", (t, out) => {
        const add = t.objectStore(MARKS).add(row);
        add.onsuccess = () => {
          out.value = Number(add.result);
        };
      });
      return { id: id ?? 0 };
    },
    async update(patch) {
      const { id, ...rest } = patch;
      await run([MARKS], "readwrite", (t) => {
        const store = t.objectStore(MARKS);
        const g = store.get(id);
        g.onsuccess = () => {
          const row = g.result;
          if (row) {
            Object.assign(row, rest, { updated_at: now() });
            store.put(row);
          }
        };
      });
    },
    async remove(id) {
      await run([MARKS, SHOTS], "readwrite", (t) => {
        const marks = t.objectStore(MARKS);
        const g = marks.get(id);
        g.onsuccess = () => {
          const row = g.result;
          marks.delete(id);
          if (row?.screenshot_path) {
            t.objectStore(SHOTS).delete(row.screenshot_path);
            const u = urlCache.get(row.screenshot_path);
            if (u && canObjectUrl) URL.revokeObjectURL(u);
            urlCache.delete(row.screenshot_path);
          }
        };
      });
    },
    async addReply(id, note) {
      await run([MARKS], "readwrite", (t) => {
        const store = t.objectStore(MARKS);
        const g = store.get(id);
        g.onsuccess = () => {
          const row = g.result;
          if (row) {
            const reply = { note: note.slice(0, 2e3), author: me.name ?? me.email ?? "", at: now() };
            row.replies = [...Array.isArray(row.replies) ? row.replies : [], reply];
            row.updated_at = now();
            store.put(row);
          }
        };
      });
    },
    async clearResolved() {
      const removed = await run([MARKS, SHOTS], "readwrite", (t, out) => {
        const marks = t.objectStore(MARKS);
        const shots = t.objectStore(SHOTS);
        const ga = marks.getAll();
        ga.onsuccess = () => {
          const all = ga.result || [];
          let n = 0;
          const referenced = /* @__PURE__ */ new Set();
          for (const r of all) {
            if (r.status === "done" || r.status === "dismissed") {
              marks.delete(r.id);
              n++;
              if (r.screenshot_path) {
                const u = urlCache.get(r.screenshot_path);
                if (u && canObjectUrl) URL.revokeObjectURL(u);
                urlCache.delete(r.screenshot_path);
              }
            } else if (r.screenshot_path) referenced.add(r.screenshot_path);
          }
          const gk = shots.getAllKeys();
          gk.onsuccess = () => {
            for (const k of gk.result || []) {
              const key = String(k);
              if (!referenced.has(key)) {
                shots.delete(k);
                const u = urlCache.get(key);
                if (u && canObjectUrl) URL.revokeObjectURL(u);
                urlCache.delete(key);
              }
            }
          };
          out.value = n;
        };
      });
      return { message: `Cleared ${removed ?? 0} resolved` };
    },
    async uploadScreenshot(file, _opts) {
      const path = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await run([SHOTS], "readwrite", (t) => {
        t.objectStore(SHOTS).put(file, path);
      });
      return { path };
    }
  };
}
export {
  createIdbAdapter
};
