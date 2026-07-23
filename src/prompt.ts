// Pure: turn a batch of annotations into a clean, structured markdown prompt for the developer (Claude).
// Grouped by page, ordered by priority, each item names the exact element + the requested change.
import type { Annotation } from './types'
import { annShapeLabel, annTypeLabel, PRIORITY_RANK } from './constants'

export function buildClaudePrompt(items: Annotation[], opts?: { title?: string }): string {
  const title = opts?.title || 'Live-site annotations — feedback to implement'
  if (!items.length) return `# ${title}\n\n_(no annotations selected)_\n`
  const byPage = new Map<string, Annotation[]>()
  for (const a of items) {
    const k = a.page_route || '(unknown page)'
    if (!byPage.has(k)) byPage.set(k, [])
    byPage.get(k)!.push(a)
  }
  const lines: string[] = [
    `# ${title}`,
    '',
    'These are pinpointed change requests captured directly on the live site. Each item names the page, the exact element, and what to do. Implement them precisely.',
    '',
  ]
  let n = 0
  for (const [page, arr] of byPage) {
    arr.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1))
    lines.push(`## Page: \`${page}\``, '')
    for (const a of arr) {
      n++
      const shape = a.kind === 'shape' ? ` · ${annShapeLabel(a.shape_type)} mark` : ''
      lines.push(`### ${n}. [${annTypeLabel(a.type).toUpperCase()} · ${(a.priority || 'med').toUpperCase()}] ${a.page_title || page}${shape}`)
      if (a.target_text?.trim()) lines.push(`- **Element:** \`${a.target_selector || '—'}\` — “${a.target_text.trim().slice(0, 100)}”`)
      else if (a.target_selector) lines.push(`- **Element:** \`${a.target_selector}\``)
      if (a.el_context?.length) lines.push(`- **Where:** ${a.el_context.join(' › ')}`)
      if (a.created_by_name || a.created_by) lines.push(`- **By:** ${[a.created_by_name || a.created_by, a.created_by_role].filter(Boolean).join(' · ')}`)
      if (a.meta) {
        const m = a.meta
        const env = [m.browser, m.os, m.device, m.viewport && `viewport ${m.viewport}`].filter(Boolean).join(' · ')
        if (env) lines.push(`- **Env:** ${env}`)
      }
      lines.push(`- **Request:** ${(a.note || '').trim() || '(marked — no note)'}`)
      for (const r of a.replies ?? []) lines.push(`  - ↳ ${r.note.trim()}`)
      if (a.console_logs?.length) {
        lines.push('- **Console at mark time:**')
        for (const l of a.console_logs.slice(-6)) lines.push(`  - \`[${l.level}]\` ${String(l.text).replace(/\n/g, ' ').slice(0, 200)}`)
      }
      if (a.screenshot_url) lines.push('- _(screenshot attached)_')
      lines.push('')
    }
  }
  lines.push('---', `Total: ${n} item(s). I'll mark each Done in the Annotate panel as you implement it.`)
  return lines.join('\n')
}
