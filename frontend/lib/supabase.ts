import type { PauseInterval, GoalVersion } from './habitPauses';
import { createClient } from '@supabase/supabase-js';
import { authStorage } from './authStorage';
import type { Database, TableRow } from './database.types';
import { signalOnSuccess } from './networkSignal';
import { AUTH_STORAGE_KEY } from './authStorageKey';
import {
  inspectPublicEnv,
  PLACEHOLDER_SUPABASE_KEY,
  PLACEHOLDER_SUPABASE_URL,
  rawPublicEnv,
  type PublicEnvStatus,
} from './env';

/**
 * F08 (BLD-02): the environment is validated in lib/env.ts (names only, never values). The root
 * layout shows ConfigErrorScreen when this is not ok; this module itself never throws on a missing
 * configuration.
 */
export const publicEnvStatus: PublicEnvStatus = inspectPublicEnv(rawPublicEnv());

/**
 * F06 (SYN-23): non-null when the build has no Supabase configuration; the root layout then shows
 * BootGate('config'). `createClient` used to throw "supabaseUrl is required" while this module was
 * loading, which took the whole app down before any screen (or error reporter) could render.
 */
export const SUPABASE_CONFIG_ERROR: string | null =
  publicEnvStatus.ok ? null : 'EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı değil.';

// placeholders only when the configuration is missing: no request to them ever succeeds
const supabaseUrl = publicEnvStatus.ok ? publicEnvStatus.env.supabaseUrl : PLACEHOLDER_SUPABASE_URL;
const supabaseAnonKey = publicEnvStatus.ok ? publicEnvStatus.env.supabaseAnonKey : PLACEHOLDER_SUPABASE_KEY;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    // F06: EXACTLY the supabase-js default for this URL (lib/authStorageKey.ts); changing its value signs everyone out
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    // URL'deki oturum malzemesini tüm platformlarda yalnız lib/authDeepLink.ts tüketir (GAP2-08)
    detectSessionInUrl: false,
  },
  // F05 (SYN-15): every successful answer tells lib/syncCoordinator the connection is there, so waiting
  // offline work goes out without the app being reopened. The answer is passed on untouched; a failed
  // request fails exactly as before (no signal). `fetch` is read at call time, not at module load.
  global: { fetch: signalOnSuccess(() => fetch) },
});

// Mevcut DB şemasına göre tipler
// habits tablosu: behavior_type, tracking_type ('boolean'|'numeric'), unit, daily_goal, willpower_cost, target_direction, frequency_config
// habit_logs tablosu: completed_at (date), value, is_completed, state, xp

export type FrequencyConfig = {
  kind: 'daily' | 'weekly' | 'monthly' | 'yearly';
  days?: number[];
  part_of_day?: ('morning' | 'afternoon' | 'evening')[];
  count?: number;
  // --- Aşağıdaki üç alan ADDITIVE'dir (task 1-W3 / IMPLEMENTATION_V2.md §8.7). ---
  // Var olan hiçbir satırın anlamını değiştirmezler (hepsi opsiyonel, hepsi undefined
  // iken davranış birebir eskisiyle aynıdır).
  //
  // Kalıcılık durumu (R00/R01.02-b'de canlıdan doğrulandı): `habits.frequency_config`
  // kısıtsız jsonb'dir — DB bu alanları kabul eder; "migration bloklu" DEĞİLDİR.
  // Bugün yazılmamalarının tek sebebi istemci tarafı: `lib/routineProposal.ts`
  // `ALLOWED_FREQUENCY_KEYS` bunları reddediyor, çünkü eski `isDueOn` onları
  // okumuyor. Kanonik yol (`isEligibleOn`, `periodStatus`, `streakBroken`) okur;
  // tüketiciler kanonik yola geçtiğinde validator genişletilebilir.
  /** `kind: 'daily'` ile birlikte: "her N günde bir". >1 olduğunda anlamlıdır. */
  interval_days?: number;
  /** Özel tarih aralığı — dahil (inclusive) alt sınır, 'YYYY-MM-DD'. */
  range_start?: string;
  /** Özel tarih aralığı — dahil (inclusive) üst sınır, 'YYYY-MM-DD'. */
  range_end?: string;
  /**
   * R01.02 — `kind: 'monthly'` ile: ayın SABİT günleri (1..31). Varsa şekil
   * "ayda N kez" değil, "ayın 1'i ve 15'i" olur.
   */
  month_days?: number[];
  /**
   * R01.02 — 28'den büyük bir ay günü kısa ayda ne olur: `skip` o ay yok,
   * `last_day` ayın son gününe taşınır. 28'i aşan gün varsa ZORUNLU; sessiz
   * bir varsayılan yoktur.
   */
  short_month?: 'skip' | 'last_day';
  /** R01.02 — `kind: 'yearly'` ile: ay (1..12) ve gün (1..31). */
  month?: number;
  day?: number;
  /** R01.02 — 29 Şubat yıllık tarihi artık yıl olmayan yıllarda: 28 Şubat, 1 Mart ya da atla. 29 Şubat için ZORUNLU. */
  leap_day?: 'feb28' | 'mar1' | 'skip';
};

