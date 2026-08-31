// Karar çerçeveleri çekirdeği — Etki-Şiddet + Eisenhower + Triaj + Kanban
// HabitOnboarding ve habits.tsx tarafından paylaşılan tek kaynak.

import { colors } from '../lib/tokens';
import type { Habit, EndCondition } from './supabase';
import { isMeasurableTracking } from './habitEngine';

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
  frequency_config: { kind: 'daily' | 'weekly' | 'monthly' };
  estimated_minutes?: number;
};

const FREQ_FACTOR: Record<string, number> = { daily: 1.0, weekly: 0.7, monthly: 0.5 };
const IMPACT_BONUS: Record<ImpactLevel, number> = { critical: 1.5, high: 1.0, medium: 0.5, low: 0 };

// Şeffaf maliyet dökümü — her faktörün katkısı
export function costBreakdown(input: CostInput) {
  const diff = input.difficulty || 3;
  const freqKind = input.frequency_config?.kind ?? 'daily';
  const freqFactor = FREQ_FACTOR[freqKind] ?? 1.0;
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
