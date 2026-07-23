// Optional "send to…" targets for the Send panel. All are OFF by default and configured by the
// integrator — annotate-kit never requires a third-party account. A URL target (githubIssueDelivery)
// needs no token at all; POST targets (webhook/Slack) use a URL the integrator provides.
//
// NOTE: webhook/Slack targets run in the BROWSER, so their URL + headers are visible to end users
// (bundle + Network tab). Point them at non-secret endpoints, or proxy anything sensitive through
// your own first-party server route.
import type { Annotation } from './types'
import { buildDevPrompt, buildDevContext } from './prompt'

export type Delivery = {
  /** Button label shown in the Send panel. */
  label: string
  /** URL target — opens a prefilled page in a new tab (no token needed). */
  href?: (items: Annotation[]) => string
  /** POST target — invoked on click (webhook / Slack / your API). */
  run?: (items: Annotation[]) => Promise<void> | void
}

/** Zero-config: open a prefilled "New issue" page for a GitHub repo. No token required. */
export function githubIssueDelivery(opts: { repo: string; label?: string; titlePrefix?: string }): Delivery {
  const repoPath = opts.repo.split('/').map(encodeURIComponent).join('/')
  return {
    label: opts.label ?? 'GitHub issue',
    href: (items) => {
      const title = `${opts.titlePrefix ?? 'Feedback'}: ${items.length} item(s)`
      // trim a trailing lone high-surrogate so a split emoji never crashes encodeURIComponent
      const trimLone = (s: string) => (/[\uD800-\uDBFF]$/.test(s) ? s.slice(0, -1) : s)
      let body = trimLone(buildDevPrompt(items))
      // GitHub's prefilled-URL limit is ~8KB AFTER encoding — shrink until the encoded body fits.
      while (body.length > 200 && encodeURIComponent(body).length > 6000) body = trimLone(body.slice(0, Math.floor(body.length * 0.9)))
      return `https://github.com/${repoPath}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
    },
  }
}

/** POST the markdown prompt + structured context to any HTTP endpoint you control. */
export function createWebhookDelivery(opts: { url: string; label?: string; headers?: Record<string, string>; fetch?: typeof fetch }): Delivery {
  return {
    label: opts.label ?? 'Webhook',
    run: async (items) => {
      const f = opts.fetch ?? fetch
      const res = await f(opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...opts.headers },
        body: JSON.stringify({ prompt: buildDevPrompt(items), context: buildDevContext(items) }),
      })
      if (!res.ok) throw new Error(`annotate delivery: webhook ${res.status}`)
    },
  }
}

/** POST the prompt to a Slack Incoming Webhook URL (the integrator creates it). */
export function createSlackDelivery(opts: { webhookUrl: string; label?: string; fetch?: typeof fetch }): Delivery {
  return {
    label: opts.label ?? 'Slack',
    run: async (items) => {
      const f = opts.fetch ?? fetch
      const res = await f(opts.webhookUrl, { method: 'POST', body: JSON.stringify({ text: buildDevPrompt(items).slice(0, 3500) }) })
      if (!res.ok) throw new Error(`annotate delivery: slack ${res.status}`)
    },
  }
}
