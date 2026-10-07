/**
 * R07.01 — a richer journal without a new schema: tags, links to habits and
 * light formatting all live IN the entry's text, so every existing entry,
 * export and AI summary keeps working and nothing waits for a migration.
 *
 *   tags        `#kelime` anywhere in the text (Turkish letters, digits, `-`,
 *               `_`). Case-folded the Turkish way: `#İş` and `#iş` are one.
 *   habit link  a tag that is a habit's name as a tag (`#su-iç` for "Su iç")
 *               links that entry to the habit. Derived, never stored twice.
 *   formatting  a line starting `# ` is a heading, `- ` a list item; inside
 *               a line `**kalın**` and `_italik_`. Nothing else is special.
 *
 * Pure.
 */

const TAG_RE = /(^|[\s(])#([0-9a-zçğıöşüâîû][0-9a-zçğıöşüâîû_-]*)/giu;

/** Turkish-aware lowercase, trimmed of edge separators. */
export function normalizeTag(raw: string): string {
  return raw.toLocaleLowerCase('tr').replace(/^[-_]+|[-_]+$/g, '');
}

/** The tags in a text, unique, in order of first appearance. */
export function extractTags(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(TAG_RE)) {
    const t = normalizeTag(m[2]);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** A habit's name as a tag: "Su iç" -> "su-iç". */
export function tagForName(name: string): string {
  return normalizeTag(name.trim().toLocaleLowerCase('tr').replace(/[^0-9a-zçğıöşüâîû]+/giu, '-'));
}

/** The habits an entry's tags point at. */
export function linkedHabits<H extends { id: string; name: string }>(text: string, habits: readonly H[]): H[] {
  const tags = new Set(extractTags(text));
  return habits.filter((h) => tags.has(tagForName(h.name)));
}

/** Entries carrying a tag (case-folded). */
export function withTag<E extends { content: string | null }>(entries: readonly E[], tag: string): E[] {
  const t = normalizeTag(tag);
  return entries.filter((e) => extractTags(e.content ?? '').includes(t));
}

/** Every tag across entries, most used first. */
export function tagCounts(entries: readonly { content: string | null }[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) for (const t of extractTags(e.content ?? '')) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'tr'));
}

// ---------------------------------------------------------------------------
// Light formatting
// ---------------------------------------------------------------------------

export type Inline = { text: string; bold?: boolean; italic?: boolean };
export type Block =
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'item'; inline: Inline[] }
  | { kind: 'para'; inline: Inline[] }
  | { kind: 'blank' };

/** `**kalın**` and `_italik_`; unmatched markers stay as text. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|_([^_]+)_/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: line.slice(last, at) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], italic: true });
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out.length > 0 ? out : [{ text: '' }];
}

export function parseBlocks(text: string): Block[] {
  return String(text ?? '').split(/\r?\n/).map((line): Block => {
    if (line.trim() === '') return { kind: 'blank' };
    if (/^#\s+/.test(line)) return { kind: 'heading', inline: parseInline(line.replace(/^#\s+/, '')) };
    if (/^\s*[-•]\s+/.test(line)) return { kind: 'item', inline: parseInline(line.replace(/^\s*[-•]\s+/, '')) };
    return { kind: 'para', inline: parseInline(line) };
  });
}

/** Wrap the selection (or insert empty markers at the cursor). */
export function wrapSelection(text: string, start: number, end: number, marker: '**' | '_'): { text: string; cursor: number } {
  const a = Math.max(0, Math.min(start, end)), b = Math.max(start, end);
  const next = text.slice(0, a) + marker + text.slice(a, b) + marker + text.slice(b);
  return { text: next, cursor: b + marker.length * (b > a ? 2 : 1) };
}

/** Prefix the line under the cursor with `- ` (or remove it). */
export function toggleListLine(text: string, cursor: number): { text: string; cursor: number } {
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  if (text.startsWith('- ', lineStart)) return { text: text.slice(0, lineStart) + text.slice(lineStart + 2), cursor: Math.max(lineStart, cursor - 2) };
  return { text: text.slice(0, lineStart) + '- ' + text.slice(lineStart), cursor: cursor + 2 };
}

// ---------------------------------------------------------------------------
// R07.01 — offline draft
// ---------------------------------------------------------------------------

export type JournalDraft = { date: string; content: string; mood: number | null; savedAt: number };

export const draftKey = (userId: string, date: string) => `journal.draft.v1.${userId}.${date}`;

/**
 * Should a stored draft replace what the server has for the day? Only when it
 * differs: a draft is what the user typed and has not been confirmed saved;
 * once the entry equals it, it is spent.
 */
export function draftDiffers(draft: JournalDraft | null, entry: { content: string | null; mood: number | null } | undefined): boolean {
  if (!draft) return false;
  return draft.content !== (entry?.content ?? '') || draft.mood !== (entry?.mood ?? null);
}
