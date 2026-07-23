import { describe, it, expect } from 'vitest'
import { githubIssueDelivery, createWebhookDelivery, createSlackDelivery } from '../src/delivery'
import type { Annotation } from '../src/types'

const base: Annotation = {
  id: 1, page_route: '/dashboard', page_title: 'Dashboard', target_selector: 'button.save',
  target_text: 'Save', pos_x: 0, pos_y: 0, viewport_w: 0, viewport_h: 0,
  note: 'Make this green', type: 'style', priority: 'high', status: 'open', kind: 'pin',
}

describe('delivery targets', () => {
  it('githubIssueDelivery builds a prefilled new-issue URL', () => {
    const d = githubIssueDelivery({ repo: 'lavish-mitra/annotate-kit' })
    const url = d.href!([base])
    expect(url.startsWith('https://github.com/lavish-mitra/annotate-kit/issues/new?')).toBe(true)
    expect(url).toContain('title=')
    expect(url).toContain(encodeURIComponent('Make this green'))
    expect(d.run).toBeUndefined()
  })

  it('createWebhookDelivery POSTs prompt + context JSON', async () => {
    let captured: { url: string; body: unknown } | null = null
    const fakeFetch = (async (url: unknown, init: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init.body)) }
      return { ok: true, status: 200 }
    }) as unknown as typeof fetch
    const d = createWebhookDelivery({ url: 'https://x.test/hook', fetch: fakeFetch })
    await d.run!([base])
    expect(captured!.url).toBe('https://x.test/hook')
    const body = captured!.body as { prompt: string; context: { total: number } }
    expect(body.prompt).toContain('Make this green')
    expect(body.context.total).toBe(1)
  })

  it('createSlackDelivery throws on a non-ok response', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    const d = createSlackDelivery({ webhookUrl: 'https://hooks.slack.test/x', fetch: fakeFetch })
    await expect(d.run!([base])).rejects.toThrow(/slack 500/)
  })
})
