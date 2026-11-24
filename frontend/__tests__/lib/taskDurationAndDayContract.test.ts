/**
 * Faz F2 (PRODUCT) — E19, E04, E09, E10 saf domain sözleşme testleri:
 *   - `lib/taskDuration.ts` (E19: görev süre tahmini önceliği ve odak uzlaştırması)
 *   - `lib/dayBoundaryContract.ts` (E04: yerel gün, 04:00 Gün Kapanışı, Pazartesi XP haftası, DST ve seyahat)
 *   - `lib/capacityMetricsContract.ts` (E10: dört metriğin ayrışması ve tek düşüm; E09: alışkanlık undo etkisi)
 *   - `lib/habitSchedule.ts` + `lib/habitPauses.ts` + `lib/habitEngine.ts` (E09 kenar durumları)
 */
import { dailyLoad } from '../../lib/capacity';
import {
  CAPACITY_FRAMING_QUESTION,
  buildFocusPointsBalance,
  buildSeparatedCapacityView,
  buildWillpowerBudgetSnapshot,
  buildXpLedgerSummary,
  classifyCapacityEventImpact,
  describeHabitUndoImpact,
  explainLoadVsBudget,
} from '../../lib/capacityMetricsContract';
import { parseLocalDate, ymd } from '../../lib/date';
import {
  DAY_CLOSE_ROLLOVER_HOUR,
  buildDayBoundarySnapshot,
  inspectHistoricalLogAnchor,
  preserveHistoricalLogDay,
} from '../../lib/dayBoundaryContract';
import { DAY_ROLLOVER_HOUR } from '../../lib/dayClose';
import { adaptTrackingType, completionRatio, deriveState } from '../../lib/habitEngine';
import { attachTimeOff, pausedTarget, versionRowsForEdit, type PauseInterval } from '../../lib/habitPauses';
import {
  countsTowardAverage,
  isCountBasedSchedule,
  isEligibleOn,
  isMissedOn,
  periodStatus,
  scheduledCompletionRate,
  streakBroken,
} from '../../lib/habitSchedule';
import type { Habit, HabitLog } from '../../lib/supabase';
import {
  DEFAULT_TASK_ESTIMATE_MINUTES,
  MAX_TASK_ESTIMATE_MINUTES,
  MIN_TASK_ESTIMATE_MINUTES,
  computeTimeBlockDurationMinutes,
  describeEstimateSource,
  isValidTaskEstimateMinutes,
  reconcileFocusElapsedWithEstimate,
  resolveTaskDuration,
  toTaskLoadItem,
  type TaskDurationInput,
} from '../../lib/taskDuration';
import { buildRecoveryFixture, buildStartFixture } from '../helpers/playbookFixtures';

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-e09',
    user_id: 'user-1',
    name: 'E09 Test Alışkanlığı',
    icon: null,
    color: null,
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
    difficulty: 3,
    estimated_minutes: 20,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: 'health',
    end_condition: null,
    created_at: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeLog(
  completedAt: string,
  state: HabitLog['state'] = 'done',
  options?: { value?: number | null; xp?: number | null; habitId?: string },
): HabitLog {
  const habitId = options?.habitId ?? 'habit-e09';
  return {
    id: `${habitId}-${completedAt}`,
    habit_id: habitId,
    user_id: 'user-1',
    completed_at: completedAt,
    value: options?.value ?? null,
    is_completed: state === 'done',
    state,
    xp: options?.xp ?? (state === 'done' ? 30 : 0),
    created_at: `${completedAt}T09:00:00.000Z`,
  };
}

// ============================================================================
// 1. E19 — Görev süre tahmini önceliği ve odak oturumu uzlaştırması
// ============================================================================

