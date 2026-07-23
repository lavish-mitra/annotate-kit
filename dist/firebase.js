// src/adapters/firebase.ts
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  runTransaction,
  onSnapshot
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
function prune(o) {
  if (Array.isArray(o)) return o.map((v) => prune(v));
  if (o && typeof o === "object") {
    const out = {};
    for (const [k, v] of Object.entries(o)) if (v !== void 0) out[k] = prune(v);
    return out;
  }
  return o;
}
function createFirebaseAdapter(config) {
  const db = config.firestore;
  const storage = config.storage;
  const auth = config.auth;
  const collPath = config.collectionPath ?? "annotations";
  const settingsFullPath = config.settingsPath ?? "annotate_settings/global";
  if (settingsFullPath.split("/").filter(Boolean).length % 2 !== 0) {
    throw new Error(`annotate: settingsPath must be a document path like 'collection/doc' (got '${settingsFullPath}')`);
  }
  const storageDir = config.storagePath ?? "annotations";
  const listLimit = config.listLimit ?? 1e3;
  const col = collection(db, collPath);
  const settingsRef = doc(db, settingsFullPath);
  const urlCache = /* @__PURE__ */ new Map();
  async function claims() {
    if (!auth?.currentUser) return {};
    try {
      return (await auth.currentUser.getIdTokenResult()).claims;
    } catch {
      return {};
    }
  }
  async function resolveUser() {
    if (config.currentUser) return await config.currentUser() ?? {};
    const u = auth?.currentUser;
    if (!u) return {};
    const c = await claims();
    return { email: u.email ?? void 0, name: u.displayName ?? u.email ?? void 0, role: c.role || void 0 };
  }
  async function resolveIsAdmin(user) {
    if (typeof config.isAdmin === "boolean") return config.isAdmin;
    if (typeof config.isAdmin === "function") return !!await config.isAdmin(user);
    const c = await claims();
    return c.admin === true || c.role === "admin";
  }
  async function urlFor(path) {
    if (!path) return null;
    const hit = urlCache.get(path);
    if (hit) return hit;
    try {
      const u = await getDownloadURL(ref(storage, path));
      urlCache.set(path, u);
      return u;
    } catch {
      return null;
    }
  }
  return {
    async getAccess() {
      const me = await resolveUser();
      const isAdmin = await resolveIsAdmin(me);
      let enabled = false;
      try {
        const snap = await getDoc(settingsRef);
        if (snap.exists() && typeof snap.data().enabled === "boolean") enabled = snap.data().enabled;
      } catch {
      }
      return { enabled, isAdmin, canUse: enabled || isAdmin, seeAll: isAdmin, me };
    },
    async setAccess(enabled) {
      await setDoc(settingsRef, { enabled }, { merge: true });
      return { message: enabled ? "Enabled for all users" : "ADMIN-only" };
    },
    async list() {
      const me = await resolveUser();
      const isAdmin = await resolveIsAdmin(me);
      const seen = /* @__PURE__ */ new Map();
      const collect = (docs) => {
        for (const d of docs) {
          const data = d.data();
          const id = typeof data.id === "number" ? data.id : Number(d.id);
          seen.set(id, { ...data, id });
        }
      };
      if (isAdmin) {
        const s = await getDocs(query(col, orderBy("id", "desc"), limit(listLimit)));
        collect(s.docs);
      } else {
        const [pub, mine] = await Promise.all([
          getDocs(query(col, where("visibility", "==", "public"), orderBy("id", "desc"), limit(listLimit))),
          me.email ? getDocs(query(col, where("created_by", "==", me.email), orderBy("id", "desc"), limit(listLimit))) : Promise.resolve({ docs: [] })
        ]);
        collect(pub.docs);
        collect(mine.docs);
      }
      const rows = [...seen.values()].sort((a, b) => b.id - a.id);
      await Promise.all(rows.map(async (r) => {
        if (r.screenshot_path) r.screenshot_url = await urlFor(r.screenshot_path);
      }));
      return rows;
    },
    async save(input) {
      const me = await resolveUser();
      const base = {
        ...input,
        status: "open",
        created_by: me.email ?? "",
        created_by_name: me.name ?? me.email ?? "",
        created_by_role: me.role ?? null,
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      let id = 0;
      await runTransaction(db, async (tx) => {
        for (let i = 0; i < 6; i++) {
          const cand = Date.now() * 1e3 + Math.floor(Math.random() * 1e3);
          const dref = doc(col, String(cand));
          const snap = await tx.get(dref);
          if (!snap.exists()) {
            id = cand;
            tx.set(dref, prune({ ...base, id }));
            return;
          }
        }
        throw new Error("annotate: could not allocate a unique id \u2014 retry");
      });
      return { id };
    },
    async update(patch) {
      const { id, ...rest } = patch;
      await updateDoc(doc(col, String(id)), { ...prune(rest), updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    },
    async remove(id) {
      const snap = await getDoc(doc(col, String(id)));
      const path = snap.exists() ? snap.data().screenshot_path : void 0;
      await deleteDoc(doc(col, String(id)));
      if (path) {
        urlCache.delete(path);
        try {
          await deleteObject(ref(storage, path));
        } catch (e) {
          console.warn("[annotate] screenshot delete failed", e);
        }
      }
    },
    async addReply(id, note) {
      const me = await resolveUser();
      const reply = { note: note.slice(0, 2e3), author: me.name ?? me.email ?? "", at: (/* @__PURE__ */ new Date()).toISOString() };
      await updateDoc(doc(col, String(id)), { replies: arrayUnion(reply), updated_at: (/* @__PURE__ */ new Date()).toISOString() });
    },
    async clearResolved() {
      const s = await getDocs(query(col, where("status", "in", ["done", "dismissed"])));
      await Promise.all(s.docs.map(async (d) => {
        const path = d.data().screenshot_path;
        await deleteDoc(d.ref);
        if (path) {
          urlCache.delete(path);
          try {
            await deleteObject(ref(storage, path));
          } catch (e) {
            console.warn("[annotate] screenshot delete failed", e);
          }
        }
      }));
      return { message: `Cleared ${s.docs.length} resolved` };
    },
    async uploadScreenshot(file, opts) {
      const vis = opts?.visibility === "public" ? "public" : "private";
      const uid = auth?.currentUser?.uid;
      if (!uid) throw new Error("annotate: must be signed in to upload a screenshot");
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${storageDir}/${vis}/${uid}/${Date.now()}-${rand}.png`;
      await uploadBytes(ref(storage, path), file, { contentType: file.type || "image/png" });
      return { path };
    },
    subscribe(onChange) {
      return onSnapshot(query(col, where("visibility", "==", "public")), () => onChange(), () => {
      });
    }
  };
}
export {
  createFirebaseAdapter
};
