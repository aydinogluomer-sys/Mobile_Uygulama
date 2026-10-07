// Karar çerçeveleri çekirdeği — Etki-Şiddet + Eisenhower + Triaj + Kanban
// HabitOnboarding ve habits.tsx tarafından paylaşılan tek kaynak.

import { colors } from '../lib/tokens';
import type { Habit, EndCondition } from './supabase';
import { isMeasurableTracking } from './habitEngine';
// One-way: capacity -> habitSchedule -> date/supabase(types); none imports triage.
import { occurrencesPerWeek } from './capacity';

export type ImpactLevel = 'critical' | 'high' | 'medium' | 'low';
export type Urgency = 'urgent' | 'not_urgent';
export type Triage = 'do_now' | 'plan' | 'wait_watch' | 'eliminate';

// Çağrışım/cue insanca etiket
export function cueLabel(habit: Pick<Habit, 'cue_habit_id' | 'cue_note'>, allHabits: Habit[]): string | null {
  if (habit.cue_habit_id) {
    const anchor = allHabits.find((h) => h.id === habit.cue_habit_id);
    return anchor ? `${anchor.name} sonrası` : null;
  }
  if (habit.cue_note && habit.cue_note.trim()) return habit.cue_note.trim();
  return null;
}

// Bitiş koşulu insanca etiket
export function endConditionLabel(ec: EndCondition | null): string {
  if (!ec) return 'Süresiz';
  if (ec.kind === 'date') {
    const d = String(ec.value);
    const parts = d.split('-'); // yyyy-mm-dd
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}'e kadar`;
    return `${d}'e kadar`;
  }
  return `${ec.value} kez`;
}

// Etki seviyeleri (Etki-Şiddet sınıflaması)
export const IMPACT_LEVELS: {
  key: ImpactLevel;
  label: string;
  desc: string;
  color: string;
  suggestedCost: number;
}[] = [
  { key: 'critical', label: 'Kritik', desc: 'Hayati / temel', color: '#ef4444', suggestedCost: 5 },
  { key: 'high', label: 'Yüksek', desc: 'Önemli hedefler', color: '#f59e0b', suggestedCost: 4 },
  { key: 'medium', label: 'Orta', desc: 'Anlamlı gelişim', color: '#eab308', suggestedCost: 3 },
  { key: 'low', label: 'Düşük', desc: 'Küçük iyileştirme', color: colors.neutral500, suggestedCost: 2 },
];

export const URGENCY_OPTIONS: {
  key: Urgency;
  label: string;
  desc: string;
  icon: string;
}[] = [
  { key: 'urgent', label: 'Acil', desc: 'Hemen başlamalıyım', icon: 'flash' },
  { key: 'not_urgent', label: 'Acil Değil', desc: 'Zamanla kurabilirim', icon: 'time-outline' },
];

// Triaj kararı meta — ikon, renk, hedef Kanban kutusu
export const TRIAGE_META: Record<Triage, {
  label: string;
  emoji: string;
  icon: string;
  color: string;
  room: string;       // hedef Kanban kutusu adı
  roomDesc: string;
}> = {
  do_now: {
    label: 'Hemen Yap',
    emoji: '🔥',
    icon: 'flame',
    color: '#ef4444',
    room: 'Aktif Odak',
    roomDesc: 'Aktif Odak\'a alınmaya aday',
  },
  plan: {
    label: 'Planla',
    emoji: '📋',
    icon: 'calendar-outline',
    color: colors.accent,
    room: 'Bekleme Odası',
    roomDesc: 'Bekleme Odası\'na — zamanı gelince başla',
  },
  wait_watch: {
    label: 'Beklet-İzle',
    emoji: '👁',
    icon: 'eye-outline',
    color: '#f59e0b',
    room: 'Bekleme Odası',
    roomDesc: 'Bekleme Odası\'nda izlemede',
  },
  eliminate: {
    label: 'Ele / İptal Et',
    emoji: '🗑',
    icon: 'trash-outline',
    color: colors.neutral500,
    room: 'Fikirler',
    roomDesc: 'Fikir olarak saklanacak',
  },
};

export function impactMeta(level: ImpactLevel | null) {
  return IMPACT_LEVELS.find((i) => i.key === level) ?? IMPACT_LEVELS[2];
}

export function suggestedCost(level: ImpactLevel | null): number {
  return impactMeta(level).suggestedCost;
}

// ── İrade (XP) Maliyet Motoru ───────────────────────────────
// Zorluk seviyeleri (DB difficulty kolonu: 1/3/5)
export const DIFFICULTY_LEVELS: {
  key: number;
  label: string;
  desc: string;
  color: string;
  icon: string;
}[] = [
  { key: 1, label: 'Kolay', desc: 'Az çaba ister', color: '#10b981', icon: 'leaf-outline' },
  { key: 3, label: 'Orta', desc: 'Düzenli odak', color: '#f59e0b', icon: 'barbell-outline' },
  { key: 5, label: 'Zor', desc: 'Yüksek irade', color: '#ef4444', icon: 'flame-outline' },
];

export function difficultyMeta(d: number) {
  return DIFFICULTY_LEVELS.find((x) => x.key === d) ?? DIFFICULTY_LEVELS[1];
}

// Maliyet hesabında kullanılan minimal form şekli
export type CostInput = {
  difficulty: number;
  impact_level: ImpactLevel | null;
  behavior_type: 'positive' | 'negative';
  tracking_type: Habit['tracking_type'];
  /** `interval_days` (with kind 'daily'): "every N days" -- R01.02-d2. */
  frequency_config: { kind: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval_days?: number; month_days?: number[] };
  estimated_minutes?: number;
};