describe('E19 — resolveTaskDuration priority and edge cases (lib/taskDuration.ts)', () => {
  it('prioritizes valid estimated_minutes (1..1440) over time_block_start/end', () => {
    const userTask: TaskDurationInput = {
      estimated_minutes: 25,
      time_block_start: '09:00',
      time_block_end: '10:30',
    };
    expect(resolveTaskDuration(userTask)).toEqual({
      minutes: 25,
      source: 'user',
      isMissingEstimate: false,
      label: 'Seçtiğin süre',
    });

    const aiTask: TaskDurationInput = {
      estimated_minutes: 40,
      estimate_source: 'ai',
      time_block_start: '14:00',
      time_block_end: '15:00',
    };
    expect(resolveTaskDuration(aiTask)).toEqual({
      minutes: 40,
      source: 'ai',
      isMissingEstimate: false,
      label: 'Önerilen süre',
    });
  });

  it('validates exact integer bounds 1..1440 for estimated_minutes', () => {
    expect(isValidTaskEstimateMinutes(MIN_TASK_ESTIMATE_MINUTES)).toBe(true);
    expect(isValidTaskEstimateMinutes(MAX_TASK_ESTIMATE_MINUTES)).toBe(true);
    expect(isValidTaskEstimateMinutes(0)).toBe(false);
    expect(isValidTaskEstimateMinutes(-15)).toBe(false);
    expect(isValidTaskEstimateMinutes(1441)).toBe(false);
    expect(isValidTaskEstimateMinutes(15.5)).toBe(false);
    expect(isValidTaskEstimateMinutes(Number.NaN)).toBe(false);
    expect(isValidTaskEstimateMinutes(null)).toBe(false);
  });

  it('falls back to valid time_block_start/end difference when estimated_minutes is missing', () => {
    const blockedTask: TaskDurationInput = {
      estimated_minutes: null,
      time_block_start: '14:15',
      time_block_end: '15:00',
    };
    expect(resolveTaskDuration(blockedTask, { allowDefault: false })).toEqual({
      minutes: 45,
      source: 'block',
      isMissingEstimate: false,
      label: 'Takvim bloğundan',
    });
    expect(computeTimeBlockDurationMinutes('09:00:00', '09:30:00')).toBe(30);
  });

  it('rejects malformed, equal, or reversed time blocks and falls back to default (15) or none (null)', () => {
    const invalidBlocks: TaskDurationInput[] = [
      { estimated_minutes: null, time_block_start: '15:00', time_block_end: '15:00' },
      { estimated_minutes: null, time_block_start: '16:00', time_block_end: '15:00' },
      { estimated_minutes: null, time_block_start: '24:00', time_block_end: '25:00' },
      { estimated_minutes: null, time_block_start: '12.30', time_block_end: '13.00' },
      { estimated_minutes: null, time_block_start: '09:00', time_block_end: null },
      { estimated_minutes: 0, time_block_start: '16:00', time_block_end: '15:30' },
    ];

    for (const item of invalidBlocks) {
      expect(resolveTaskDuration(item)).toEqual({
        minutes: DEFAULT_TASK_ESTIMATE_MINUTES,
        source: 'default',
        isMissingEstimate: true,
        label: 'Varsayılan tahmin (15 dk)',
      });
      expect(resolveTaskDuration(item, { allowDefault: false })).toEqual({
        minutes: null,
        source: 'none',
        isMissingEstimate: true,
        label: 'Tahmin yok',
      });
    }
  });

  it('maps every source to its exact Turkish user-facing label', () => {
    expect(describeEstimateSource('user')).toBe('Seçtiğin süre');
    expect(describeEstimateSource('ai')).toBe('Önerilen süre');
    expect(describeEstimateSource('block')).toBe('Takvim bloğundan');
    expect(describeEstimateSource('default')).toBe('Varsayılan tahmin (15 dk)');
    expect(describeEstimateSource('none')).toBe('Tahmin yok');
    expect(describeEstimateSource(null)).toBe('Tahmin yok');
  });

  it('integrates cleanly with canonical F0 playbook fixtures and dailyLoad', () => {
    const startFixture = buildStartFixture();
    const unestimated = startFixture.tasks[0];
    expect(resolveTaskDuration(unestimated, { allowDefault: false }).source).toBe('none');
    expect(toTaskLoadItem(unestimated)).toEqual({ estimated_minutes: 15 });

    const recFixture = buildRecoveryFixture();
    const blocked = recFixture.tasks.find((t) => t.id === 'task-rec-blocked')!;
    expect(resolveTaskDuration(blocked)).toMatchObject({
      minutes: 45,
      source: 'user',
      isMissingEstimate: false,
    });
  });

  it('never mutates task.estimated_minutes when reconciling actual focus elapsed time', () => {
    const frozenTask: TaskDurationInput = Object.freeze({
      estimated_minutes: 25,
      estimate_source: 'user',
      time_block_start: '10:00',
      time_block_end: '10:25',
    });

    const reconciled = reconcileFocusElapsedWithEstimate(frozenTask, 42);
    expect(frozenTask.estimated_minutes).toBe(25);
    expect(reconciled.autoMutated).toBe(false);
    expect(reconciled.preservedEstimatedMinutes).toBe(25);
    expect(reconciled.actualFocusMinutes).toBe(42);
    expect(reconciled.deltaMinutes).toBe(17);
    expect(reconciled.confirmationCandidate).toEqual({
      proposedMinutes: 42,
      proposedSource: 'user',
      requiresUserConfirmation: true,
    });
    expect(reconciled.summary).toContain('kendiliğinden değiştirilmedi');

    const exactMatch = reconcileFocusElapsedWithEstimate(frozenTask, 25);
    expect(exactMatch.deltaMinutes).toBe(0);
    expect(exactMatch.confirmationCandidate).toBeNull();
  });
});

