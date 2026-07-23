// src/adapters/rest.ts
function createRestAdapter(config) {
  const base = config.baseUrl.replace(/\/+$/, "");
  const doFetch = config.fetch ?? (typeof fetch !== "undefined" ? fetch : void 0);
  if (!doFetch) throw new Error("annotate: no fetch available \u2014 pass config.fetch");
  const ep = {
    access: `${base}/access`,
    list: base,
    create: base,
    item: (id) => `${base}/${encodeURIComponent(String(id))}`,
    replies: (id) => `${base}/${encodeURIComponent(String(id))}/replies`,
    clearResolved: `${base}/clear-resolved`,
    screenshots: `${base}/screenshots`,
    ...config.endpoints
  };
  async function baseHeaders() {
    return typeof config.headers === "function" ? await config.headers() : config.headers ?? {};
  }
  async function req(url, opts) {
    const headers = { ...await baseHeaders() };
    if (opts?.json !== void 0) headers["content-type"] = "application/json";
    const res = await doFetch(url, {
      method: opts?.method ?? "GET",
      credentials: config.credentials ?? "same-origin",
      headers,
      body: opts?.json !== void 0 ? JSON.stringify(opts.json) : opts?.body
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`annotate REST ${res.status}: ${detail.slice(0, 300)}`);
    }
    const text = await res.text();
    if (!text) return void 0;
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? JSON.parse(text) : text;
  }
  return {
    getAccess: () => req(ep.access),
    setAccess: (enabled) => req(ep.access, { method: "PUT", json: { enabled } }),
    list: () => req(ep.list).then((r) => r ?? []),
    save: (input) => req(ep.create, { method: "POST", json: input }),
    async update(patch) {
      const { id, ...rest } = patch;
      await req(ep.item(id), { method: "PATCH", json: rest });
    },
    async remove(id) {
      await req(ep.item(id), { method: "DELETE" });
    },
    async addReply(id, note) {
      await req(ep.replies(id), { method: "POST", json: { note } });
    },
    clearResolved: () => req(ep.clearResolved, { method: "POST" }),
    async uploadScreenshot(file, opts) {
      const fd = new FormData();
      fd.append("file", file);
      if (opts?.visibility) fd.append("visibility", opts.visibility);
      return req(ep.screenshots, { method: "POST", body: fd });
    }
  };
}
export {
  createRestAdapter
};
