import {
  ROUTINE_PACKS,
  packLoad,
  type RoutinePack,
  type RoutinePackKey,
} from './routinePacks';
import { computeWillpowerCost } from './triage';
import { dailyLoad, type HabitLoadInput } from './capacity';
import type { FrequencyConfig, Habit } from './supabase';

export type ExploreCategory =
  | 'all'
  | 'morning'
  | 'focus'
  | 'sleep'
  | 'health'
  | 'mind'
  | 'finance';

export const EXPLORE_CATEGORIES: {
  key: ExploreCategory;
  label: string;
  icon: string;
  color: string;
}[] = [
  { key: 'all', label: 'Tümü', icon: 'sparkles-outline', color: '#8b5cf6' },
  { key: 'morning', label: 'Sabah Enerjisi', icon: 'sunny-outline', color: '#f59e0b' },
  { key: 'focus', label: 'Odak & Üretkenlik', icon: 'flash-outline', color: '#14b8a6' },
  { key: 'sleep', label: 'Uyku Hijyeni', icon: 'moon-outline', color: '#6366f1' },
  { key: 'health', label: 'Beden & Sağlık', icon: 'fitness-outline', color: '#10b981' },
  { key: 'mind', label: 'Zihin & Sakinlik', icon: 'leaf-outline', color: '#ec4899' },
  { key: 'finance', label: 'Finans & Düzen', icon: 'wallet-outline', color: '#06b6d4' },
];

export type ExploreCollection = {
  key: RoutinePackKey;
  pack: RoutinePack;
  badge: string;
  icon: string;
  color: string;
  timeWindowLabel: string;
  scientificSummary: string;
  totalMinutes: number;
  computedLoad: number;
};

const COLLECTION_META: Record<
  RoutinePackKey,
  {
    badge: string;
    icon: string;
    color: string;
    timeWindowLabel: string;
    scientificSummary: string;
  }
> = {
  'morning-reset': {
    badge: 'SABAH RİTÜELİ',
    icon: 'sunny',
    color: '#f59e0b',
    timeWindowLabel: '06:30 – 10:00',
    scientificSummary:
      'Uyandıktan sonraki ilk 60 dakikada hidratasyon, doğal gün ışığı ve mikro hareket ile kortizol uyanış tepkisini (CAR) dengeler; güne reaktif değil kontrollü başlamanızı sağlar.',
  },
  'deep-work': {
    badge: 'ODAK PROTOKOLÜ',
    icon: 'flash',
    color: '#14b8a6',
    timeWindowLabel: '09:30 – 16:30',
    scientificSummary:
      'Bilişsel bağlam değiştirme (context-switching) maliyetini sıfırlamak için tekil öncelik belirleme ve bildirimsiz 50 dakikalık ultradian odak blokları kurar.',
  },
  'sleep-reset': {
    badge: 'GECE & UYKU HİJYENİ',
    icon: 'moon',
    color: '#6366f1',
    timeWindowLabel: '21:00 – 23:30',
    scientificSummary:
      'Mavi ışık maruziyetini keserek melatonin baskılanmasını önler, parasempatik sinir sistemini devreye sokar ve derin uyku (REM/NREM) mimarisini korur.',
  },
  'fitness-foundation': {
    badge: 'FİZİKSEL DAYANIKLILIK',
    icon: 'barbell',
    color: '#10b981',
    timeWindowLabel: 'Gün İçi & Akşam',
    scientificSummary:
      'Direnç antrenmanı, eklem mobilitesi, günlük 8000 adım ve makro/su takibini birleştirerek metabolik ve kas-iskelet sağlığını sürdürülebilir bir rutine bağlar.',
  },
  'everyday-foundations': {
    badge: 'DÜŞÜK SÜRTÜNMELİ ÇAPALAR',
    icon: 'leaf',
    color: '#ec4899',
    timeWindowLabel: 'Tüm Gün · Mikro',
    scientificSummary:
      'Yorgun veya yoğun günlerde bile seriyi kırmadan sürdürülebilen, her biri 3–10 dakikalık düşük irade maliyetli atomik alışkanlık çapaları sunar.',
  },
};

export const EXPLORE_COLLECTIONS: ExploreCollection[] = ROUTINE_PACKS.map((pack) => {
  const meta = COLLECTION_META[pack.key];
  const totalMinutes = pack.habits.reduce((acc, h) => acc + h.estimated_minutes, 0);
  return {
    key: pack.key,
    pack,
    badge: meta.badge,
    icon: meta.icon,
    color: meta.color,
    timeWindowLabel: meta.timeWindowLabel,
    scientificSummary: meta.scientificSummary,
    totalMinutes,
    computedLoad: Math.round(packLoad(pack)),
  };
});

