import {
  ROUTINE_PACKS,
  packLoad,
  type RoutinePack,
  type RoutinePackHabit,
  type RoutinePackKey,
} from './routinePacks';
import { computeWillpowerCost } from './triage';
import { canActivate as fitsCapacity, habitLoadPoints, habitsInRangeOn } from './capacity';
import type { FrequencyConfig, Habit } from './supabase';

export type ExploreCategory =
  | 'all'
  | 'morning'
  | 'focus'
  | 'sleep'
  | 'health'
  | 'mind'
  | 'order';

const EXPLORE_HUE: Record<ExploreCategory, string> = {
  all: '#8b5cf6',
  morning: '#f59e0b',
  focus: '#14b8a6',
  sleep: '#6366f1',
  health: '#10b981',
  mind: '#ec4899',
  order: '#06b6d4',
};

// OD-06 (2026-11-21): sahip onayıyla sabitlendi.
export const EXPLORE_ORDER_LABEL = 'Ev & Evrak Düzeni';

export const EXPLORE_CATEGORIES: {
  key: ExploreCategory;
  label: string;
  icon: string;
  color: string;
}[] = [
  { key: 'all', label: 'Tümü', icon: 'sparkles-outline', color: EXPLORE_HUE.all },
  { key: 'morning', label: 'Sabah Enerjisi', icon: 'sunny-outline', color: EXPLORE_HUE.morning },
  { key: 'focus', label: 'Odak & Üretkenlik', icon: 'flash-outline', color: EXPLORE_HUE.focus },
  { key: 'sleep', label: 'Uyku Hijyeni', icon: 'moon-outline', color: EXPLORE_HUE.sleep },
  { key: 'health', label: 'Beden & Sağlık', icon: 'fitness-outline', color: EXPLORE_HUE.health },
  { key: 'mind', label: 'Zihin & Sakinlik', icon: 'leaf-outline', color: EXPLORE_HUE.mind },
  { key: 'order', label: EXPLORE_ORDER_LABEL, icon: 'file-tray-full-outline', color: EXPLORE_HUE.order },
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
    color: EXPLORE_HUE.morning,
    timeWindowLabel: '06:30 – 10:00',
    scientificSummary:
      'Uyandıktan sonraki ilk saatte bir bardak su, gün ışığı ve kısa hareketle güne telaşsız, kendi ritminde başlamana yardım edebilir.',
  },
  'deep-work': {
    badge: 'ODAK PROTOKOLÜ',
    icon: 'flash',
    color: EXPLORE_HUE.focus,
    timeWindowLabel: '09:30 – 16:30',
    scientificSummary:
      'Önceliklerini sadeleştirip bildirimleri sessize alarak dikkat dağılmasını azaltmana ve tek bir işe odaklanmana destek olabilir.',
  },
  'sleep-reset': {
    badge: 'GECE & UYKU HİJYENİ',
    icon: 'moon',
    color: EXPLORE_HUE.sleep,
    timeWindowLabel: '21:00 – 23:30',
    scientificSummary:
      'Akşam saatlerinde ekran ve parlak ışığı azaltıp sakin bir kapanış kurmak, zihninin yavaşlamasını ve uykuya geçişi kolaylaştırabilir.',
  },
  'fitness-foundation': {
    badge: 'FİZİKSEL DAYANIKLILIK',
    icon: 'barbell',
    color: EXPLORE_HUE.health,
    timeWindowLabel: 'Gün İçi & Akşam',
    scientificSummary:
      'Düzenli hareket, esneme, adım ve su alışkanlıklarını bir araya getirerek gün boyu enerjini dengeli tutmana yardımcı olabilir.',
  },
  'everyday-foundations': {
    badge: 'DÜŞÜK SÜRTÜNMELİ ÇAPALAR',
    icon: 'leaf',
    color: EXPLORE_HUE.mind,
    timeWindowLabel: 'Tüm Gün · Mikro',
    scientificSummary:
      'Yorgun veya yoğun günlerde bile zorlanmadan sürdürülebilen, her biri 3–10 dakikalık düşük yüklü küçük günlük çapalar sunar.',
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
  tracking_type: RoutinePackHabit['tracking_type'];
  unit?: string | null;
  daily_goal?: number | null;
  target_direction?: 'at_least' | 'at_most' | null;
  frequency_config: FrequencyConfig;
  life_area: string;
  whyItWorks: string;
  packKey?: RoutinePackKey;
};

