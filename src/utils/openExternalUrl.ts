/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Abre una URL externa o enlace `mailto:` de forma segura mediante un elemento `<a>`
 * temporal en lugar de `window.open`, evitando bloqueos de popups y restricciones de iframe.
 */
export function openExternalUrl(url: string, newTab = true): void {
  if (typeof document === 'undefined' || !url) return;
  const link = document.createElement('a');
  link.href = url;
  const isMailto = url.trim().toLowerCase().startsWith('mailto:');
  if (newTab && !isMailto) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