export function getRecommendedCollectionForHour(hour: number): ExploreCollection {
  let targetKey: RoutinePackKey = 'morning-reset';
  if (hour >= 5 && hour < 11) targetKey = 'morning-reset';
  else if (hour >= 11 && hour < 17) targetKey = 'deep-work';
  else if (hour >= 17 && hour < 21) targetKey = 'fitness-foundation';
  else targetKey = 'sleep-reset';

  return (
    EXPLORE_COLLECTIONS.find((c) => c.key === targetKey) ?? EXPLORE_COLLECTIONS[0]
  );
}

export type ExploreAtomicHabit = {
  id: string;
  name: string;
  icon: string;
  color: string;
  category: Exclude<ExploreCategory, 'all'>;
  daypartLabel: string;
  difficulty: 1 | 3 | 5;
  estimated_minutes: number;
  tracking_type: 'boolean' | 'numeric';
  unit?: string | null;
  daily_goal?: number | null;
  target_direction?: 'at_least' | 'at_most' | null;
  frequency_config: FrequencyConfig;
  life_area: string;
  whyItWorks: string;
  packKey?: RoutinePackKey;
};

export const EXPLORE_ATOMIC_HABITS: ExploreAtomicHabit[] = [
  // SABAH ENERJİSİ
  {
    id: 'atomic-water-morning',
    name: 'Bir bardak su iç',
    icon: 'water-outline',
    color: '#f59e0b',
    category: 'morning',
    daypartLabel: 'Sabah · Uyanınca',
    difficulty: 1,
    estimated_minutes: 2,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Sağlık',
    whyItWorks: 'Gece boyunca oluşan hafif dehidrasyonu giderir ve metabolik uyanışı hızlandırır.',
    packKey: 'morning-reset',
  },
  {
    id: 'atomic-make-bed',
    name: 'Yatağını topla',
    icon: 'bed-outline',
    color: '#f59e0b',
    category: 'morning',
    daypartLabel: 'Sabah · 3 dk',
    difficulty: 1,
    estimated_minutes: 3,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Yaşam Düzeni',
    whyItWorks: 'Günün ilk "tamamlanmış görev" dopaminini üreterek zincirleme düzen hissini başlatır.',
    packKey: 'morning-reset',
  },
  {
    id: 'atomic-sunlight-walk',
    name: 'Gün ışığında kısa yürüyüş',
    icon: 'sunny-outline',
    color: '#f59e0b',
    category: 'morning',
    daypartLabel: 'Sabah · 15 dk',
    difficulty: 3,
    estimated_minutes: 15,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Sağlık',
    whyItWorks: 'Sabah doğal ışık retinadaki ipRGC hücrelerini uyararak sirkadiyen saati ve akşam melatonin salgısını kilitler.',
    packKey: 'morning-reset',
  },

  // ODAK & ÜRETKENLİK
  {
    id: 'atomic-top3-priorities',
    name: 'Günün 3 önceliğini yaz',
    icon: 'journal-outline',
    color: '#14b8a6',
    category: 'focus',
    daypartLabel: 'Sabah · Planlama',
    difficulty: 3,
    estimated_minutes: 10,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Kariyer & Odak',
    whyItWorks: 'Karar yorgunluğunu (decision fatigue) önler; çalışma belleğini gün boyu sadece 3 ana çıktıya odaklar.',
    packKey: 'morning-reset',
  },
  {
    id: 'atomic-deep-work-50',
    name: 'Kesintisiz derin çalışma bloğu',
    icon: 'hourglass-outline',
    color: '#14b8a6',
    category: 'focus',
    daypartLabel: 'Gün İçi · 50 dk',
    difficulty: 5,
    estimated_minutes: 50,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Kariyer & Odak',
    whyItWorks: 'Dikkat kalıntısını (attention residue) temizleyerek en zor bilişsel işi yüksek akış (flow) halinde bitirmenizi sağlar.',
    packKey: 'deep-work',
  },
  {
    id: 'atomic-no-notif-sprint',
    name: 'Bildirimsiz odak seansı',
    icon: 'eye-off-outline',
    color: '#14b8a6',
    category: 'focus',
    daypartLabel: 'Gün İçi · 25 dk',
    difficulty: 5,
    estimated_minutes: 25,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Kariyer & Odak',
    whyItWorks: 'Telefonu görüş alanından çıkarmak bile bilişsel kapasiteyi %10–15 oranında geri kazandırır.',
    packKey: 'deep-work',
  },

  // UYKU HİJYENİ
  {
    id: 'atomic-no-screen-bedtime',
    name: 'Yatmadan 1 saat önce ekran yok',
    icon: 'phone-portrait-outline',
    color: '#6366f1',
    category: 'sleep',
    daypartLabel: 'Gece · Uyku Öncesi',
    difficulty: 3,
    estimated_minutes: 25,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Uyku',
    whyItWorks: 'Kısa dalga boylu mavi ışığı ve sosyal medya dopamin döngüsünü keserek uykuya geçiş süresini kısaltır.',
    packKey: 'sleep-reset',
  },
  {
    id: 'atomic-caffeine-cutoff',
    name: 'Öğleden sonra kafeini kes',
    icon: 'cafe-outline',
    color: '#6366f1',
    category: 'sleep',
    daypartLabel: '14:00 Sonrası',
    difficulty: 1,
    estimated_minutes: 5,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Uyku',
    whyItWorks: 'Kafeinin yarılanma ömrü 5–7 saattir; öğleden sonra kesmek gece derin uyku (SWS) kalitesini korur.',
    packKey: 'sleep-reset',
  },
  {
    id: 'atomic-dim-lights',
    name: 'Işıkları kıs',
    icon: 'bulb-outline',
    color: '#6366f1',
    category: 'sleep',
    daypartLabel: 'Gece · 5 dk',
    difficulty: 1,
    estimated_minutes: 5,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Uyku',
    whyItWorks: 'Tavan aydınlatması yerine sıcak/loş ışık kullanmak epifiz bezine biyolojik gece sinyalini verir.',
    packKey: 'sleep-reset',
  },

  // BEDEN & SAĞLIK
  {
    id: 'atomic-mobility-10',
    name: '10 dakika esneme / mobilite',
    icon: 'body-outline',
    color: '#10b981',
    category: 'health',
    daypartLabel: 'Sabah / Akşam · 12 dk',
    difficulty: 3,
    estimated_minutes: 12,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Sağlık',
    whyItWorks: 'Masa başı duruş kaynaklı omurga ve kalça gerginliğini çözer, eklem kan dolaşımını artırır.',
    packKey: 'morning-reset',
  },
  {
    id: 'atomic-steps-8000',
    name: 'Adım hedefi',
    icon: 'footsteps-outline',
    color: '#10b981',
    category: 'health',
    daypartLabel: 'Tüm Gün · 8000 adım',
    difficulty: 3,
    estimated_minutes: 8,
    tracking_type: 'numeric',
    unit: 'adım',
    daily_goal: 8000,
    target_direction: 'at_least',
    frequency_config: { kind: 'daily' },
    life_area: 'Sağlık',
    whyItWorks: 'Günlük 8000 adım, kardiyovasküler sağlık ve insülin duyarlılığı için klinik olarak en verimli eşiktir.',
    packKey: 'fitness-foundation',
  },
  {
    id: 'atomic-water-8-glasses',
    name: 'Su hedefi',
    icon: 'water-outline',
    color: '#10b981',
    category: 'health',
    daypartLabel: 'Tüm Gün · 8 bardak',
    difficulty: 1,
    estimated_minutes: 5,
    tracking_type: 'numeric',
    unit: 'bardak',
    daily_goal: 8,
    target_direction: 'at_least',
    frequency_config: { kind: 'daily' },
    life_area: 'Sağlık',
    whyItWorks: '%2’lik su kaybı bile odaklanmayı ve kısa süreli belleği düşürür; ölçülebilir su takibi gün boyu zindelik sağlar.',
    packKey: 'fitness-foundation',
  },

  // ZİHİN & SAKİNLİK
  {
    id: 'atomic-breath-5min',
    name: '5 dakika nefes egzersizi',
    icon: 'leaf-outline',
    color: '#ec4899',
    category: 'mind',
    daypartLabel: 'Sabah / Stres Anı · 5 dk',
    difficulty: 1,
    estimated_minutes: 5,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Zihin',
    whyItWorks: 'Uzun nefes verme (4-4-6) vagus sinirini uyararak kalp atış hızını ve akut stresi 90 saniye içinde düşürür.',
    packKey: 'everyday-foundations',
  },
  {
    id: 'atomic-reading-10min',
    name: '10 dakika okuma',
    icon: 'book-outline',
    color: '#ec4899',
    category: 'mind',
    daypartLabel: 'Akşam · 10 dk',
    difficulty: 1,
    estimated_minutes: 10,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Gelişim',
    whyItWorks: 'Günde sadece 10 dakika okuma, yılda ~15 kitap bitirmenizi sağlar ve zihni hızlı ekran uyarımından yavaş düşünmeye geçirir.',
    packKey: 'everyday-foundations',
  },
  {
    id: 'atomic-gratitude-note',
    name: 'Uyumadan önce şükran notu',
    icon: 'heart-outline',
    color: '#ec4899',
    category: 'mind',
    daypartLabel: 'Gece · 5 dk',
    difficulty: 3,
    estimated_minutes: 5,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Zihin',
    whyItWorks: 'Beynin olumsuzluk önyargısını (negativity bias) dengeler; gece ruminasyonunu azaltarak uykuya geçişi rahatlatır.',
    packKey: 'sleep-reset',
  },

  // FİNANS & DÜZEN
  {
    id: 'atomic-expense-log',
    name: 'Günlük harcamaları kaydet',
    icon: 'wallet-outline',
    color: '#06b6d4',
    category: 'finance',
    daypartLabel: 'Akşam · 5 dk',
    difficulty: 1,
    estimated_minutes: 5,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Finans',
    whyItWorks: 'Harcamayı yapıldığı gün kaydetmek dürtüsel alışveriş farkındalığını artırır ve ay sonu sürprizlerini önler.',
    packKey: 'everyday-foundations',
  },
  {
    id: 'atomic-clear-desk',
    name: 'Çalışma alanını topla',
    icon: 'file-tray-outline',
    color: '#06b6d4',
    category: 'finance',
    daypartLabel: 'Akşam · 5 dk',
    difficulty: 1,
    estimated_minutes: 5,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Yaşam Düzeni',
    whyItWorks: 'Ertesi sabah masaya oturduğunuzda görsel karmaşayı sıfırlar; işe başlama sürtünmesini ortadan kaldırır.',
    packKey: 'everyday-foundations',
  },
  {
    id: 'atomic-evening-review',
    name: 'Gün sonu değerlendirme',
    icon: 'checkmark-done-outline',
    color: '#06b6d4',
    category: 'finance',
    daypartLabel: 'Akşam · 5 dk',
    difficulty: 1,
    estimated_minutes: 5,
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    life_area: 'Yaşam Düzeni',
    whyItWorks: 'Açık kalan görev döngülerini (Zeigarnik etkisi) kağıda/sisteme aktararak zihnin akşam gerçekten dinlenmesini sağlar.',
    packKey: 'deep-work',
  },
];

