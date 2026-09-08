/**
 * Are two unit strings the same unit?
 *
 * ## Why this is deliberately small
 *
 * AI Coach can be told "bugün 10 dk kitap okudum" about a habit whose stored
 * unit is `dakika`. Refusing that as a mismatch would ask a pointless question;
 * accepting "10 sayfa" against the same habit would write ten minutes of
 * reading as ten pages, which is a silent data error the user may never notice.
 *
 * So the normaliser is an EXPLICIT, bounded alias table, not a fuzzy matcher.
 * Anything not in it is a different unit and becomes a question. The cost of
 * being wrong is asymmetric: one extra tap versus a wrong number in the user's
 * history, and this table is sized for that.
 *
 * ## What is not here
 *
 * No conversion. `dk` and `dakika` are the same unit written two ways; minutes
 * and hours are not, and converting 1.5 saat into 90 dakika on the model's word
 * is exactly the reinterpretation this module exists to refuse. A habit tracked
 * in hours and a value stated in minutes is a mismatch, and the user answers it.
 */

/**
 * Aliases that are the SAME unit, grouped by their canonical form.
 *
 * Turkish and the short forms people actually type. Every group is a set of
 * spellings, never a set of related-but-different measures.
 */
const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['dakika', 'dk', 'dak', 'minute', 'minutes', 'min'],
  ['saat', 'sa', 'hour', 'hours', 'hr'],
  ['sayfa', 'sayfalar', 'page', 'pages', 'sf'],
  ['bardak', 'bardaklar', 'glass', 'glasses'],
  ['litre', 'lt', 'l', 'liter', 'litre'],
  ['adet', 'tane', 'kez', 'defa', 'tekrar', 'rep', 'reps'],
  ['km', 'kilometre', 'kilometer', 'kilometers'],
  ['metre', 'm', 'meter', 'meters'],
  ['kelime', 'word', 'words'],
  ['kalori', 'kcal', 'cal', 'calorie', 'calories'],
  ['adım', 'adim', 'step', 'steps'],
];

/** Case/diacritic folding that matches how the rest of the app compares text. */
function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[.\s]+/g, '')
    .trim();
}

const CANONICAL = new Map<string, string>();
for (const group of ALIAS_GROUPS) {
  const canonical = group[0];
  for (const alias of group) CANONICAL.set(fold(alias), canonical);
}

/**
 * The canonical spelling of a unit, or the folded input when it is not a known
 * alias. Unknown units are still comparable to themselves — this never throws
 * and never invents a group.
 */
export function canonicalUnit(unit: string): string {
  const f = fold(unit);
  return CANONICAL.get(f) ?? f;
}

/**
 * True when `a` and `b` name the same unit.
 *
 * A missing unit on either side is NOT a mismatch: a habit with no recorded
 * unit has nothing to disagree with, and a value stated without one takes the
 * habit's. Only two present-and-different units are a question.
 */
export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return canonicalUnit(a) === canonicalUnit(b);
}
