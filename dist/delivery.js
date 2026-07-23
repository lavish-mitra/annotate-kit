import {
  buildDevContext,
  buildDevPrompt
} from "./chunk-G44KPHPN.js";

// src/delivery.ts
function githubIssueDelivery(opts) {
  const repoPath = opts.repo.split("/").map(encodeURIComponent).join("/");
  return {
    label: opts.label ?? "GitHub issue",
    href: (items) => {
      const title = `${opts.titlePrefix ?? "Feedback"}: ${items.length} item(s)`;
      const trimLone = (s) => /[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s;
      let body = trimLone(buildDevPrompt(items));
      while (body.length > 200 && encodeURIComponent(body).length > 6e3) body = trimLone(body.slice(0, Math.floor(body.length * 0.9)));
      return `https://github.com/${repoPath}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    }
  };
}
function createWebhookDelivery(opts) {
  return {
    label: opts.label ?? "Webhook",
    run: async (items) => {
      const f = opts.fetch ?? fetch;
      const res = await f(opts.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...opts.headers },
        body: JSON.stringify({ prompt: buildDevPrompt(items), context: buildDevContext(items) })
      });
      if (!res.ok) throw new Error(`annotate delivery: webhook ${res.status}`);
    }
  };
}
function createSlackDelivery(opts) {
  return {
    label: opts.label ?? "Slack",
    run: async (items) => {
      const f = opts.fetch ?? fetch;
      const res = await f(opts.webhookUrl, { method: "POST", body: JSON.stringify({ text: buildDevPrompt(items).slice(0, 3500) }) });
      if (!res.ok) throw new Error(`annotate delivery: slack ${res.status}`);
    }
  };
}
export {
  createSlackDelivery,
  createWebhookDelivery,
  githubIssueDelivery
};
