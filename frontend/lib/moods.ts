/**
 * R07.02 — moods the user can name, several check-ins a day, and an identity
 * that survives a rename.
 *
 * The journal's mood was a bare number 1..5 whose MEANING was its position in
 * a fixed list: renaming "Yorgun" or reordering the list would silently
 * change what every past entry says. Here:
 *
 *   definition  a mood with a stable `id`, a name, an icon and a valence
 *               (1 = hard .. 5 = great -- what analysis reads). Renaming or
 *               re-iconing keeps the id; it never changes a past check-in.
 *   check-in    one moment: which mood (id) plus a SNAPSHOT of its name and
 *               valence at that moment, an intensity (1..3) and an optional
 *               note. Many per day.
 *   built-ins   `builtin-1` .. `builtin-5` are the old 1..5 scale, pinned for
 *               good: a legacy journal mood `n` IS `builtin-n`.
 *
 * Pure.
 */
import { MOODS } from './journalMoods';

export type MoodEnergy = 'low' | 'high';

export type MoodDefinition = {
  id: string;
  name: string;
  icon: string;
  /** 1..5: what the comparison cards average. */
  valence: number;
  energy?: MoodEnergy;
  builtIn: boolean;
  archived: boolean;
};

export type MoodCheckin = {
  id: string;
  /** ISO time of the check-in; `day` is its local date. */
  at: string;
  day: string;
  moodId: string;
  /** Snapshots: what the mood was called and how it was valued AT the check-in. */
  label: string;
  valence: number;
  energy?: MoodEnergy;
  intensity: 1 | 2 | 3;
  note?: string;
};

export const BUILT_IN_MOODS: readonly MoodDefinition[] = MOODS.map((m) => ({
  id: `builtin-${m.value}`, name: m.label, icon: m.emoji, valence: m.value, builtIn: true, archived: false,
}));

/** A legacy journal mood number as a built-in mood id. */
export function legacyMoodId(value: number | null | undefined): string | null {
  return typeof value === 'number' && value >= 1 && value <= 5 ? `builtin-${value}` : null;
}

export function allMoods(custom: readonly MoodDefinition[]): MoodDefinition[] {
  return [...BUILT_IN_MOODS, ...custom.filter((c) => !c.archived)];
}

export type DefinitionCheck = { ok: true; def: MoodDefinition } | { ok: false; reason: string };

export function normaliseEnergy(raw: unknown): MoodEnergy | undefined {
  return raw === 'low' || raw === 'high' ? raw : undefined;
}

export function validateDefinition(
  input: { id: string; name: string; icon: string; valence: number; energy?: unknown },
  existing: readonly MoodDefinition[],
): DefinitionCheck {
  const name = input.name.trim();
  if (!name || name.length > 24) return { ok: false, reason: 'Duygu adı 1–24 karakter olmalı.' };
  const icon = input.icon.trim();
  if (!icon || [...icon].length > 2) return { ok: false, reason: 'Bir emoji seç.' };
  if (!Number.isInteger(input.valence) || input.valence < 1 || input.valence > 5) return { ok: false, reason: 'Değer 1 ile 5 arasında olmalı.' };
  const clash = allMoods(existing).some((m) => m.id !== input.id && m.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
  if (clash) return { ok: false, reason: 'Bu adda bir duygu zaten var.' };
  const energy = normaliseEnergy(input.energy);
  return {
    ok: true,
    def: {
      id: input.id,
      name,
      icon,
      valence: input.valence,
      ...(energy ? { energy } : {}),
      builtIn: false,
      archived: false,
    },
  };
}

/** Rename / re-icon / re-value a custom mood. Same id; past check-ins keep their snapshots. */
export function editDefinition(list: readonly MoodDefinition[], def: MoodDefinition): MoodDefinition[] {
  return list.map((d) => (d.id === def.id && !d.builtIn ? { ...def, builtIn: false } : d));
}

export function makeCheckin(
  def: MoodDefinition,
  params: { id: string; at: Date; day: string; intensity: 1 | 2 | 3; note?: string; energy?: MoodEnergy | null },
): MoodCheckin {
  const note = params.note?.trim();
  const energy =
    params.energy === null
      ? undefined
      : (normaliseEnergy(params.energy) ?? normaliseEnergy(def.energy));
  return {
    id: params.id,
    at: params.at.toISOString(),
    day: params.day,
    moodId: def.id,
    label: def.name,
    valence: def.valence,
    ...(energy ? { energy } : {}),
    intensity: params.intensity,
    ...(note ? { note: note.slice(0, 280) } : {}),
  };
}

/** How a check-in reads now: its snapshot, plus the current name if the mood was renamed since. */
export function checkinLabel(c: MoodCheckin, defs: readonly MoodDefinition[]): string {
  const cur = [...BUILT_IN_MOODS, ...defs].find((d) => d.id === c.moodId);
  return cur && cur.name !== c.label ? `${c.label} (şimdi: ${cur.name})` : c.label;
}

/**
 * One mood value per day for analysis: the mean valence of the day's
 * check-ins (as recorded), else the legacy journal mood.
 */
export function dailyMoods(checkins: readonly MoodCheckin[], journal: readonly { date: string; mood: number | null }[]): { date: string; mood: number | null }[] {
  const byDay = new Map<string, number[]>();
  for (const c of checkins) {
    const arr = byDay.get(c.day) ?? [];
    arr.push(c.valence);
    byDay.set(c.day, arr);
  }
  const out = new Map<string, number | null>();
  for (const j of journal) out.set(j.date, j.mood);
  for (const [day, vs] of byDay) out.set(day, vs.reduce((a, b) => a + b, 0) / vs.length);
  return [...out.entries()].map(([date, mood]) => ({ date, mood }));
}

export const MAX_CHECKINS = 2000;

export const MOOD_ENERGY_LABEL: Readonly<Record<MoodEnergy, string>> = {
  low: 'düşük enerji',
  high: 'yüksek enerji',
};

export function withEnergy(c: MoodCheckin, energy: MoodEnergy | null): MoodCheckin {
  const clean = energy === null ? undefined : normaliseEnergy(energy);
  const { energy: _prev, ...rest } = c;
  return clean ? { ...rest, energy: clean } : rest;
}

/** Energy of the latest (largest ISO `at`) check-in on `day` that carries an energy value. */
export function latestEnergyOn(checkins: readonly MoodCheckin[], day: string): MoodEnergy | undefined {
  let bestAt: string | null = null;
  let bestEnergy: MoodEnergy | undefined;
  for (const c of checkins) {
    if (c.day !== day) continue;
    const e = normaliseEnergy(c.energy);
    if (!e) continue;
    if (bestAt === null || c.at > bestAt) {
      bestAt = c.at;
      bestEnergy = e;
    }
  }
  return bestEnergy;
}

export function lowEnergySuggested(checkins: readonly MoodCheckin[], day: string): boolean {
  return latestEnergyOn(checkins, day) === 'low';
}

export const ENERGY_COPY = {
  ask: 'Enerjin nasıl?',
  low: 'Düşük',
  high: 'Yüksek',
  skip: 'Geç',
  suggest: "Enerjin düşük görünüyor. İstersen Düşük Enerji Modu'nu açabilirsin.",
} as const;
