import { describe, it, expect } from 'vitest'
import { buildClaudePrompt } from '../src/prompt'
import type { Annotation } from '../src/types'

const base: Annotation = {
  id: 1, page_route: '/dashboard', page_title: 'Dashboard', target_selector: 'button.save',
  target_text: 'Save', pos_x: 10, pos_y: 20, viewport_w: 1440, viewport_h: 900,
  note: 'Make this green', type: 'style', priority: 'high', status: 'open', kind: 'pin',
}

describe('buildClaudePrompt', () => {
  it('renders an empty-state prompt when nothing is selected', () => {
    const md = buildClaudePrompt([])
    expect(md).toContain('(no annotations selected)')
  })

  it('names the page, element and request', () => {
    const md = buildClaudePrompt([base])
    expect(md).toContain('## Page: `/dashboard`')
    expect(md).toContain('button.save')
    expect(md).toContain('Make this green')
    expect(md).toContain('[STYLE · HIGH]')
    expect(md).toContain('Total: 1 item(s)')
  })

  it('orders items within a page by priority (high first)', () => {
    const low = { ...base, id: 2, priority: 'low' as const, note: 'low one' }
    const high = { ...base, id: 3, priority: 'high' as const, note: 'high one' }
    const md = buildClaudePrompt([low, high])
    expect(md.indexOf('high one')).toBeLessThan(md.indexOf('low one'))
  })

  it('includes captured console logs and environment', () => {
    const withCtx: Annotation = {
      ...base,
      meta: { browser: 'Chrome', os: 'Windows', device: 'Desktop', viewport: '1440×900' },
      console_logs: [{ level: 'error', text: 'TypeError: x is undefined' }],
    }
    const md = buildClaudePrompt([withCtx])
    expect(md).toContain('**Env:** Chrome · Windows · Desktop · viewport 1440×900')
    expect(md).toContain('Console at mark time')
    expect(md).toContain('TypeError: x is undefined')
  })

  it('groups multiple pages separately', () => {
    const other = { ...base, id: 4, page_route: '/settings', page_title: 'Settings', note: 'other page' }
    const md = buildClaudePrompt([base, other])
    expect(md).toContain('## Page: `/dashboard`')
    expect(md).toContain('## Page: `/settings`')
    expect(md).toContain('Total: 2 item(s)')
  })
})
