/**
 * F23 — Thefor F-3 tek kaynak kuralları:
 *  1. `EXPLORE_ATOMIC_HABITS` tür sözlüğü kanoniktir (`'binary' | 'numeric'`, `'boolean'` yok).
 *  2. `buildAtomicHabitInsert` kapasite kararını sihirli `>= 86` yerine `lib/capacity.canActivate`'ten alır.
 *  3. Paketle aynı adlı her atomik alışkanlık ortak alanlarını `ROUTINE_PACKS`'ten türetir (sürüklenme yok).
 *  4. `finance` onboarding hedefi dekoratif değildir ve para sözcüğü taşımaz.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CAPACITY_CEILING_DEFAULT,
  HABIT_POINTS_SCALE,
  canActivate as fitsCapacity,
  habitLoadPoints,
} from '../../lib/capacity';
import {
  EXPLORE_ATOMIC_HABITS,
  buildAtomicHabitInsert,
} from '../../lib/exploreCatalog';
import { ROUTINE_PACKS } from '../../lib/routinePacks';
import type { Habit } from '../../lib/supabase';
import { stripComments } from '../helpers/sourceText';

const CATALOG_PATH = join(__dirname, '..', '..', 'lib', 'exploreCatalog.ts');

const MONEY =
  /(?<![\p{L}])(para|paran|parayı|harcama[\p{L}\p{N}_]*|bütçe[\p{L}\p{N}_]*|fatura[\p{L}\p{N}_]*|tasarruf[\p{L}\p{N}_]*|yatırım[\p{L}\p{N}_]*|borç[\p{L}\p{N}_]*|maaş[\p{L}\p{N}_]*|kredi[\p{L}\p{N}_]*|finans[\p{L}\p{N}_]*)(?![\p{L}])|₺/iu;

function activeHabitFixture(id: string, difficulty: number, minutes: number): Habit {
  return {
    id,
    user_id: 'u-test',
    name: `Alışkanlık ${id}`,
    icon: 'checkmark-circle-outline',
    color: '#10b981',
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 2,
    status: 'active',
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty,
    estimated_minutes: minutes,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-09-01T00:00:00.000Z',
  };
}

/**
 * `habitLoadPoints` formülünün analitik tersi (`difficulty=5`, `daily` => ağırlıklar 1.0):
 * `points = HABIT_POINTS_SCALE * ln(1 + m) / ln(91)` => `m = 91^(points / HABIT_POINTS_SCALE) - 1`.
 * İstenen toplam mevcut yükü 5 aktif alışkanlığa bölerek üretir.
 */
function habitsWithExactLoad(targetLoad: number): Habit[] {
  const count = 5;
  const perHabit = targetLoad / count;
  const baseMinutes = Math.pow(91, perHabit / HABIT_POINTS_SCALE) - 1;
  const firstFour = [0, 1, 2, 3].map((i) => activeHabitFixture(`load-${i}`, 5, baseMinutes));
  const sumFour = firstFour.reduce(
    (s, h) =>
      s +
      habitLoadPoints({
        difficulty: h.difficulty,
        estimated_minutes: h.estimated_minutes,
        frequency_config: h.frequency_config,
        impact_level: h.impact_level,
      }),
    0,
  );
  const rem = Math.max(0, targetLoad - sumFour);
  let fifthMinutes = Math.pow(91, rem / HABIT_POINTS_SCALE) - 1;
  let fifth = activeHabitFixture('load-4', 5, fifthMinutes);
  const totalWith = (h5: Habit) =>
    sumFour +
    habitLoadPoints({
      difficulty: h5.difficulty,
      estimated_minutes: h5.estimated_minutes,
      frequency_config: h5.frequency_config,
      impact_level: h5.impact_level,
    });
  if (totalWith(fifth) > targetLoad) {
    fifthMinutes = Math.max(0, fifthMinutes * (1 - 1e-12));
    fifth = activeHabitFixture('load-4', 5, fifthMinutes);
  }
  return [...firstFour, fifth];
}

describe('EXPLORE_ATOMIC_HABITS tür sözlüğü', () => {
  it('tüm öğeler kanonik binary veya numeric kullanır; hiçbiri boolean değildir', () => {
    expect(EXPLORE_ATOMIC_HABITS.length).toBeGreaterThanOrEqual(16);
    for (const item of EXPLORE_ATOMIC_HABITS) {
      expect(['binary', 'numeric']).toContain(item.tracking_type);
      expect(String(item.tracking_type)).not.toBe('boolean');
    }
  });

  it('buildAtomicHabitInsert ikili öğeyi DB şemasına uygun boolean (routineService.ts:77 ile aynı), sayısal öğeyi numeric yazar', () => {
    const binaryItem = EXPLORE_ATOMIC_HABITS.find((h) => h.tracking_type === 'binary');
    const numericItem = EXPLORE_ATOMIC_HABITS.find((h) => h.tracking_type === 'numeric');
    expect(binaryItem).toBeDefined();
    expect(numericItem).toBeDefined();

    // `supabase/live_schema.sql:2228` `habits_tracking_type_check` yalnız
    // ('boolean','numeric','duration','abstinence') kabul eder; kanonik katalog 'binary' taşır,
    // DB satırı `services/routineService.ts:77` ile birebir aynı şekilde 'boolean' olarak yazılır.
    const binRes = buildAtomicHabitInsert(binaryItem!, []);
    expect(binRes.insertPayload.tracking_type).toBe('boolean');

    const numRes = buildAtomicHabitInsert(numericItem!, []);
    expect(numRes.insertPayload.tracking_type).toBe('numeric');
  });
});

