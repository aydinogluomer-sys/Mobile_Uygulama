/**
 * F37 — Non-clinical, structured three-prompt reflection formatter for the journal.
 * Pure text formatting only: imports no React, store, repository, database, or analytics.
 */

export const REFLECTION_FIELDS = [
  { key: 'happened', label: 'Ne oldu', placeholder: 'Kısaca, yargılamadan.' },
  { key: 'thought', label: 'Aklımdan geçen', placeholder: 'O anda aklımdan şunlar geçti.' },
  { key: 'alternative', label: 'Başka nasıl bakabilirim', placeholder: 'Başka bir bakış açısı olabilir mi?' },
] as const;

export type ReflectionKey = (typeof REFLECTION_FIELDS)[number]['key'];
export type ReflectionDraft = Record<ReflectionKey, string>;

export const REFLECTION_FIELD_MAX = 500;
export const REFLECTION_DISCLAIMER = 'Bu bir yansıtma aracıdır, terapi değildir.';

export function emptyReflection(): ReflectionDraft {
  return {
    happened: '',
    thought: '',
    alternative: '',
  };
}

export function hasReflectionText(d: ReflectionDraft): boolean {
  return REFLECTION_FIELDS.some((f) => d[f.key].trim().length > 0);
}

/**
 * Each field: collapse whitespace/newlines to a single space, trim, clamp to 500 chars.
 * Empty fields are omitted; if all are empty, returns ''.
 */
export function formatReflection(d: ReflectionDraft): string {
  const lines: string[] = [];
  for (const field of REFLECTION_FIELDS) {
    const cleaned = d[field.key].replace(/\s+/g, ' ').trim().slice(0, REFLECTION_FIELD_MAX);
    if (cleaned.length > 0) {
      lines.push(`${field.label}: ${cleaned}`);
    }
  }
  return lines.join('\n');
}

/** If content is empty/blank, returns block; otherwise trims trailing whitespace and appends with '\n\n'. */
export function appendBlock(content: string, block: string): string {
  if (!block) return content;
  const trimmedEnd = content.replace(/\s+$/, '');
  if (!trimmedEnd) return block;
  return `${trimmedEnd}\n\n${block}`;
}
