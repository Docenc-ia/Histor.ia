const DANGEROUS_FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;
const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_TAG_REGEX = /<\s*\/?\s*script\b[^>]*>/gi;
const DEFAULT_MAX_INPUT_LENGTH = 2000;

/**
 * Codifica caracteres especiales HTML (`&`, `<`, `>`, `"`, `'`) en entidades seguras.
 * Previene inyecciones XSS y roturas de maquetación al interpolar nombres, observaciones
 * o calificaciones dentro de plantillas HTML o documentos exportados a Google Docs.
 *
 * @param value Valor crudo a escapar.
 * @returns Cadena con entidades HTML escapadas.
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

/**
 * Valida y codifica una URL para su inserción segura en atributos `href` de reportes HTML.
 * Bloquea esquemas ejecutables como `javascript:`, `data:` o `vbscript:`.
 *
 * @param url URL candidata a validar.
 * @returns URL escapada si utiliza protocolo `http:`, `https:` o `mailto:`; cadena vacía en caso contrario.
 */
export function sanitizeSafeUrl(url: unknown): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '';
}

/**
 * Neutraliza vectores de inyección de fórmulas (CSV / Spreadsheet Formula Injection)
 * en celdas de texto exportadas a archivos CSV o Google Sheets.
 *
 * @param value Valor de celda a sanitizar.
 * @returns Texto seguro con apóstrofo prefijado si comienza con operadores de fórmula (`=`, `+`, `-`, `@`).
 */
export function sanitizeSpreadsheetFormulaCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(CONTROL_CHARS_REGEX, '').trim();
  if (!text) return '';

  // Los valores estrictamente numéricos (ej. puntajes o promedios negativos/positivos) no son fórmulas ejecutables
  const normalizedNumeric = text.replace(',', '.');
  if (/^[+-]?\d+(\.\d+)?$/.test(normalizedNumeric)) {
    return text;
  }

  return DANGEROUS_FORMULA_PREFIX_REGEX.test(text) ? `'${text}` : text;
}

/**
 * Limpia entradas de texto provenientes de usuarios o archivos importados,
 * eliminando bytes nulos, caracteres de control no imprimibles y etiquetas `<script>`.
 *
 * @param value Entrada cruda a sanitizar.
 * @param maxLength Longitud máxima permitida (por defecto 2000 caracteres).
 * @returns Texto limpio y acotado en longitud.
 */
export function sanitizePlainTextInput(
  value: unknown,
  maxLength: number = DEFAULT_MAX_INPUT_LENGTH
): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(SCRIPT_TAG_REGEX, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Verifica que una URL remota sea segura para consultarse externamente (prevención de SSRF),
 * exigiendo esquema `https:` y rechazando direcciones IP privadas, loopback o metadatos de nube.
 *
 * @param rawUrl URL candidata ingresada por el usuario.
 * @returns `true` si la URL apunta a un host público HTTPS válido.
 */
export function isSafeExternalDocumentUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !hostname ||
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === '::1' ||
      hostname.startsWith('fe80:') ||
      hostname.startsWith('fc00:') ||
      hostname.startsWith('fd00:')
    ) {
      return false;
    }

    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