describe('buildAtomicHabitInsert kapasite tek kaynağı (fitsCapacity)', () => {
  it('kaynak metinde sihirli >= 86 eşiği kalmamıştır', () => {
    const code = stripComments(readFileSync(CATALOG_PATH, 'utf8'));
    expect(code).not.toContain('>= 86');
  });

  it('0..12 aktif alışkanlık aralığında her aday fitsCapacity ile birebir aynı kararı verir', () => {
    for (let n = 0; n <= 12; n += 2) {
      const existing = Array.from({ length: n }, (_, idx) =>
        activeHabitFixture(`h-${idx}`, idx % 2 === 0 ? 3 : 5, idx % 3 === 0 ? 15 : 40),
      );
      const currentLoad = existing.reduce(
        (sum, h) =>
          sum +
          habitLoadPoints({
            difficulty: h.difficulty,
            estimated_minutes: h.estimated_minutes,
            frequency_config: h.frequency_config,
            impact_level: h.impact_level,
          }),
        0,
      );

      for (const item of EXPLORE_ATOMIC_HABITS) {
        const { assignedStatus } = buildAtomicHabitInsert(item, existing);
        const expected = fitsCapacity({
          currentLoad,
          habit: {
            difficulty: item.difficulty,
            estimated_minutes: item.estimated_minutes,
            frequency_config: item.frequency_config,
            impact_level: 'medium',
          },
        })
          ? 'active'
          : 'waiting';
        expect(assignedStatus).toBe(expected);
      }
    }
  });

  it('sınır davranışı: tam CAPACITY_CEILING_DEFAULT iken active, tavanı 0.4 aşınca waiting döner', () => {
    const candidate = EXPLORE_ATOMIC_HABITS[0];
    const candidateLoad = habitLoadPoints({
      difficulty: candidate.difficulty,
      estimated_minutes: candidate.estimated_minutes,
      frequency_config: candidate.frequency_config,
      impact_level: 'medium',
    });

    const atCeilingHabits = habitsWithExactLoad(CAPACITY_CEILING_DEFAULT - candidateLoad);
    expect(buildAtomicHabitInsert(candidate, atCeilingHabits).assignedStatus).toBe('active');

    // 85.4 dar bandı: eski Math.round(...) >= 86 burada yanlışlıkla 'active' dönerdi.
    const overByPointFourHabits = habitsWithExactLoad(CAPACITY_CEILING_DEFAULT + 0.4 - candidateLoad);
    expect(buildAtomicHabitInsert(candidate, overByPointFourHabits).assignedStatus).toBe('waiting');
  });
});

describe('paket-katalog sürüklenme koruması ve finance hedefi', () => {
  it('paket alışkanlığıyla aynı adlı her atomik öğe ortak alanlarını ve packKey değerini paketten alır', () => {
    const packByHabitName = new Map<
      string,
      { packKey: string; habit: (typeof ROUTINE_PACKS)[number]['habits'][number] }
    >();
    for (const pack of ROUTINE_PACKS) {
      for (const h of pack.habits) {
        packByHabitName.set(h.name, { packKey: pack.key, habit: h });
      }
    }

    const matched = EXPLORE_ATOMIC_HABITS.filter((a) => packByHabitName.has(a.name));
    // Pozitif kontrol: boş döngü sahte yeşili engellenir.
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.some((a) => a.name === 'Bir bardak su iç')).toBe(true);

    for (const item of matched) {
      const ref = packByHabitName.get(item.name)!;
      expect(item.packKey).toBe(ref.packKey);
      expect(item.icon).toBe(ref.habit.icon);
      expect(item.difficulty).toBe(ref.habit.difficulty);
      expect(item.estimated_minutes).toBe(ref.habit.estimated_minutes);
      expect(item.tracking_type).toBe(ref.habit.tracking_type);
      expect(item.frequency_config).toEqual(ref.habit.frequency_config);
      expect(item.unit ?? null).toBe(ref.habit.unit ?? null);
      expect(item.daily_goal ?? null).toBe(ref.habit.daily_goal ?? null);
      expect(item.target_direction ?? null).toBe(ref.habit.target_direction ?? null);
    }
  });

  it('finance hedefini taşıyan en az bir paket alışkanlığı vardır ve para sözcüğü içermez', () => {
    const financeHabits = ROUTINE_PACKS.flatMap((p) => p.habits).filter((h) =>
      h.goals.includes('finance'),
    );
    expect(financeHabits.length).toBeGreaterThanOrEqual(1);
    for (const h of financeHabits) {
      expect(MONEY.test(h.name)).toBe(false);
    }
  });
});
