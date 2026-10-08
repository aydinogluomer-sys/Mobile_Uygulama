/**
 * R07.07 — what a chart SAYS, as text: for screen readers (the chart's
 * accessibilityLabel) and for anyone who cannot read bars. Plain
 * description of the numbers -- highest, lowest, total, average, how many
 * days -- never a cause ("birlikte görülüyor" lives in the mood card; no
 * chart claims one thing made another happen).
 *
 * Plus the one privacy step before sharing a report: the user chooses
 * whether task titles go out; by default they do not.
 */
/** R10.05 — a decimal as Turkish writes it: "2,3", never "2.3". The one UI decimal formatter. */
export function decimalTR(n: number, digits = 1): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(digits)).replace('.', ',');
}
const nf = decimalTR;

export type Point = { label: string; value: number };

/** "Son 14 gün: en yüksek 3 Eki (8), en düşük 1 Eki (0), toplam 32, ortalama 2,3." */
export function seriesText(title: string, points: readonly Point[], unit = ''): string {
  if (points.length === 0) return `${title}: veri yok.`;
  const u = unit ? ` ${unit}` : '';
  let hi = points[0], lo = points[0], total = 0;
  for (const p of points) {
    if (p.value > hi.value) hi = p;
    if (p.value < lo.value) lo = p;
    total += p.value;
  }
  if (total === 0) return `${title}: ${points.length} noktanın hepsi sıfır.`;
  return `${title}: en yüksek ${hi.label} (${nf(hi.value)}${u}), en düşük ${lo.label} (${nf(lo.value)}${u}), toplam ${nf(total)}${u}, ortalama ${nf(total / points.length)}${u}.`;
}

/** A completion heatmap: how many days had any, the best day share, the longest run. */
export function heatmapText(title: string, values: readonly number[], longestRun: number): string {
  const active = values.filter((v) => v > 0).length;
  if (active === 0) return `${title}: ${values.length} günde kayıt yok.`;
  const best = Math.max(...values);
  return `${title}: ${values.length} günün ${active}'inde tamamlama var, en yüksek gün %${Math.round(best * 100)}, en uzun seri ${longestRun} gün.`;
}

/** The life-area radar: each area's score out of 10, strongest and weakest named. */
export function radarText(areas: readonly { label: string; value: number }[]): string {
  if (areas.length === 0) return 'Yaşam alanları: veri yok.';
  const sorted = [...areas].sort((a, b) => b.value - a.value);
  const list = areas.map((a) => `${a.label} ${nf(a.value)}`).join(', ');
  return `Yaşam alanları (10 üzerinden): ${list}. En güçlü ${sorted[0].label}, en zayıf ${sorted[sorted.length - 1].label}.`;
}

/**
 * R07.07 — before a focus report leaves the device: task titles are private
 * unless the user chose to include them. Times and durations stay.
 */
export function redactSessionsForShare<T extends { task_title: string | null }>(rows: readonly T[], includeTitles: boolean): T[] {
  return includeTitles ? [...rows] : rows.map((r) => ({ ...r, task_title: r.task_title ? 'Görev' : null }));
}

/** Words that state a cause; a chart description must not contain them. */
export const CAUSAL_WORDS = /\b(yüzünden|sayesinde|neden ol|sebep ol|etkiledi|kaynaklan|yol açt)/i;
