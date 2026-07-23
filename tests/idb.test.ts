import { describe, it, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createIdbAdapter } from '../src/adapters/idb'
import type { NewAnnotation } from '../src/types'

const mark = (over: Partial<NewAnnotation> = {}): NewAnnotation => ({
  page_route: '/x', page_title: 'X', target_selector: '', target_text: '', pos_x: 0, pos_y: 0,
  viewport_w: 0, viewport_h: 0, note: 'hi', type: 'change', priority: 'med', visibility: 'private',
  ...over,
} as NewAnnotation)

describe('createIdbAdapter', () => {
  it('saves with autoIncrement ids, lists desc, updates, replies, clears, removes', async () => {
    const a = createIdbAdapter({ factory: new IDBFactory(), me: { email: 'me@x', name: 'Me' } })
    const access = await a.getAccess()
    expect(access.isAdmin).toBe(true)
    expect(access.canUse).toBe(true)

    const r1 = await a.save(mark({ note: 'first' }))
    const r2 = await a.save(mark({ note: 'second' }))
    expect(r1.id).toBe(1)
    expect(r2.id).toBe(2)

    let rows = await a.list()
    expect(rows.map((r) => r.note)).toEqual(['second', 'first'])   // sorted desc by id
    expect(rows[0].created_by).toBe('me@x')

    await a.update({ id: r1.id, status: 'done', note: 'edited' })
    await a.addReply(r2.id, 'a reply')
    rows = await a.list()
    const first = rows.find((r) => r.id === r1.id)!
    expect(first.status).toBe('done')
    expect(first.note).toBe('edited')
    expect(rows.find((r) => r.id === r2.id)!.replies?.[0].note).toBe('a reply')

    const cleared = await a.clearResolved()
    expect(cleared.message).toContain('1')
    rows = await a.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(r2.id)

    await a.remove(r2.id)
    expect(await a.list()).toHaveLength(0)
  })

  it('persists the enabled toggle', async () => {
    const a = createIdbAdapter({ factory: new IDBFactory() })
    expect((await a.getAccess()).enabled).toBe(true)
    await a.setAccess(false)
    expect((await a.getAccess()).enabled).toBe(false)
  })
})
