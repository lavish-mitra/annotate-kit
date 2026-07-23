import { describe, it, expect } from 'vitest'
import { createLocalAdapter } from '../src/adapters/local'
import type { NewAnnotation } from '../src/types'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, v) },
  } as Storage
}

const mark = (over: Partial<NewAnnotation> = {}): NewAnnotation => ({
  page_route: '/x', page_title: 'X', target_selector: '', target_text: '', pos_x: 0, pos_y: 0,
  viewport_w: 0, viewport_h: 0, note: 'hi', type: 'change', priority: 'med', visibility: 'private',
  ...over,
} as NewAnnotation)

describe('createLocalAdapter', () => {
  it('saves, lists, updates, replies, persists, removes — all in the given storage', async () => {
    const storage = fakeStorage()
    const a = createLocalAdapter({ storage, me: { email: 'me@x', name: 'Me' } })

    const access = await a.getAccess()
    expect(access.canUse).toBe(true)
    expect(access.isAdmin).toBe(true)

    const { id } = await a.save(mark({ note: 'hi' }))
    let rows = await a.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].note).toBe('hi')
    expect(rows[0].created_by).toBe('me@x')
    expect(rows[0].status).toBe('open')

    await a.update({ id, status: 'done' })
    await a.addReply(id, 'a reply')
    rows = await a.list()
    expect(rows[0].status).toBe('done')
    expect(rows[0].replies?.[0].note).toBe('a reply')

    // a fresh adapter over the same storage sees the persisted data
    const b = createLocalAdapter({ storage })
    expect(await b.list()).toHaveLength(1)

    await a.remove(id)
    expect(await a.list()).toHaveLength(0)
  })

  it('clearResolved drops only done/dismissed', async () => {
    const storage = fakeStorage()
    const a = createLocalAdapter({ storage })
    await a.save(mark({ note: 'keep' }))
    const r2 = await a.save(mark({ note: 'gone' }))
    await a.update({ id: r2.id, status: 'done' })
    const res = await a.clearResolved()
    expect(res.message).toContain('1')
    const rows = await a.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].note).toBe('keep')
  })
})