type ExploreAtomicExtra = {
  id: string;
  color: string;
  category: Exclude<ExploreCategory, 'all'>;
  daypartLabel: string;
  life_area: string;
  whyItWorks: string;
};

function fromPack(
  packKey: RoutinePackKey,
  habitName: string,
  extra: ExploreAtomicExtra,
): ExploreAtomicHabit {
  const pack = ROUTINE_PACKS.find((p) => p.key === packKey);
  const habit = pack?.habits.find((h) => h.name === habitName);
  if (!pack || !habit) {
    throw new Error(`exploreCatalog: "${habitName}" alışkanlığı "${packKey}" paketinde bulunamadı.`);
  }
  return {
    id: extra.id,
    name: habit.name,
    icon: habit.icon,
    color: extra.color,
    category: extra.category,
    daypartLabel: extra.daypartLabel,
    difficulty: habit.difficulty,
    estimated_minutes: habit.estimated_minutes,
    tracking_type: habit.tracking_type,
    ...(habit.unit !== undefined ? { unit: habit.unit } : {}),
    ...(habit.daily_goal !== undefined ? { daily_goal: habit.daily_goal } : {}),
    ...(habit.target_direction !== undefined ? { target_direction: habit.target_direction } : {}),
    frequency_config: habit.frequency_config,
    life_area: extra.life_area,
    whyItWorks: extra.whyItWorks,
    packKey,
  };
}

