/**
 * Safe HTML & attribute encoding helpers (ISO/IEC 27001 A.8.28 - Secure Coding)
 * Prevents HTML/Script injection (XSS) and broken document layout when rendering
 * user-entered names, observations, class contents, or links into HTML reports/docs.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeSafeUrl(url: unknown): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '';
}
