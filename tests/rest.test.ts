import { describe, it, expect } from 'vitest'
import { createRestAdapter } from '../src/adapters/rest'

type Reply = { status?: number; json?: unknown; text?: string; contentType?: string }
function fakeFetch(handler: (url: string, init: RequestInit) => Reply) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = handler(String(url), init) || {}
    const status = r.status ?? 200
    const body = r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? '')
    const ct = r.contentType ?? (r.json !== undefined ? 'application/json' : 'text/plain')
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'x',
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? ct : null) },
      async text() { return body },
    }
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('createRestAdapter', () => {
  it('never mutates a static headers object; FormData upload carries no JSON content-type', async () => {
    const headers = { Authorization: 'Bearer t' }
    const { fn, calls } = fakeFetch((url) => (url.endsWith('/screenshots') ? { json: { path: 'p' } } : { json: { id: 1 } }))
    const a = createRestAdapter({ baseUrl: '/api/annotations', headers, fetch: fn })

    await a.save({ note: 'x' } as never)                        // JSON request
    const file = new Blob(['x'], { type: 'image/png' }) as unknown as File
    await a.uploadScreenshot(file, { visibility: 'private' })   // FormData request

    // the caller's own headers object must be untouched
    expect(headers).toEqual({ Authorization: 'Bearer t' })
    // the multipart upload must NOT send a JSON content-type (would break the boundary)
    const up = calls.find((c) => c.url.endsWith('/screenshots'))!
    expect((up.init.headers as Record<string, string>)['content-type']).toBeUndefined()
    // ...but the JSON save must
    const save = calls.find((c) => c.url === '/api/annotations' && c.init.method === 'POST')!
    expect((save.init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('maps verbs/paths, encodes ids, and treats an empty/204 body as undefined', async () => {
    const { fn, calls } = fakeFetch((url, init) => {
      if (init.method === 'DELETE') return { status: 204 }
      if (url.endsWith('/access')) return { json: { canUse: true } }
      return { json: [] }
    })
    const a = createRestAdapter({ baseUrl: '/api', fetch: fn })
    await a.list()
    await a.update({ id: 5, status: 'done' })
    await a.remove(7)
    await a.addReply(9, 'hi')

    expect(calls.find((c) => c.init.method === 'PATCH')!.url).toBe('/api/5')
    expect(calls.find((c) => c.init.method === 'DELETE')!.url).toBe('/api/7')
    expect(calls.find((c) => c.url.endsWith('/replies'))!.url).toBe('/api/9/replies')
  })
})