export function buildAtomicHabitInsert(
  item: ExploreAtomicHabit,
  existingActiveHabits: Habit[],
): {
  insertPayload: Omit<Habit, 'id' | 'created_at' | 'user_id'>;
  assignedStatus: 'active' | 'waiting';
} {
  const activeInputs: HabitLoadInput[] = existingActiveHabits.map((h) => ({
    difficulty: h.difficulty ?? 3,
    estimated_minutes: h.estimated_minutes ?? 15,
    frequency_config: h.frequency_config,
    impact_level: h.impact_level ?? null,
  }));
  const candidateInput: HabitLoadInput = {
    difficulty: item.difficulty,
    estimated_minutes: item.estimated_minutes,
    frequency_config: item.frequency_config,
    impact_level: 'medium',
  };

  const afterEval = dailyLoad({ habits: [...activeInputs, candidateInput] });
  const assignedStatus: 'active' | 'waiting' =
    afterEval.band === 'asiri' ? 'waiting' : 'active';

  const willpowerCost = computeWillpowerCost({
    difficulty: item.difficulty,
    impact_level: 'medium',
    behavior_type: 'positive',
    tracking_type: item.tracking_type,
    frequency_config: item.frequency_config,
    estimated_minutes: item.estimated_minutes,
  });

  return {
    assignedStatus,
    insertPayload: {
      name: item.name,
      icon: item.icon,
      color: item.color,
      behavior_type: 'positive',
      tracking_type: item.tracking_type,
      unit: item.unit ?? null,
      daily_goal: item.daily_goal ?? null,
      target_direction: item.target_direction ?? null,
      frequency_config: item.frequency_config,
      willpower_cost: willpowerCost,
      status: assignedStatus,
      impact_level: 'medium',
      urgency: 'not_urgent',
      difficulty: item.difficulty,
      estimated_minutes: item.estimated_minutes,
      reminders: null,
      cue_habit_id: null,
      cue_note: null,
      life_area: item.life_area,
      end_condition: null,
    },
  };
}

