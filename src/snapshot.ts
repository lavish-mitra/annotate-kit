// Pure: turn a captured element's outerHTML into a safe, compact DOM snapshot for bug reports.
// Strips <script>/<style>, inline event handlers, and password field values; truncates to a budget.
// The result is only ever shown to a developer as TEXT (never re-rendered as HTML), so this is about
// privacy + size, not XSS. Expects browser-normalised outerHTML (attributes space-separated, tags closed).
export function sanitizeSnapshot(html: string, maxLen = 10_000): string {
  let out = String(html ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(?:script|style)\b[^>]*>/gi, '')       // strip any stray / unclosed script|style tags
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')            // on*="…" handlers
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')            // on*='…' handlers
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')            // on*=… (unquoted)
    // blank the value of any password input — order-independent, tolerant of '>' inside quoted values,
    // and won't touch data-value/aria-value*
    .replace(/<input\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, (tag) =>
      /\btype\s*=\s*["']?password\b/i.test(tag)
        ? tag.replace(/(\svalue\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1"[redacted]"')
        : tag)
  if (out.length > maxLen) out = out.slice(0, maxLen) + '\n<!-- …truncated -->'
  return out
}