// ============================================================================
// 2. E04 — Yerel gün, 04:00 Gün Kapanışı, Pazartesi XP haftası, DST ve seyahat
// ============================================================================

describe('E04 — buildDayBoundarySnapshot and preserveHistoricalLogDay (lib/dayBoundaryContract.ts)', () => {
  it('stays aligned with DAY_ROLLOVER_HOUR = 4 in lib/dayClose.ts', () => {
    expect(DAY_CLOSE_ROLLOVER_HOUR).toBe(DAY_ROLLOVER_HOUR);
  });

  it('resolves Europe/Istanbul midnight, Monday 00:30 XP week, and 03:30 vs 04:00 Day Close rollover', () => {
    // UTC 2026-11-22 21:30 -> Europe/Istanbul (UTC+3) Pazartesi 2026-11-23 00:30
    const istanbulMonday0030 = buildDayBoundarySnapshot(
      new Date('2026-11-22T21:30:00.000Z'),
      'Europe/Istanbul',
    );
    expect(istanbulMonday0030).toMatchObject({
      localDayKey: '2026-11-23',
      utcInstantIso: '2026-11-22T21:30:00.000Z',
      ianaZone: 'Europe/Istanbul',
      closingDayKey: '2026-11-22', // 00:30 < 04:00 -> Pazar'ı kapatır
      xpWeekMondayKey: '2026-11-23', // Yerel Pazartesi başladı -> yeni XP haftası
      localHour: 0,
      localMinute: 30,
      localTimeHm: '00:30',
      isBeforeDayCloseRollover: true,
      zoneResolution: 'explicit',
    });

    // Europe/Istanbul 2026-11-24 03:30 (UTC 00:30) -> hâlâ 2026-11-23 kapanışı
    const istanbul0330 = buildDayBoundarySnapshot(
      new Date('2026-11-24T00:30:00.000Z'),
      'Europe/Istanbul',
    );
    expect(istanbul0330.localDayKey).toBe('2026-11-24');
    expect(istanbul0330.closingDayKey).toBe('2026-11-23');
    expect(istanbul0330.localTimeHm).toBe('03:30');
    expect(istanbul0330.xpWeekMondayKey).toBe('2026-11-23');

    // Europe/Istanbul 2026-11-24 04:00 (UTC 01:00) -> artık 2026-11-24 günü
    const istanbul0400 = buildDayBoundarySnapshot(
      new Date('2026-11-24T01:00:00.000Z'),
      'Europe/Istanbul',
    );
    expect(istanbul0400.localDayKey).toBe('2026-11-24');
    expect(istanbul0400.closingDayKey).toBe('2026-11-24');
    expect(istanbul0400.isBeforeDayCloseRollover).toBe(false);
  });

  it('handles America/New_York spring-forward and fall-back DST transitions accurately', () => {
    // Spring forward: 2026-03-08 01:59 EST (06:59Z) -> 2 dk sonra 03:01 EDT (07:01Z)
    const beforeSpring = buildDayBoundarySnapshot(
      new Date('2026-03-08T06:59:00.000Z'),
      'America/New_York',
    );
    const afterSpring = buildDayBoundarySnapshot(
      new Date('2026-03-08T07:01:00.000Z'),
      'America/New_York',
    );
    const atFourEdt = buildDayBoundarySnapshot(
      new Date('2026-03-08T08:00:00.000Z'),
      'America/New_York',
    );

    expect(beforeSpring).toMatchObject({
      localDayKey: '2026-03-08',
      localTimeHm: '01:59',
      closingDayKey: '2026-03-07',
      xpWeekMondayKey: '2026-03-02', // Pazar -> aynı Pazartesi haftası
    });
    expect(afterSpring).toMatchObject({
      localDayKey: '2026-03-08',
      localTimeHm: '03:01',
      closingDayKey: '2026-03-07',
      xpWeekMondayKey: '2026-03-02',
    });
    expect(atFourEdt).toMatchObject({
      localDayKey: '2026-03-08',
      localTimeHm: '04:00',
      closingDayKey: '2026-03-08',
    });

    // Fall back: 2026-11-01 01:30 EDT (05:30Z) ve 01:30 EST (06:30Z) ikisi de aynı yerel günde kalır
    const first0130 = buildDayBoundarySnapshot(
      new Date('2026-11-01T05:30:00.000Z'),
      'America/New_York',
    );
    const repeated0130 = buildDayBoundarySnapshot(
      new Date('2026-11-01T06:30:00.000Z'),
      'America/New_York',
    );
    expect(first0130).toMatchObject({
      localDayKey: '2026-11-01',
      localTimeHm: '01:30',
      closingDayKey: '2026-10-31',
      xpWeekMondayKey: '2026-10-26',
    });
    expect(repeated0130).toMatchObject({
      localDayKey: '2026-11-01',
      localTimeHm: '01:30',
      closingDayKey: '2026-10-31',
      xpWeekMondayKey: '2026-10-26',
    });
  });

  it('resolves Pacific/Auckland (+13 NZDT) day and Monday boundaries ahead of UTC', () => {
    // UTC Pazar 2026-11-22 11:15 -> Auckland Pazartesi 2026-11-23 00:15 (NZDT, UTC+13)
    const aucklandMonday = buildDayBoundarySnapshot(
      new Date('2026-11-22T11:15:00.000Z'),
      'Pacific/Auckland',
    );
    expect(aucklandMonday).toMatchObject({
      localDayKey: '2026-11-23',
      localTimeHm: '00:15',
      closingDayKey: '2026-11-22',
      xpWeekMondayKey: '2026-11-23',
      ianaZone: 'Pacific/Auckland',
    });
  });

  it('falls back safely on invalid IANA names or invalid Date without ever throwing', () => {
    const fixedInstant = new Date('2026-11-24T02:15:00.000Z');

    const deviceFallback = buildDayBoundarySnapshot(fixedInstant, 'Mars/Phobos', {
      deviceZone: () => 'Europe/Istanbul',
    });
    expect(deviceFallback.zoneResolution).toBe('device_fallback');
    expect(deviceFallback.ianaZone).toBe('Europe/Istanbul');
    expect(deviceFallback.localTimeHm).toBe('05:15');

    const utcFallback = buildDayBoundarySnapshot(fixedInstant, 'Mars/Phobos', {
      deviceZone: () => null,
    });
    expect(utcFallback.zoneResolution).toBe('utc_fallback');
    expect(utcFallback.ianaZone).toBeNull();
    expect(utcFallback.localDayKey).toBe('2026-11-24');
    expect(utcFallback.localTimeHm).toBe('02:15');
    expect(utcFallback.closingDayKey).toBe('2026-11-23');

    const invalidDateSnap = buildDayBoundarySnapshot(new Date(Number.NaN), 'UTC');
    expect(invalidDateSnap.validInstant).toBe(false);
    expect(invalidDateSnap.utcInstantIso).toBe('1970-01-01T00:00:00.000Z');
  });

  it('guarantees historical completed_at day never shifts when travelling or syncing offline across zones', () => {
    const aucklandLog = { completed_at: '2026-11-24', tz: 'Pacific/Auckland' };
    const offlineLegacyLog = { completed_at: '2026-11-24', tz: null };

    for (const destinationZone of ['America/New_York', 'Pacific/Honolulu', 'Europe/Istanbul', 'UTC']) {
      expect(preserveHistoricalLogDay(aucklandLog, destinationZone)).toBe('2026-11-24');
      expect(preserveHistoricalLogDay(offlineLegacyLog, destinationZone)).toBe('2026-11-24');
    }

    const anchor = inspectHistoricalLogAnchor(aucklandLog, 'America/New_York');
    expect(anchor).toEqual({
      dayKey: '2026-11-24',
      recordedZone: 'Pacific/Auckland',
      viewingZone: 'America/New_York',
      zoneChangedSinceLog: true,
    });
    expect(preserveHistoricalLogDay({ completed_at: 'bozuk-tarih' }, 'UTC')).toBe('');
  });
});

