import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Mevcut DB şemasına göre tipler
// habits tablosu: behavior_type, tracking_type ('boolean'|'numeric'), unit, daily_goal, willpower_cost, target_direction, frequency_config
// habit_logs tablosu: completed_at (date), value, is_completed, state, xp

export type FrequencyConfig = {
  kind: 'daily' | 'weekly' | 'monthly';
  days?: number[];
  part_of_day?: ('morning' | 'afternoon' | 'evening')[];
  count?: number;
  // --- Aşağıdaki üç alan ADDITIVE'dir (task 1-W3 / IMPLEMENTATION_V2.md §8.7). ---
  // Hiçbiri bugün DB'ye yazılmıyor/okunmuyor; yalnızca `lib/habitSchedule.ts`
  // içindeki `scheduleKind`/`streakBroken` gibi V2 fonksiyonları tüketiyor.
  // Var olan hiçbir satırın anlamını değiştirmezler (hepsi opsiyonel, hepsi undefined
  // iken davranış birebir eskisiyle aynıdır). Migration bloklu olduğu için henüz
  // kalıcı hâle getirilemiyorlar — bkz. habitSchedule.ts en üstündeki not.
  /** `kind: 'daily'` ile birlikte: "her N günde bir". >1 olduğunda anlamlıdır. */
  interval_days?: number;
  /** Özel tarih aralığı — dahil (inclusive) alt sınır, 'YYYY-MM-DD'. */
  range_start?: string;
  /** Özel tarih aralığı — dahil (inclusive) üst sınır, 'YYYY-MM-DD'. */
  range_end?: string;
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
  // 'duration' ve 'abstinence' 20260825_phase1_core_engine.sql ile açıldı ve
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
};

export type ReminderConfig = { time: string; enabled: boolean } | null;

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

export type WillpowerState = {
  user_id: string;
  state_date: string;     // date string
  daily_budget: number;
  used: number;
  focus_capacity: number;
  active_count: number;
};

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
// 20260825'te eklenmişti. Sözlük 20260831_recovery_vocabulary ile tek'e
// indirildi ve adaptör kaldırıldı.
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