export type EndCondition = {
  kind: 'date' | 'amount';
  value: string | number;
};

export type HabitTemplate = {
  name: string;
  icon?: string;
  type: 'yes_no' | 'measurable';
  frequency: FrequencyConfig;
  willpower_cost: number;
};

export type Habit = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  behavior_type: 'positive' | 'negative';
  // DB'nin `habits_tracking_type_check` kısıtının kabul ettiği dört değer.
  // 'duration' ve 'abstinence' 005_phase1_core_engine.sql ile açıldı ve
  // 2026-08-30'da canlıya uygulandı — artık yazılabilir.
  //
  // `behavior_type` ile `tracking_type` İKİ AYRI kavramdır: ilki "bu alışkanlık
  // kazanılacak mı, bırakılacak mı", ikincisi "nasıl ölçülür". Biri diğerini
  // ezmez; bu sayede "günde en fazla 2 sigara" (negative + numeric) ifade
  // edilebilir. Eşleme için lib/habitEngine.ts'teki adaptTrackingType'a bak.
  tracking_type: 'boolean' | 'numeric' | 'duration' | 'abstinence';
  unit: string | null;
  daily_goal: number | null;          // target_value
  target_direction: 'at_least' | 'at_most' | null;
  frequency_config: FrequencyConfig;  // jsonb
  willpower_cost: number;
  status: 'active' | 'waiting' | 'paused' | 'completed' | 'archived' | 'idea';
  // Karar çerçeveleri (Etki-Şiddet + Eisenhower aciliyet)
  impact_level: 'critical' | 'high' | 'medium' | 'low' | null;
  urgency: 'urgent' | 'not_urgent' | null;
  difficulty: number;  // 1=Kolay, 3=Orta, 5=Zor — irade maliyeti hesabında kullanılır
  estimated_minutes: number;  // günlük tahmini süre (dk)
  reminders: ReminderConfig;  // günlük hatırlatıcı
  cue_habit_id: string | null;  // "X alışkanlığından sonra" çağrışımı
  cue_note: string | null;      // "Kahvaltıdan sonra" serbest çağrışım
  life_area: string | null;     // yaşam alanı kategorisi (LIFE_AREAS anahtarı)
  end_condition: EndCondition | null;
  created_at: string;
  current_streak?: number | null;
  best_streak?: number | null;
  streak_current?: number | null;
  streak_best?: number | null;
  /**
   * R01.05 — attached IN MEMORY by the store (habit_pauses: own pauses + holidays);
   * NOT a habits column. Stripped from every habit write (habitRepository).
   */
  pause_intervals?: PauseInterval[];
  /** R01.05 — effective-dated goal/schedule versions (habit_goal_versions), in memory only. */
  goal_versions?: GoalVersion[];
};

/**
 * `time` is the first (or only) reminder time. R04.02 adds, backward
 * compatibly in the same jsonb: `times` (several times a day) and `days`
 * (weekday indexes, 0 = Monday; empty/absent = every scheduled day).
 */
export type ReminderConfig = { time: string; enabled: boolean; times?: string[]; days?: number[] } | null;

// NOT: "bu alışkanlık ölçülebilir mi" sorusunun tek cevabı
// `lib/habitEngine.ts`'teki `isMeasurableTracking`. Buraya konmadı çünkü bu
// modül yüklendiği anda bir Supabase istemcisi kuruyor (yukarıdaki
// `createClient`); saf domain modüllerinin (triage, reportMetrics) bunu
// import etmek zorunda kalmaması gerekir.
//
// Burada eskiden kullanılmayan bir `habitType()` yardımcısı vardı; hiçbir
// çağıranı yoktu ve `tracking_type === 'numeric'` karşılaştırmasını
// kopyalıyordu — yani 'duration' eklendiğinde sessizce yanlış cevap verecek
// ikinci bir yerdi. Kaldırıldı.