export const EXPLORE_ATOMIC_HABITS: ExploreAtomicHabit[] = [
  // SABAH ENERJİSİ
  fromPack('morning-reset', 'Bir bardak su iç', {
    id: 'atomic-water-morning',
    color: EXPLORE_HUE.morning,
    category: 'morning',
    daypartLabel: 'Sabah · Uyanınca',
    life_area: 'Sağlık',
    whyItWorks:
      'Gece boyunca kuruyan vücuduna güne başlamadan önce küçük bir iyilik yapmak, güne daha hafif başlamana yardım edebilir.',
  }),
  fromPack('morning-reset', 'Yatağını topla', {
    id: 'atomic-make-bed',
    color: EXPLORE_HUE.morning,
    category: 'morning',
    daypartLabel: 'Sabah · 3 dk',
    life_area: 'Yaşam Düzeni',
    whyItWorks:
      'Günün ilk küçük adımını birkaç dakikada tamamlamak, odada sade bir düzen hissi kurmana yardımcı olabilir.',
  }),
  fromPack('morning-reset', 'Gün ışığında kısa yürüyüş', {
    id: 'atomic-sunlight-walk',
    color: EXPLORE_HUE.morning,
    category: 'morning',
    daypartLabel: 'Sabah · 15 dk',
    life_area: 'Sağlık',
    whyItWorks:
      'Sabah açık havada ve doğal ışıkta birkaç dakika yürümek, uyku mahmurluğunu dağıtıp güne uyanık başlamana destek olabilir.',
  }),

  // ODAK & ÜRETKENLİK
  fromPack('morning-reset', 'Günün 3 önceliğini yaz', {
    id: 'atomic-top3-priorities',
    color: EXPLORE_HUE.focus,
    category: 'focus',
    daypartLabel: 'Sabah · Planlama',
    life_area: 'Kariyer & Odak',
    whyItWorks:
      'Gün boyu her şeye yetişmeye çalışmak yerine yalnızca 3 net öncelik seçmek, karar yorgunluğunu hafifletebilir.',
  }),
  fromPack('deep-work', 'Kesintisiz derin çalışma bloğu', {
    id: 'atomic-deep-work-50',
    color: EXPLORE_HUE.focus,
    category: 'focus',
    daypartLabel: 'Gün İçi · 50 dk',
    life_area: 'Kariyer & Odak',
    whyItWorks:
      'Tek bir işe kesintisiz zaman ayırmak, yarım kalan işlerin yarattığı dağınıklığı azaltıp ilerleme hissini güçlendirebilir.',
  }),
  fromPack('deep-work', 'Bildirimsiz odak seansı', {
    id: 'atomic-no-notif-sprint',
    color: EXPLORE_HUE.focus,
    category: 'focus',
    daypartLabel: 'Gün İçi · 25 dk',
    life_area: 'Kariyer & Odak',
    whyItWorks:
      'Telefonu ve bildirimleri kısa süreliğine görüş alanından uzaklaştırmak, bölünmeden çalışmanı kolaylaştırabilir.',
  }),

  // UYKU HİJYENİ
  fromPack('sleep-reset', 'Yatmadan 1 saat önce ekran yok', {
    id: 'atomic-no-screen-bedtime',
    color: EXPLORE_HUE.sleep,
    category: 'sleep',
    daypartLabel: 'Gece · Uyku Öncesi',
    life_area: 'Uyku',
    whyItWorks:
      'Uyumadan önce parlak ekranlara ve akışlara ara vermek, zihninin gece temposuna daha sakin geçmesine yardım edebilir.',
  }),
  fromPack('sleep-reset', 'Öğleden sonra kafeini kes', {
    id: 'atomic-caffeine-cutoff',
    color: EXPLORE_HUE.sleep,
    category: 'sleep',
    daypartLabel: '14:00 Sonrası',
    life_area: 'Uyku',
    whyItWorks:
      'Kafeinin etkisi saatlerce sürebildiği için öğleden sonra ara vermek, akşam daha rahat gevşemene destek olabilir.',
  }),
  fromPack('sleep-reset', 'Işıkları kıs', {
    id: 'atomic-dim-lights',
    color: EXPLORE_HUE.sleep,
    category: 'sleep',
    daypartLabel: 'Gece · 5 dk',
    life_area: 'Uyku',
    whyItWorks:
      'Akşam tavan ışıkları yerine daha loş ve sıcak bir aydınlatmaya geçmek, günün kapandığını hissetmeni kolaylaştırabilir.',
  }),

  // BEDEN & SAĞLIK
  fromPack('morning-reset', '10 dakika esneme / mobilite', {
    id: 'atomic-mobility-10',
    color: EXPLORE_HUE.health,
    category: 'health',
    daypartLabel: 'Sabah / Akşam · 12 dk',
    life_area: 'Sağlık',
    whyItWorks:
      'Masa başında biriken sırt, boyun ve kalça gerginliğini nazik hareketlerle yumuşatmana yardımcı olabilir.',
  }),
  fromPack('fitness-foundation', 'Adım hedefi', {
    id: 'atomic-steps-8000',
    color: EXPLORE_HUE.health,
    category: 'health',
    daypartLabel: 'Tüm Gün · 8000 adım',
    life_area: 'Sağlık',
    whyItWorks:
      'Gün içine yayılan düzenli yürüyüş adımları, uzun süre hareketsiz kalmayı kırıp enerjini tazeleyebilir.',
  }),
  fromPack('fitness-foundation', 'Su hedefi', {
    id: 'atomic-water-8-glasses',
    color: EXPLORE_HUE.health,
    category: 'health',
    daypartLabel: 'Tüm Gün · 8 bardak',
    life_area: 'Sağlık',
    whyItWorks:
      'Gün boyu su içmeyi küçük ve görünür bir hedefle takip etmek, yorgunluk ve dalgınlık hissini azaltmaya yardım edebilir.',
  }),

  // ZİHİN & SAKİNLİK
  fromPack('everyday-foundations', '5 dakika nefes egzersizi', {
    id: 'atomic-breath-5min',
    color: EXPLORE_HUE.mind,
    category: 'mind',
    daypartLabel: 'Sabah / Stres Anı · 5 dk',
    life_area: 'Zihin',
    whyItWorks:
      'Yavaş ve uzun nefes alışverişleriyle birkaç dakika durmak, yoğun anlarda bedensel gerginliği yatıştırmana destek olabilir.',
  }),
  fromPack('everyday-foundations', '10 dakika okuma', {
    id: 'atomic-reading-10min',
    color: EXPLORE_HUE.mind,
    category: 'mind',
    daypartLabel: 'Akşam · 10 dk',
    life_area: 'Gelişim',
    whyItWorks:
      'Günde yalnızca 10 dakika okumak, hızlı ekran temposundan çıkıp düşüncelerini yavaşlatmana yardımcı olabilir.',
  }),
  fromPack('sleep-reset', 'Uyumadan önce şükran notu', {
    id: 'atomic-gratitude-note',
    color: EXPLORE_HUE.mind,
    category: 'mind',
    daypartLabel: 'Gece · 5 dk',
    life_area: 'Zihin',
    whyItWorks:
      'Günü kapatırken iyi giden küçük bir ayrıntıyı not etmek, zihnini sakinleştirip uykuya hazırlayabilir.',
  }),

  // EV & EVRAK DÜZENİ
  fromPack('everyday-foundations', 'Evrakları tek yere topla', {
    id: 'atomic-paper-pile',
    color: EXPLORE_HUE.order,
    category: 'order',
    daypartLabel: 'Akşam · 5 dk',
    life_area: 'Yaşam Düzeni',
    whyItWorks:
      'Dağınık kağıtları, postaları ve belgeleri tek bir dosyada toplamak, biriken evrak stresini küçük adımlarla eritmene yardım edebilir.',
  }),
  fromPack('everyday-foundations', 'Çalışma alanını topla', {
    id: 'atomic-clear-desk',
    color: EXPLORE_HUE.order,
    category: 'order',
    daypartLabel: 'Akşam · 5 dk',
    life_area: 'Yaşam Düzeni',
    whyItWorks:
      'Akşam masanın üstünü birkaç dakikada toplamak, ertesi gün işe başlama sürtünmesini azaltabilir.',
  }),
  fromPack('deep-work', 'Gün sonu değerlendirme', {
    id: 'atomic-evening-review',
    color: EXPLORE_HUE.order,
    category: 'order',
    daypartLabel: 'Akşam · 5 dk',
    life_area: 'Yaşam Düzeni',
    whyItWorks:
      'Açık kalan işleri kağıda ya da sisteme boşaltmak, akşam zihninin dinlenmesini kolaylaştırabilir.',
  }),
];