// Elle ayarlanmış YARGI tablosu, oransal değil: 7 kat sıklık farkı yalnız 1.43
// kat bedel farkı. Bu üç değer aşağıdaki interpolasyonun çapalarıdır; değişmez.
const FREQ_FACTOR: Record<string, number> = { daily: 1.0, weekly: 0.7, monthly: 0.5 };

/**
 * Frequency factor for an "every N days" habit (R01.02-d2, KD-07).
 *
 * Read off FREQ_FACTOR's own three anchors by occurrences per week,
 * piecewise-linearly -- monthly (~0.23/wk) 0.5, weekly (1/wk) 0.7, daily
 * (7/wk) 1.0 -- and clamped at both ends, so no new constant enters the
 * table and an interval habit is never cheaper than a less frequent kind.
 * NOT 1/N: that would price "every 3 days" (0.33) below weekly (0.7) though
 * it happens more often. Anchor frequencies come from `occurrencesPerWeek`,
 * the same mapping capacity uses, so cost and load agree on "how often".
 */
function intervalFreqFactor(perWeek: number): number {
  const anchors: [number, number][] = [
    [occurrencesPerWeek({ kind: 'monthly' }), FREQ_FACTOR.monthly],
    [occurrencesPerWeek({ kind: 'weekly' }), FREQ_FACTOR.weekly],
    [occurrencesPerWeek({ kind: 'daily' }), FREQ_FACTOR.daily],
  ];
  if (perWeek <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    if (perWeek <= x1) {
      const [x0, y0] = anchors[i - 1];
      return y0 + ((perWeek - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}
const IMPACT_BONUS: Record<ImpactLevel, number> = { critical: 1.5, high: 1.0, medium: 0.5, low: 0 };

// Şeffaf maliyet dökümü — her faktörün katkısı
export function costBreakdown(input: CostInput) {
  const diff = input.difficulty || 3;
  const fc = input.frequency_config;
  const freqKind = fc?.kind ?? 'daily';
  // "Her N günde bir" yalnız daily + interval_days > 1 ise; aksi hâlde tablo aynen.
  const intervalDays = freqKind === 'daily' && typeof fc?.interval_days === 'number' && fc.interval_days > 1
    ? fc.interval_days : null;
  // R01.02 — fixed month days and yearly dates are read off the same anchors
  // by how often they happen, like an interval (a yearly date clamps to monthly).
  const byOccurrence = intervalDays !== null || freqKind === 'yearly' || (freqKind === 'monthly' && !!fc?.month_days?.length);
  const perWeek = byOccurrence ? occurrencesPerWeek(fc) : null;
  const freqFactor = perWeek !== null ? intervalFreqFactor(perWeek) : (FREQ_FACTOR[freqKind] ?? 1.0);
  const base = diff * freqFactor;
  const behaviorBonus = input.behavior_type === 'negative' ? 1.5 : 0;
  const impactBonus = input.impact_level ? IMPACT_BONUS[input.impact_level] : 0;
  // Ölçülebilir olmak (sayısal ya da süreli) ek bir irade maliyeti getirir:
  // sadece işaretlemek yerine bir değer okuyup girmek gerekir.
  const trackingBonus = isMeasurableTracking(input.tracking_type) ? 0.5 : 0;
  const mins = input.estimated_minutes ?? 0;
  const timeBonus = Math.min(2, Math.floor(mins / 30) * 0.5);
  const raw = base + behaviorBonus + impactBonus + trackingBonus + timeBonus;
  const cost = Math.min(10, Math.max(1, Math.round(raw)));
  return {
    diff, freqKind, freqFactor, base,
    behaviorBonus, impactBonus, trackingBonus, timeBonus, mins,
    raw, cost,
    // Şeffaflık: çarpan bir interval'den türediyse kaynağı da dökümde. Yalnız
    // interval satırlarında eklenir; diğer girdilerin dökümü birebir aynı kalır.
    ...(intervalDays !== null ? { freqSource: 'interval' as const, intervalDays, perWeek } : {}),
  };
}

export function computeWillpowerCost(input: CostInput): number {
  return costBreakdown(input).cost;
}

// Eisenhower → Triaj
export function computeTriage(impact: ImpactLevel | null, urgency: Urgency | null): Triage {
  const important = impact === 'critical' || impact === 'high';
  const urgent = urgency === 'urgent';
  if (important && urgent) return 'do_now';
  if (important && !urgent) return 'plan';
  if (!important && urgent) return 'wait_watch';
  return 'eliminate';
}

export type HabitStatus = Habit['status'];

// Triaj + irade kapasitesi → nihai Kanban durumu
export function triageToStatus(triage: Triage, canActivate: boolean): HabitStatus {
  if (triage === 'do_now') return canActivate ? 'active' : 'waiting';
  if (triage === 'eliminate') return 'idea';
  return 'waiting';
}

// Eisenhower 2×2 hücre koordinatı (görsel için)
// row 0 = önemli, row 1 = önemsiz ; col 0 = acil, col 1 = acil değil
export function eisenhowerCell(impact: ImpactLevel | null, urgency: Urgency | null) {
  const important = impact === 'critical' || impact === 'high';
  const urgent = urgency === 'urgent';
  return { row: important ? 0 : 1, col: urgent ? 0 : 1 };
}