export type HabitLog = {
  id: string;
  habit_id: string;
  user_id: string;
  completed_at: string;   // date string 'yyyy-MM-dd'
  value: number | null;
  is_completed: boolean;
  state: 'done' | 'partial' | 'skip' | 'miss';
  xp: number | null;
  created_at: string;
  /** R01.06 — IANA zone the log was written in; null on older rows (migration 033). */
  tz?: string | null;
};

// profiles tablosu — XP/level/rütbe (oyunlaştırma)
export type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  level: number;
  total_xp: number;
  current_level_xp: number;
  next_level_xp: number;
  willpower_rank: string | null;
  streak_record: number | null;
  created_at: string;
  time_zone?: string | null;
};

// profile_badges tablosu — kazanılan rozetler
export type ProfileBadge = {
  id: string;
  user_id: string;
  badge_name: string;
  icon: string | null;
  description: string | null;
  earned_at: string;
};

// Liderlik tablosu satırı (get_global_leaderboard / get_weekly_leaderboard RPC çıktısı)
export type LeaderboardRow = {
  user_id: string;
  username: string;
  level: number;
  total_xp: number;
  weekly_xp?: number;
  willpower_rank: string;
  rank: number;
};

/** The willpower_state row: ONE definition (the generated Row), so a column change is a compile error here. */
export type WillpowerState = TableRow<'willpower_state'>;

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  source: 'ai' | 'library' | 'custom';
  prompt: string | null;
};

// Telafi planı — kaçırılan/kısmi alışkanlık için "nasıl + ne zaman" telafisi
//
// Bu tip artık ALAN sözlüğünün kendisi. Daha önce satır tipi legacy
// ('full'|'half'|'mini'|'reschedule'), alan tipi v2 ('complete_today'|...)
// idi ve aradaki adaptör her kayıtta beş alanı sessizce düşürüyordu --
// `deficit_value`, `distributed_days`, `source_log_id`, `deficit_type`,
// `completed_at`. Gerekçesi "henüz sütunları yok" idi; oysa hepsi
// 005_phase1_core_engine ile eklenmişti. Sözlük 013_recovery_vocabulary ile tek'e
// indirildi ve adaptör kaldırıldı.
//
// DEPLOY DURUMU: bu geçici geri alma KAPATILDI. Koordineli v2 sürümü
// 025_recovery_v2_vocabulary_release ile uygulandı; canlı
// kbcuolhjjnmhjaarxxmu artık yalnızca aşağıdaki sözlüğü kabul ediyor
// (strategy CHECK ve status CHECK v2, strategy DEFAULT 'complete_today').
// Legacy kelimeler -- full/half/mini/reschedule, done/skipped -- canlıda
// REDDEDİLİYOR; pre-merge audit §0b'deki release gate kapandı.
export type RecoveryStrategy = 'complete_today' | 'push_tomorrow' | 'split_two_days' | 'skip';
export type RecoveryStatus = 'planned' | 'completed' | 'expired' | 'cancelled';
export type RecoveryDeficitType = 'numeric' | 'binary';

export type RecoveryPlan = {
  id: string;
  user_id: string;
  habit_id: string;
  /** `habit_logs.id` bu telafinin yanıt verdiği kayıt. */
  source_log_id: string | null;
  source_date: string;     // kaçırılan/kısmi gün 'yyyy-MM-dd'
  target_date: string;     // planlanan telafi günü 'yyyy-MM-dd'
  /** Ne kadar borçlanıldı (lib/recovery.deficitFor). */
  deficit_type: RecoveryDeficitType | null;
  deficit_value: number | null;
  strategy: RecoveryStrategy;
  /** `split_two_days` için günlere dağıtım. */
  distributed_days: { date: string; value: number }[] | null;
  note: string | null;
  reminder_time: string | null;  // 'HH:mm'
  status: RecoveryStatus;
  /** Yalnızca `status = 'completed'` iken dolu -- DB CHECK bunu zorunlu kılar. */
  completed_at: string | null;
  created_at: string;
};