export function buildAtomicHabitInsert(
  item: ExploreAtomicHabit,
  existingActiveHabits: Habit[],
): {
  insertPayload: Omit<Habit, 'id' | 'created_at' | 'user_id'>;
  assignedStatus: 'active' | 'waiting';
} {
  const inRangeHabits = habitsInRangeOn(existingActiveHabits, new Date());
  const currentPoints = inRangeHabits.reduce(
    (sum, h) =>
      sum +
      habitLoadPoints({
        difficulty: h.difficulty ?? 3,
        estimated_minutes: h.estimated_minutes ?? 15,
        frequency_config: h.frequency_config,
        impact_level: h.impact_level ?? null,
      }),
    0,
  );

  const assignedStatus: 'active' | 'waiting' = fitsCapacity({
    currentLoad: currentPoints,
    habit: {
      difficulty: item.difficulty,
      estimated_minutes: item.estimated_minutes,
      frequency_config: item.frequency_config,
      impact_level: 'medium',
    },
  })
    ? 'active'
    : 'waiting';

  // `habits_tracking_type_check` (supabase/live_schema.sql:2228) accepts
  // 'boolean' | 'numeric' | 'duration' | 'abstinence'; mirrors services/routineService.ts:77.
  const persistedTrackingType: 'boolean' | 'numeric' =
    item.tracking_type === 'numeric' ? 'numeric' : 'boolean';

  const willpowerCost = computeWillpowerCost({
    difficulty: item.difficulty,
    impact_level: 'medium',
    behavior_type: 'positive',
    tracking_type: persistedTrackingType,
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
      tracking_type: persistedTrackingType,
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