// ============================================================================
// 3. E09 — Hedef sürümü (07:45 geçişi), ara verme, at_least/at_most, haftada 3 ve undo
// ============================================================================

describe('E09 — Goal versions, dated pauses, ceiling vs floor, weekly count, and undo impact', () => {
  it('preserves past days when habit_goal_versions changes at 07:45 local time', () => {
    // 2026-11-02 Pazartesi oluşturulan "haftada 3" alışkanlığı,
    // 2026-11-09 Pazartesi sabah 07:45 yerel saatte "her gün" (daily) olarak güncelleniyor.
    const editSnap = buildDayBoundarySnapshot(
      new Date('2026-11-09T04:45:00.000Z'), // 07:45 Europe/Istanbul
      'Europe/Istanbul',
    );
    expect(editSnap.localDayKey).toBe('2026-11-09');
    expect(editSnap.localTimeHm).toBe('07:45');

    const initialHabit = makeHabit({
      created_at: '2026-11-02T06:00:00.000Z',
      frequency_config: { kind: 'weekly', count: 3, created_day: '2026-11-02' },
    });

    const nextGoal = {
      frequency_config: { kind: 'daily' as const, created_day: '2026-11-02' },
      daily_goal: null,
      target_direction: null,
    };
    const versionRows = versionRowsForEdit(initialHabit, nextGoal, editSnap.localDayKey);
    expect(versionRows).toHaveLength(2);
    expect(versionRows[0].effective_from).toBe('2026-11-02');
    expect(versionRows[1].effective_from).toBe('2026-11-09');

    const updatedHabit = attachTimeOff(
      [{ ...initialHabit, ...nextGoal }],
      [],
      versionRows,
    )[0];

    // İlk hafta (2–8 Kasım): yalnız Salı, Perşembe, Pazar yapıldı (3/3 -> eski hedefle %100).
    // İkinci hafta (9–15 Kasım): her gün yapıldı (7/7 -> yeni hedefle %100).
    const logs: HabitLog[] = [
      makeLog('2026-11-03', 'done'),
      makeLog('2026-11-05', 'done'),
      makeLog('2026-11-08', 'done'),
      makeLog('2026-11-09', 'done'),
      makeLog('2026-11-10', 'done'),
      makeLog('2026-11-11', 'done'),
      makeLog('2026-11-12', 'done'),
      makeLog('2026-11-13', 'done'),
      makeLog('2026-11-14', 'done'),
      makeLog('2026-11-15', 'done'),
    ];

    const week1Rate = scheduledCompletionRate(updatedHabit, logs, {
      from: parseLocalDate('2026-11-02')!,
      to: parseLocalDate('2026-11-08')!,
    });
    expect(week1Rate).toEqual({ rate: 1, dueDays: 3, doneDays: 3 });

    const twoWeekRate = scheduledCompletionRate(updatedHabit, logs, {
      from: parseLocalDate('2026-11-02')!,
      to: parseLocalDate('2026-11-15')!,
    });
    expect(twoWeekRate).toEqual({ rate: 1, dueDays: 10, doneDays: 10 });
  });

  it('applies dated pause_intervals proportionally without corrupting active days or breaking streaks', () => {
    const pauses: PauseInterval[] = [
      {
        id: 'pause-1',
        habit_id: 'habit-e09',
        kind: 'pause',
        start_date: '2026-11-05', // Perşembe..Pazar (4 gün ara)
        end_date: '2026-11-08',
      },
    ];
    expect(pausedTarget(3, 7, 4)).toBe(2); // ceil(3 * 3 / 7) = 2

    const weekly3WithPause = attachTimeOff(
      [makeHabit({ frequency_config: { kind: 'weekly', count: 3 } })],
      pauses,
      [],
    )[0];

    const logs = [makeLog('2026-11-03', 'done'), makeLog('2026-11-04', 'done')];
    const sun = parseLocalDate('2026-11-08')!;
    const st = periodStatus(weekly3WithPause, logs, sun, { asOf: sun });
    expect(st.target).toBe(2);
    expect(st.counted).toBe(2);
    expect(st.status).toBe('satisfied');
    expect(streakBroken(weekly3WithPause, logs, parseLocalDate('2026-11-06')!)).toBe(false);
  });

  it('distinguishes at_least vs at_most and explicit 0 value vs missing log', () => {
    const ceilingHabit = makeHabit({
      behavior_type: 'negative',
      tracking_type: 'numeric',
      daily_goal: 2,
      target_direction: 'at_most',
    });
    const floorHabit = makeHabit({
      behavior_type: 'positive',
      tracking_type: 'numeric',
      daily_goal: 2,
      target_direction: 'at_least',
    });

    // `at_most`: 0 değeri en iyi tam başarıdır; eksik kayıt (`null`/`undefined`) ise başarı kanıtı değildir,
    // ancak negatif alışkanlıkta kayıtsız gün yanlışlıkla «kaçırıldı» da sayılmaz.
    const ceilingZeroState = deriveState({
      trackingType: adaptTrackingType(ceilingHabit),
      value: 0,
      target: 2,
      direction: 'at_most',
    });
    expect(ceilingZeroState).toBe('done');
    expect(
      completionRatio({
        trackingType: 'numeric',
        state: ceilingZeroState,
        value: 0,
        target: 2,
        direction: 'at_most',
      }),
    ).toBe(1);
    expect(
      deriveState({
        trackingType: 'numeric',
        value: null,
        target: 2,
        direction: 'at_most',
      }),
    ).toBe('miss');
    expect(isMissedOn(ceilingHabit, undefined)).toBe(false);
    expect(countsTowardAverage(ceilingHabit, undefined)).toBe(false);

    // `at_least`: 0 değeri hedefe ulaşmadı (`miss`); eksik kayıt da pozitif alışkanlıkta kaçırıldı sayılır.
    const floorZeroState = deriveState({
      trackingType: adaptTrackingType(floorHabit),
      value: 0,
      target: 2,
      direction: 'at_least',
    });
    expect(floorZeroState).toBe('miss');
    expect(
      completionRatio({
        trackingType: 'numeric',
        state: floorZeroState,
        value: 0,
        target: 2,
        direction: 'at_least',
      }),
    ).toBe(0);
    expect(isMissedOn(floorHabit, undefined)).toBe(true);
    expect(countsTowardAverage(floorHabit, undefined)).toBe(true);
  });

  it('keeps 4 empty days un-missed when a "3 a week" habit has 2 completions, and updates 2/3 -> 1/3 on undo without xp_drift', () => {
    const weekly3 = makeHabit({ frequency_config: { kind: 'weekly', count: 3 } });
    // Hafta: Pzt 2026-11-02 .. Paz 2026-11-08. Salı (03) ve Perşembe (05) tamamlandı;
    // Pzt (02), Çar (04), Cum (06), Cmt (07) boş (4 boş gün). Değerlendirme günü: Cumartesi (07).
    const sat = parseLocalDate('2026-11-07')!;
    const logsWithTwo = [
      makeLog('2026-11-03', 'done', { xp: 30 }),
      makeLog('2026-11-05', 'done', { xp: 30 }),
    ];

    expect(isCountBasedSchedule(weekly3)).toBe(true);
    const statusAtTwo = periodStatus(weekly3, logsWithTwo, sat, { asOf: sat });
    expect(statusAtTwo).toMatchObject({
      status: 'in_progress',
      target: 3,
      counted: 2,
      remaining: 1,
      reason: 'ok',
    });
    expect(streakBroken(weekly3, logsWithTwo, sat)).toBe(false);

    for (const emptyDay of ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-07']) {
      const d = parseLocalDate(emptyDay)!;
      expect(isEligibleOn(weekly3, d)).toBe(true);
      expect(periodStatus(weekly3, logsWithTwo, d, { asOf: sat }).status).toBe('in_progress');
    }

    // Perşembe (2026-11-05) kaydı Cuma (2026-11-06) günü geri alınıyor (undo): 2/3 -> 1/3
    const fri = parseLocalDate('2026-11-06')!;
    const undo = describeHabitUndoImpact({
      habit: weekly3,
      logsBeforeUndo: logsWithTwo,
      undoneDay: '2026-11-05',
      asOf: fri,
      xpBefore: { totalXp: 160, purgedXp: 100 },
    });

    expect(undo.logRemovedForDay).toBe(true);
    expect(undo.isCountSchedule).toBe(true);
    expect(undo.periodBefore.counted).toBe(2);
    expect(undo.periodAfter.counted).toBe(1);
    expect(undo.periodAfter.target).toBe(3);
    expect(undo.periodAfter.status).toBe('in_progress');
    expect(undo.otherEmptyDaysMarkedMissed).toBe(false);
    expect(undo.streakBrokenAfterUndo).toBe(false); // Cuma..Pazar 3 gün var, kalan hedef 2 -> hâlâ yetişir
    expect(ymd(undo.periodAfter.periodStart)).toBe('2026-11-02');
    expect(undo.xpAccounting).toEqual({
      removedLogXp: 30,
      reclassifiedToPurgedXp: 30,
      activeLogsXpBefore: 60,
      activeLogsXpAfter: 30,
      purgedXpBefore: 100,
      purgedXpAfter: 130,
      totalXpBefore: 160,
      totalXpAfter: 160,
      xpDriftDelta: 0,
      producesXpDrift: false,
    });
    expect(undo.periodNote).toContain('2/3 yerine 1/3');
    expect(undo.xpLedgerNote).toContain('xp_drift oluşmaz');
  });
});

