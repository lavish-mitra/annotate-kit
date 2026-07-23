import { describe, it, expect } from 'vitest'
import { sanitizeSnapshot } from '../src/snapshot'

describe('sanitizeSnapshot', () => {
  it('strips scripts, styles and inline event handlers', () => {
    const html = `<div onclick="steal()"><script>evil()</script><style>x{}</style><b>Hi</b></div>`
    const out = sanitizeSnapshot(html)
    expect(out).not.toContain('<script')
    expect(out).not.toContain('evil()')
    expect(out).not.toContain('<style')
    expect(out).not.toContain('onclick')
    expect(out).toContain('<b>Hi</b>')
  })

  it('redacts password input values regardless of attribute order', () => {
    expect(sanitizeSnapshot(`<input type="password" value="hunter2">`)).not.toContain('hunter2')
    expect(sanitizeSnapshot(`<input value="hunter2" type="password">`)).not.toContain('hunter2')
    expect(sanitizeSnapshot(`<input type="password" value="hunter2">`)).toContain('[redacted]')
  })

  it('does not clobber unrelated value-ish attributes', () => {
    expect(sanitizeSnapshot(`<div data-value="keep" aria-valuenow="5">x</div>`)).toContain('keep')
    expect(sanitizeSnapshot(`<input type="text" value="visible">`)).toContain('visible')
  })

  it('redacts a password value even when it contains ">"', () => {
    expect(sanitizeSnapshot(`<input type="password" value="a>b>c">`)).not.toContain('a>b>c')
    expect(sanitizeSnapshot(`<input value="p>q" type="password">`)).not.toContain('p>q')
  })

  it('truncates to the budget', () => {
    const out = sanitizeSnapshot('<p>' + 'a'.repeat(50_000) + '</p>', 100)
    expect(out.length).toBeLessThan(200)
    expect(out).toContain('truncated')
  })
})
