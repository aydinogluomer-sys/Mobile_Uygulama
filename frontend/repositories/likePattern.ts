export const SEARCH_TERM_MAX_LENGTH = 100;

function replaceControlCharsWithSpace(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    out += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : raw[i];
  }
  return out;
}

/** Denetim karakterleri boşluk olur, ardışık boşluklar tek boşluk, baş/son kırpılır, en çok 100 kod noktası. Boşsa null. */
export function normalizeSearchTerm(raw: string): string | null {
  const collapsed = replaceControlCharsWithSpace(raw).replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  const capped = Array.from(collapsed).slice(0, SEARCH_TERM_MAX_LENGTH).join('').trim();
  return capped || null;
}

/**
 * '%<metin>%' kalıbı. Sıra: normalizeSearchTerm -> '*' silinir -> ',' '(' ')' '"' boşluk olur -> yeniden kırp (boşsa null)
 * -> '\' -> '\\', '%' -> '\%', '_' -> '\_' -> başa ve sona '%'.
 * .ilike('kolon', kalıp) için.
 */
export function likeContains(raw: string): string | null {
  const normalized = normalizeSearchTerm(raw);
  if (normalized === null) return null;
  const safe = normalized
    .replace(/\*/g, '')
    .replace(/[,()"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!safe) return null;
  const escaped = safe.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

const SAFE_COLUMN_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** .or() için 'a.ilike.<kalıp>,b.ilike.<kalıp>' (kalıp null ise null). Kolon adı /^[a-z_][a-z0-9_]*$/ değilse Error fırlatır (programlama hatası). */
export function orIlike(columns: readonly string[], raw: string): string | null {
  if (columns.length === 0) {
    throw new Error('orIlike en az bir kolon adı gerektirir.');
  }
  for (const col of columns) {
    if (!SAFE_COLUMN_NAME_RE.test(col)) {
      throw new Error(`Geçersiz kolon adı: ${col}`);
    }
  }
  const pattern = likeContains(raw);
  if (pattern === null) return null;
  return columns.map((col) => `${col}.ilike.${pattern}`).join(',');
}