// ============================================================================
// 4. E10 — Dört metriğin ayrışması ve gizli çift düşümün önlenmesi
// ============================================================================

describe('E10 — SeparatedCapacityView, single-deduction guarantee, and non-clinical framing', () => {
  it('keeps dailyLoad (0..100), willpowerBudget, xpLedger, and focusPoints orthogonal', () => {
    const load = dailyLoad({
      habits: [{ difficulty: 3, estimated_minutes: 20, frequency_config: { kind: 'daily' }, impact_level: 'medium' }],
      tasks: [{ estimated_minutes: 30 }],
      focusMinutes: 25,
      overdueCount: 0,
    });
    const budget = buildWillpowerBudgetSnapshot({
      state_date: '2026-11-24',
      used: 4,
      daily_budget: 10,
      active_count: 2,
      focus_capacity: 3,
    });
    const xp = buildXpLedgerSummary({
      totalXp: 450,
      activeLogsXp: 390,
      purgedXp: 60,
      weeklyXp: 120,
      level: 5,
    });
    const fp = buildFocusPointsBalance({
      balance: 18,
      updatedAtIso: '2026-11-24T09:00:00.000Z',
    });

    const view = buildSeparatedCapacityView({
      load,
      willpowerBudget: budget,
      xpLedger: xp,
      focusPoints: fp,
    });

    expect(view.dailyLoad.kind).toBe('daily_load');
    expect(view.dailyLoad.result.normalised).toBeGreaterThan(0);
    expect(view.willpowerBudget).toMatchObject({ kind: 'willpower_budget', used: 4, remaining: 6 });
    expect(view.xpLedger).toMatchObject({ kind: 'xp_ledger', totalXp: 450, driftFree: true });
    expect(view.focusPoints).toMatchObject({ kind: 'focus_points', balance: 18 });
  });

  it('never secretly double-deducts across willpowerBudget, dailyLoad, xpLedger, and focusPoints', () => {
    const taskEffect = classifyCapacityEventImpact({
      type: 'task_planned',
      estimatedMinutes: 30,
    });
    expect(taskEffect).toEqual({
      eventType: 'task_planned',
      recomputesDailyLoad: true,
      willpowerBudgetDelta: 0,
      xpLedgerDelta: 0,
      focusPointsDelta: 0,
      touchedAxes: ['daily_load'],
      singleSpendDeduction: true,
    });

    const focusEffect = classifyCapacityEventImpact({
      type: 'focus_session_logged',
      focusMinutes: 25,
    });
    expect(focusEffect.willpowerBudgetDelta).toBe(0);
    expect(focusEffect.xpLedgerDelta).toBe(0);
    expect(focusEffect.focusPointsDelta).toBe(0);

    const activateEffect = classifyCapacityEventImpact({
      type: 'habit_activated',
      willpowerCost: 3,
      projectedLoadPoints: 11,
    });
    expect(activateEffect).toEqual({
      eventType: 'habit_activated',
      recomputesDailyLoad: true,
      willpowerBudgetDelta: -3,
      xpLedgerDelta: 0,
      focusPointsDelta: 0,
      touchedAxes: ['willpower_budget', 'daily_load'],
      singleSpendDeduction: true,
    });

    const logEffect = classifyCapacityEventImpact({
      type: 'habit_logged',
      awardedXp: 30,
    });
    expect(logEffect.willpowerBudgetDelta).toBe(0);
    expect(logEffect.xpLedgerDelta).toBe(30);
    expect(logEffect.focusPointsDelta).toBe(0);

    const coachEffect = classifyCapacityEventImpact({
      type: 'coach_credits_spent',
      credits: 2,
    });
    expect(coachEffect.recomputesDailyLoad).toBe(false);
    expect(coachEffect.willpowerBudgetDelta).toBe(0);
    expect(coachEffect.xpLedgerDelta).toBe(0);
    expect(coachEffect.focusPointsDelta).toBe(-2);
  });

  it('frames explainLoadVsBudget around "Bugün ne kadarı sığar?" without clinical or medical score language', () => {
    const explanation = explainLoadVsBudget({
      dailyLoad: { raw: 62, normalised: 62, band: 'dengeli' },
      willpowerBudget: { used: 4, dailyBudget: 10, remaining: 6 },
    });

    expect(explanation.framingQuestion).toBe(CAPACITY_FRAMING_QUESTION);
    expect(explanation.loadHeadline).toContain('Bugün ne kadarı sığar?');
    expect(explanation.guidance).toBe('fits_comfortably');

    const combinedText = [
      explanation.loadHeadline,
      explanation.loadSummary,
      explanation.budgetSummary,
      explanation.separationSummary,
    ]
      .join(' ')
      .toLocaleLowerCase('tr-TR');

    for (const forbiddenTerm of [
      'klinik',
      'sağlık puanı',
      'teşhis',
      'tanı',
      'tedavi',
      'biyometrik',
      'nörolojik',
      'hasta',
    ]) {
      expect(combinedText).not.toContain(forbiddenTerm);
    }
  });
});
