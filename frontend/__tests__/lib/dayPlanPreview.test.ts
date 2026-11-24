/**
 * Faz F4 (PRODUCT-F4) — `lib/dayPlanPreview.ts` sözleşme ve kabul testleri:
 * - `REC-01`: `buildRecoveryFixture()` üzerinde sabit `16:00` randevu koruması, korunan iş,
 *   sığmayan/çakışan iş önerileri, eksik süre işareti, `P01` takvim ayrımı ve `loadAfter <= loadBefore`
 * - `REC-02`: Derin `Object.freeze` ile sıfır mutasyon, deterministik çıktı ve `0,5 L` kısmi log güvencesi (`P04`)
 * - `REC-04`: Başka cihazda güncelleme (`updated_at`, `title`, alışkanlık/log, `recovery_plan`),
 *   süre dolumu (`expired`) ve gün değişiminde (`day_changed`) `evaluatePreviewFreshness`
 * - `REC-05`: Gece yarısı / `04:00` sınırında tek geçerli `Ymd` garantisi, `0` veya eksik ölçümde
 *   uydurma değer üretmeme ve «Hiçbiri» (`protectedRef: null`) seçimi
 */

import { habitFingerprint, taskFingerprint } from '../../lib/coachActionsV2';
import { parseLocalDate } from '../../lib/date';
import {
  DEFAULT_PREVIEW_TTL_MINUTES,
  SHRINK_STEP_MINUTES,
  applyPreviewItemOverride,
  buildDayPlanPreview,
  deriveRemainingCapacityMinutes,
  evaluatePreviewFreshness,
  formatMinutesToHm,
  parseHmToMinutes,
  previewItemKey,
  recoveryPlanFingerprint,
  resolveEffectivePlanningDay,
  resolveTaskEstimate,
  type DayPlanAction,
  type DayPlanPreviewInput,
  type FixedPlanBlock,
} from '../../lib/dayPlanPreview';
import type { Habit, HabitLog, RecoveryPlan } from '../../lib/supabase';
import type { Task } from '../../lib/taskTypes';
import { buildRecoveryFixture } from '../helpers/playbookFixtures';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

function makeHeavyHabit(id: string, name: string, userId: string): Habit {
  return {
    id,
    user_id: userId,
    name,
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'duration',
    unit: 'dakika',
    daily_goal: 60,
    target_direction: 'at_least',
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status: 'active',
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 5,
    estimated_minutes: 90,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: 'work',
    end_condition: null,
    created_at: '2026-10-01T08:00:00.000Z',
  };
}

// ============================================================================
// REC-01 — Kanonik toparlanma senaryosu, sabit blok, çakışma ve yük farkı (P01 & P04)
// ============================================================================

describe('REC-01 — buildRecoveryFixture canonical recovery scenario, fixed blocks, and load delta', () => {
  it('(+) keeps 16:00 fixed appointment locked, preserves protected task, suggests shrink/tomorrow for overflow, and lowers daily load', () => {
    const fixture = buildRecoveryFixture();
    const nowLocalMinutes = parseHmToMinutes(fixture.nowLocalTime);
    expect(nowLocalMinutes).toBe(870);

    const preview = buildDayPlanPreview({
      userId: fixture.userId,
      localDayKey: fixture.localDayKey,
      nowLocalMinutes: nowLocalMinutes!,
      generatedAtIso: fixture.nowIso,
      protectedRef: { entity: 'task', id: 'task-rec-blocked' },
      fixedBlocks: fixture.fixedBlocks,
      tasks: fixture.tasks,
      habits: fixture.habits,
      todayLogs: fixture.todayLogs,
    });

    // 1. 16:00–17:00 sabit randevu kilitli kalır; ASLA changes veya unplacedItems içine girmez.
    expect(preview.lockedItems).toEqual([
      expect.objectContaining({
        kind: 'fixed_block',
        id: 'appt-fixed-1600',
        localDay: '2026-11-24',
        locked: true,
        timeBlock: { start: '16:00', end: '17:00' },
        reasonCode: 'fixed_appointment',
      }),
    ]);
    expect(preview.changes.some((c) => c.sourceRef.id === 'appt-fixed-1600')).toBe(false);
    expect(preview.unplacedItems.some((u) => u.sourceRef.id === 'appt-fixed-1600')).toBe(false);

    // 2. Korunan tek iş (`task-rec-blocked`, 45 dk) `protectedItems` içinde korunur.
    expect(preview.protectedItems).toHaveLength(1);
    expect(preview.protectedItems[0]).toMatchObject({
      sourceRef: {
        entity: 'task',
        id: 'task-rec-blocked',
        title: 'Sunum taslağını güncelle',
      },
      expectedVersion: '2026-11-24T06:30:00.000Z',
      expectedFingerprint: taskFingerprint(fixture.tasks[0]),
      conflictsWithFixedBlockId: null,
      reasonCode: 'protected_by_user',
      snapshot: {
        dueDate: '2026-11-24',
        timeBlock: { start: '15:00', end: '15:45' },
        estimatedMinutes: 45,
        estimateSource: 'user',
        isMissingEstimate: false,
      },
    });
    expect(preview.changes.some((c) => c.sourceRef.id === 'task-rec-blocked')).toBe(false);

    // 3. Süresi eksik görev açıkça işaretlenir (`isMissingEstimate: true`) ve 5 dk ilk adıma küçültülür.
    expect(preview.missingEstimateTaskIds).toEqual(['task-rec-unestimated']);
    const unestimatedChange = preview.changes.find(
      (c) => c.sourceRef.id === 'task-rec-unestimated',
    );
    expect(unestimatedChange).toBeDefined();
    expect(unestimatedChange).toMatchObject({
      action: 'shrink',
      reasonCode: 'shrunk_to_fit_capacity',
      before: {
        dueDate: '2026-11-24',
        estimatedMinutes: 15,
        estimateSource: 'default',
        isMissingEstimate: true,
      },
      after: {
        dueDate: '2026-11-24',
        estimatedMinutes: SHRINK_STEP_MINUTES,
        shrunkStepMinutes: SHRINK_STEP_MINUTES,
        preservesParentTask: true,
      },
    });

    // 4. Kalan kapasiteyi aşan gecikmiş görev yarına (`2026-11-25`) önerilir ve `unplacedItems` içinde raporlanır.
    const overdueChange = preview.changes.find(
      (c) => c.sourceRef.id === 'task-rec-overdue',
    );
    expect(overdueChange).toMatchObject({
      action: 'postpone_tomorrow',
      reasonCode: 'exceeds_remaining_capacity',
      before: {
        dueDate: '2026-11-21',
        estimatedMinutes: 10,
        estimateSource: 'user',
        isMissingEstimate: false,
      },
      after: {
        dueDate: '2026-11-25',
        estimatedMinutes: 10,
      },
    });
    expect(preview.unplacedItems.map((u) => u.sourceRef.id)).toContain('task-rec-overdue');

    // 5. P04: 0.5 / 1.5 L su alışkanlığı gerçek 1.0 L açığı korur, sahte 1.5 L uydurmaz.
    const waterChange = preview.changes.find((c) => c.sourceRef.id === 'habit-rec-water');
    expect(waterChange).toBeDefined();
    expect(waterChange?.before).toMatchObject({
      habitState: 'partial',
      loggedValue: 0.5,
      targetValue: 1.5,
      unit: 'L',
      deficitRemaining: 1,
    });
    expect(waterChange?.availableActions).toEqual(['keep', 'do_not_recover', 'skip_today']);

    // 6. Gerçek yük farkı (`loadAfter <= loadBefore` ve bu senaryoda `loadAfter < loadBefore`).
    expect(preview.loadAfter).toBeLessThan(preview.loadBefore);
    expect(preview.loadDelta).toBe(preview.loadAfter - preview.loadBefore);

    // 7. P01: Dış takvim bağlı değilken sahte saat bloğu uydurulmaz; bloksuz görevler ayrı raporlanır.
    expect(preview.capacitySummary.externalCalendarConnected).toBe(false);
    expect(preview.capacitySummary.fixedBlockedMinutes).toBe(60);
    expect(preview.capacitySummary.unblockedTaskIds).toEqual(['task-rec-unestimated']);
    expect(unestimatedChange?.after.timeBlock).toBeNull();
  });

  it('(+) detects direct time overlap with locked 16:00–17:00 fixed block and moves clashing task to tomorrow without touching the appointment', () => {
    const fixture = buildRecoveryFixture();
    const clashingTask: Task = {
      id: 'task-clash-1530',
      user_id: fixture.userId,
      title: 'Tedarikçi görüşme notlarını yaz',
      status: 'pending',
      priority: 'high',
      due_date: fixture.localDayKey,
      time_block_start: '15:30',
      time_block_end: '16:30',
      estimated_minutes: 60,
      list_type: 'this_week',
      completed: false,
      created_at: '2026-11-24T08:00:00.000Z',
      updated_at: '2026-11-24T08:00:00.000Z',
    };

    const preview = buildDayPlanPreview({
      userId: fixture.userId,
      localDayKey: fixture.localDayKey,
      nowLocalMinutes: parseHmToMinutes('14:30')!,
      generatedAtIso: fixture.nowIso,
      protectedRef: { entity: 'task', id: 'task-rec-blocked' },
      fixedBlocks: fixture.fixedBlocks,
      tasks: [...fixture.tasks, clashingTask],
      habits: fixture.habits,
      todayLogs: fixture.todayLogs,
      remainingCapacityMinutes: 180, // Bol kapasite olsa bile sabit randevu çakışması yakalanır!
    });

    const clashChange = preview.changes.find((c) => c.sourceRef.id === 'task-clash-1530');
    expect(clashChange).toMatchObject({
      action: 'postpone_tomorrow',
      reasonCode: 'conflicts_with_fixed_block',
      conflictingFixedBlockId: 'appt-fixed-1600',
      after: {
        dueDate: '2026-11-25',
      },
    });
    expect(clashChange?.displayReason).toContain('16:00–17:00');
    expect(preview.unplacedItems).toContainEqual(
      expect.objectContaining({
        sourceRef: expect.objectContaining({ id: 'task-clash-1530' }),
        reasonCode: 'conflicts_with_fixed_block',
        conflictingFixedBlockId: 'appt-fixed-1600',
      }),
    );
    expect(preview.lockedItems[0]).toMatchObject({
      id: 'appt-fixed-1600',
      timeBlock: { start: '16:00', end: '17:00' },
    });
  });

  it('(+) demonstrates band transition (asiri -> dengeli) when heavy overloaded day is replanned', () => {
    const fixture = buildRecoveryFixture();
    const heavyHabits = [
      ...fixture.habits,
      makeHeavyHabit('h-heavy-1', 'Derin araştırma bloğu', fixture.userId),
      makeHeavyHabit('h-heavy-2', 'Akşam egzersiz seansı', fixture.userId),
      makeHeavyHabit('h-heavy-3', 'Yabancı dil pratiği', fixture.userId),
      makeHeavyHabit('h-heavy-4', ' Teknik okuma seansı', fixture.userId),
    ];

    const preview = buildDayPlanPreview({
      userId: fixture.userId,
      localDayKey: fixture.localDayKey,
      nowLocalMinutes: parseHmToMinutes('15:00')!,
      generatedAtIso: fixture.nowIso,
      protectedRef: { entity: 'task', id: 'task-rec-blocked' },
      fixedBlocks: fixture.fixedBlocks,
      tasks: fixture.tasks,
      habits: heavyHabits,
      todayLogs: fixture.todayLogs,
      remainingCapacityMinutes: 45,
    });

    expect(preview.bandBefore).toBe('asiri');
    expect(preview.loadAfter).toBeLessThan(preview.loadBefore);
    expect(['dusuk', 'dengeli']).toContain(preview.bandAfter);

    // Kapasite 45 dk tamamen korunan işe gittiği için kısmi su kaydı `do_not_recover` önerilir.
    const waterChange = preview.changes.find((c) => c.sourceRef.id === 'habit-rec-water');
    expect(waterChange).toMatchObject({
      action: 'do_not_recover',
      reasonCode: 'recovery_declined_preserve_progress',
      before: {
        habitState: 'partial',
        loggedValue: 0.5,
        deficitRemaining: 1,
      },
      after: {
        habitState: 'partial',
        loggedValue: 0.5,
        deficitRemaining: 0,
        recoveryStrategy: 'skip',
      },
    });
  });
});

// ============================================================================
// REC-02 — Derin immutability (`Object.freeze`), determinizm ve kısmi log güvencesi
// ============================================================================

describe('REC-02 — pure non-mutating execution, itemOverrides, and partial log safety', () => {
  it('(+) never mutates deeply frozen inputs across preview generation and all itemOverrides transitions', () => {
    const fixture = buildRecoveryFixture();
    const plannedRecovery: RecoveryPlan = {
      id: 'rp-water-prev',
      user_id: fixture.userId,
      habit_id: 'habit-rec-water',
      source_log_id: 'log-old',
      source_date: '2026-11-23',
      target_date: fixture.localDayKey,
      deficit_type: 'numeric',
      deficit_value: 0.75,
      strategy: 'push_tomorrow',
      distributed_days: null,
      note: null,
      reminder_time: '18:00',
      status: 'planned',
      completed_at: null,
      created_at: '2026-11-23T21:00:00.000Z',
    };

    const frozenInput: DayPlanPreviewInput = deepFreeze({
      userId: fixture.userId,
      localDayKey: fixture.localDayKey,
      nowLocalMinutes: 870,
      generatedAtIso: fixture.nowIso,
      protectedRef: { entity: 'task' as const, id: 'task-rec-blocked' },
      fixedBlocks: fixture.fixedBlocks,
      tasks: fixture.tasks,
      habits: fixture.habits,
      todayLogs: fixture.todayLogs,
      recoveryPlans: [plannedRecovery],
      itemOverrides: { 'task-rec-overdue': 'keep' as const },
    });

    const beforeSerialized = JSON.stringify(frozenInput);

    const p1 = buildDayPlanPreview(frozenInput);
    const p2 = applyPreviewItemOverride(frozenInput, 'habit-rec-water', 'do_not_recover');
    const p3 = applyPreviewItemOverride(frozenInput, 'habit-rec-water', 'skip_today');
    const p4 = applyPreviewItemOverride(frozenInput, 'task-rec-unestimated', 'release_someday');
    const p5 = applyPreviewItemOverride(
      frozenInput,
      previewItemKey('recovery_plan', 'rp-water-prev'),
      'do_not_recover',
    );

    expect(JSON.stringify(frozenInput)).toBe(beforeSerialized);
    expect(frozenInput.todayLogs[0]).toMatchObject({
      id: 'log-rec-water-partial',
      state: 'partial',
      value: 0.5,
      is_completed: false,
    });

    // `do_not_recover` ve `skip_today` her iki durumda da mevcut 0.5 L kısmi kaydı korur, 1.5 L uydurmaz.
    const waterDoNotRecover = p2.changes.find((c) => c.sourceRef.id === 'habit-rec-water');
    expect(waterDoNotRecover?.after).toMatchObject({
      habitState: 'partial',
      loggedValue: 0.5,
      deficitRemaining: 0,
      recoveryStrategy: 'skip',
    });

    const waterSkipToday = p3.changes.find((c) => c.sourceRef.id === 'habit-rec-water');
    expect(waterSkipToday?.after).toMatchObject({
      habitState: 'partial',
      loggedValue: 0.5,
      deficitRemaining: 0,
    });

    // `release_someday` görevi silmeden Bir Gün listesine alır (`dueDate: null`, `listType: 'someday'`).
    const releasedTask = p4.changes.find((c) => c.sourceRef.id === 'task-rec-unestimated');
    expect(releasedTask?.after).toMatchObject({
      dueDate: null,
      listType: 'someday',
      preservesParentTask: true,
    });

    // `recovery_plan` için `do_not_recover` telafiyi sakin biçimde kapatır.
    const declinedPlan = p5.changes.find((c) => c.sourceRef.id === 'rp-water-prev');
    expect(declinedPlan).toMatchObject({
      action: 'do_not_recover',
      expectedFingerprint: recoveryPlanFingerprint(plannedRecovery),
      after: {
        deficitRemaining: 0,
        recoveryStrategy: 'skip',
      },
    });

    // Determinizm: girdi dizilerinin sırası ters çevrilse bile özdeş önizleme üretilir.
    const shuffledPreview = buildDayPlanPreview({
      ...frozenInput,
      tasks: [...frozenInput.tasks].reverse(),
      habits: [...frozenInput.habits].reverse(),
    });
    expect(shuffledPreview).toEqual(p1);
  });
});

// ============================================================================
// REC-04 — Tazelik, sürüm çatışması (`version_conflict`), `expired` ve `day_changed`
// ============================================================================

describe('REC-04 — evaluatePreviewFreshness staleness, version conflicts, and expiry', () => {
  it('(+) returns fresh=true when within TTL on the same localDayKey and entities are unchanged', () => {
    const fixture = buildRecoveryFixture();
    const preview = buildDayPlanPreview({
      userId: fixture.userId,
      localDayKey: fixture.localDayKey,
      nowLocalMinutes: 870,
      generatedAtIso: '2026-11-24T11:30:00.000Z',
      protectedRef: { entity: 'task', id: 'task-rec-blocked' },
      fixedBlocks: fixture.fixedBlocks,
      tasks: fixture.tasks,
      habits: fixture.habits,
      todayLogs: fixture.todayLogs,
    });

    expect(preview.expiresAtIso).toBe('2026-11-24T12:00:00.000Z');
    expect(DEFAULT_PREVIEW_TTL_MINUTES).toBe(30);

    const verdict = evaluatePreviewFreshness(preview, {
      nowIso: '2026-11-24T11:59:59.000Z',
      currentLocalDayKey: '2026-11-24',
      tasks: fixture.tasks,
      habits: fixture.habits,
      todayLogs: fixture.todayLogs,
    });

    expect(verdict).toEqual({
      fresh: true,
      staleItemIds: [],
      reason: null,
    });
  });

  it('(-) detects cross-device task updated_at / title edits, protected-item edits, habit/log updates, and expiry with exact staleItemIds', () => {
    const fixture = buildRecoveryFixture();
    const preview = buildDayPlanPreview({
      userId: fixture.userId,
      localDayKey: fixture.localDayKey,
      nowLocalMinutes: 870,
      generatedAtIso: '2026-11-24T11:30:00.000Z',
      protectedRef: { entity: 'task', id: 'task-rec-blocked' },
      fixedBlocks: fixture.fixedBlocks,
      tasks: fixture.tasks,
      habits: fixture.habits,
      todayLogs: fixture.todayLogs,
    });

    // 1. Başka cihazda `updated_at` değiştiğinde çatışan görev kimliği tam döner.
    const tasksUpdatedTimestamp = fixture.tasks.map((t) =>
      t.id === 'task-rec-overdue' ? { ...t, updated_at: '2026-11-24T11:45:00.000Z' } : t,
    );
    expect(
      evaluatePreviewFreshness(preview, {
        nowIso: '2026-11-24T11:46:00.000Z',
        currentLocalDayKey: '2026-11-24',
        tasks: tasksUpdatedTimestamp,
        habits: fixture.habits,
        todayLogs: fixture.todayLogs,
      }),
    ).toEqual({
      fresh: false,
      staleItemIds: ['task-rec-overdue'],
      reason: 'version_conflict',
    });

    // 2. Başka cihazda görev başlığı (`title`) değiştiğinde çatışan kimlik tam döner.
    const tasksUpdatedTitle = fixture.tasks.map((t) =>
      t.id === 'task-rec-unestimated' ? { ...t, title: 'Fatura ve fişleri muhasebeye gönder' } : t,
    );
    expect(
      evaluatePreviewFreshness(preview, {
        nowIso: '2026-11-24T11:46:00.000Z',
        currentLocalDayKey: '2026-11-24',
        tasks: tasksUpdatedTitle,
        habits: fixture.habits,
        todayLogs: fixture.todayLogs,
      }),
    ).toEqual({
      fresh: false,
      staleItemIds: ['task-rec-unestimated'],
      reason: 'version_conflict',
    });

    // 3. Korunan görev (`protectedItems`) ve alışkanlık hedefi aynı anda değiştiğinde her ikisi de döner.
    const protectedEditedTasks = fixture.tasks.map((t) =>
      t.id === 'task-rec-blocked' ? { ...t, completed: true, status: 'completed' as const } : t,
    );
    const editedHabits = fixture.habits.map((h) =>
      h.id === 'habit-rec-water' ? { ...h, daily_goal: 2.0 } : h,
    );
    expect(habitFingerprint(editedHabits[0])).not.toBe(habitFingerprint(fixture.habits[0]));
    expect(
      evaluatePreviewFreshness(preview, {
        nowIso: '2026-11-24T11:50:00.000Z',
        currentLocalDayKey: '2026-11-24',
        tasks: protectedEditedTasks,
        habits: editedHabits,
        todayLogs: fixture.todayLogs,
      }),
    ).toEqual({
      fresh: false,
      staleItemIds: ['task-rec-blocked', 'habit-rec-water'],
      reason: 'version_conflict',
    });

    // 4. Süre dolduğunda (`expired`) ve aynı anda bir görev başka cihazda güncellendiğinde:
    //    hem `reason: 'expired'` hem de çatışan `staleItemIds` tam olarak döner.
    expect(
      evaluatePreviewFreshness(preview, {
        nowIso: '2026-11-24T12:05:00.000Z',
        currentLocalDayKey: '2026-11-24',
        tasks: tasksUpdatedTitle,
        habits: fixture.habits,
        todayLogs: fixture.todayLogs,
      }),
    ).toEqual({
      fresh: false,
      staleItemIds: ['task-rec-unestimated'],
      reason: 'expired',
    });

    // 5. Yalnız yerel gün değiştiğinde (`day_changed`).
    expect(
      evaluatePreviewFreshness(preview, {
        nowIso: '2026-11-24T11:50:00.000Z',
        currentLocalDayKey: '2026-11-25',
        tasks: fixture.tasks,
        habits: fixture.habits,
        todayLogs: fixture.todayLogs,
      }),
    ).toEqual({
      fresh: false,
      staleItemIds: [],
      reason: 'day_changed',
    });
  });
});

// ============================================================================
// REC-05 — Gece yarısı / 04:00 sınırı, 0 veya eksik ölçüm ve «Hiçbiri» (`protectedRef: null`)
// ============================================================================

describe('REC-05 — 04:00 rollover single-day invariant, zero/missing measurements, and null protectedRef', () => {
  it('(+) ensures tasks cross midnight / 04:00 rollover onto a single valid Ymd and never duplicate across buckets', () => {
    const fixture = buildRecoveryFixture({ localDayKey: '2026-12-31' });

    // 2027-01-01 saat 02:30 Europe/Istanbul -> 04:00 sınırı öncesi, etkin kapanış günü 2026-12-31!
    const preRollover = resolveEffectivePlanningDay(
      new Date('2026-12-31T23:30:00.000Z'),
      'Europe/Istanbul',
    );
    expect(preRollover).toEqual({
      localDayKey: '2027-01-01',
      closingDayKey: '2026-12-31',
      effectiveDayKey: '2026-12-31',
      nowLocalMinutes: 150,
      isBeforeRollover: true,
    });

    // 2027-01-01 saat 04:05 Europe/Istanbul -> 04:00 sınırı sonrası, etkin gün 2027-01-01!
    const postRollover = resolveEffectivePlanningDay(
      new Date('2027-01-01T01:05:00.000Z'),
      'Europe/Istanbul',
    );
    expect(postRollover.effectiveDayKey).toBe('2027-01-01');
    expect(postRollover.isBeforeRollover).toBe(false);

    const preview = buildDayPlanPreview({
      userId: fixture.userId,
      localDayKey: preRollover.effectiveDayKey,
      nowLocalMinutes: preRollover.nowLocalMinutes,
      generatedAtIso: '2026-12-31T23:30:00.000Z',
      protectedRef: null, // Kullanıcı açıkça «Hiçbiri» seçti!
      fixedBlocks: fixture.fixedBlocks,
      tasks: fixture.tasks,
      habits: fixture.habits,
      todayLogs: fixture.todayLogs,
    });

    // «Hiçbiri» seçildiğinde protectedItems boştur ve tüm açık görevler değerlendirilir.
    expect(preview.protectedRef).toBeNull();
    expect(preview.protectedItems).toEqual([]);

    const taskChanges = preview.changes.filter((c) => c.sourceRef.entity === 'task');
    expect(taskChanges).toHaveLength(3);

    const seenEntityKeys = new Set<string>();
    for (const ch of preview.changes) {
      const entityKey = previewItemKey(ch.sourceRef.entity, ch.sourceRef.id);
      expect(seenEntityKeys.has(entityKey)).toBe(false);
      seenEntityKeys.add(entityKey);

      if (ch.sourceRef.entity === 'task') {
        // 02:30 kapanış penceresinde korunan iş yokken açık görevler tek bir geçerli Ymd'ye (`2027-01-01`) taşınır.
        expect(ch.action).toBe('postpone_tomorrow');
        expect(ch.after.dueDate).toBe('2027-01-01');
        expect(parseLocalDate(ch.after.dueDate!)).not.toBeNull();
      }
    }
  });

  it('(+) never fabricates values when loggedValue is 0, missing (null), or daily_goal is missing/zero', () => {
    const userId = 'u-zero-check';
    const dayKey = '2026-11-24';

    const zeroLoggedHabit: Habit = {
      ...buildRecoveryFixture().habits[0],
      id: 'habit-zero-logged',
      user_id: userId,
      name: 'Okuma süresi',
      tracking_type: 'duration',
      daily_goal: 30,
      unit: 'dakika',
    };

    const unloggedMeasurableHabit: Habit = {
      ...zeroLoggedHabit,
      id: 'habit-unlogged-measurable',
      name: 'Adım hedefi',
      tracking_type: 'numeric',
      daily_goal: 8000,
      unit: 'adım',
    };

    const missingGoalHabit: Habit = {
      ...zeroLoggedHabit,
      id: 'habit-missing-goal',
      name: 'Serbest su takibi',
      tracking_type: 'numeric',
      daily_goal: null,
      unit: 'L',
    };

    const zeroLog: HabitLog = {
      id: 'log-zero',
      habit_id: 'habit-zero-logged',
      user_id: userId,
      completed_at: dayKey,
      value: 0,
      is_completed: false,
      state: 'miss',
      xp: 0,
      created_at: '2026-11-24T12:00:00.000Z',
    };

    const preview = buildDayPlanPreview({
      userId,
      localDayKey: dayKey,
      nowLocalMinutes: 960,
      generatedAtIso: '2026-11-24T13:00:00.000Z',
      protectedRef: null,
      fixedBlocks: [],
      tasks: [],
      habits: [zeroLoggedHabit, unloggedMeasurableHabit, missingGoalHabit],
      todayLogs: [zeroLog],
      remainingCapacityMinutes: 0,
    });

    const zeroChange = preview.changes.find((c) => c.sourceRef.id === 'habit-zero-logged');
    expect(zeroChange?.before).toMatchObject({
      loggedValue: 0,
      targetValue: 30,
      deficitRemaining: 30,
    });
    expect(zeroChange?.after.loggedValue).toBe(0);

    const unloggedChange = preview.changes.find(
      (c) => c.sourceRef.id === 'habit-unlogged-measurable',
    );
    expect(unloggedChange?.before).toMatchObject({
      loggedValue: null,
      targetValue: 8000,
      deficitRemaining: 8000,
    });
    expect(unloggedChange?.after.loggedValue).toBeNull();

    const missingGoalChange = preview.changes.find(
      (c) => c.sourceRef.id === 'habit-missing-goal',
    );
    expect(missingGoalChange?.before).toMatchObject({
      loggedValue: null,
      targetValue: null,
      deficitRemaining: null,
    });
    expect(missingGoalChange?.after).toMatchObject({
      loggedValue: null,
      targetValue: null,
      deficitRemaining: 0,
    });
  });

  it('(+) validates time helpers, overlapping fixed-block subtraction, and resolveTaskEstimate re-export', () => {
    expect(parseHmToMinutes('00:00')).toBe(0);
    expect(parseHmToMinutes('14:30')).toBe(870);
    expect(parseHmToMinutes('16:00:00')).toBe(960);
    expect(parseHmToMinutes('24:00')).toBeNull();
    expect(parseHmToMinutes('12:60')).toBeNull();
    expect(parseHmToMinutes('')).toBeNull();
    expect(formatMinutesToHm(870)).toBe('14:30');

    const overlappingBlocks: readonly FixedPlanBlock[] = [
      {
        id: 'fb-1',
        title: 'Toplantı A',
        local_day: '2026-11-24',
        start_time: '16:00',
        end_time: '17:00',
        locked: true,
      },
      {
        id: 'fb-2',
        title: 'Toplantı B (örtüşen)',
        local_day: '2026-11-24',
        start_time: '16:30',
        end_time: '17:30',
        locked: true,
        source: 'external_busy',
      },
    ];

    const cap = deriveRemainingCapacityMinutes({
      localDayKey: '2026-11-24',
      nowLocalMinutes: 900, // 15:00 -> 21:00 arası 360 dk ham pencere
      fixedBlocks: overlappingBlocks,
    });
    // 16:00–17:30 birleşimi = 90 dk (çift düşüm yok: 120 dk değil!)
    expect(cap.fixedBlockedMinutes).toBe(90);
    expect(cap.unblockedWindowMinutes).toBe(270);
    expect(cap.externalCalendarConnected).toBe(true);

    const est = resolveTaskEstimate({ estimated_minutes: null, time_block_start: '10:00', time_block_end: '10:25' });
    expect(est).toMatchObject({
      minutes: 25,
      source: 'block',
      isMissingEstimate: false,
    });

    // Tüm eylem türlerinin geçerli kümede olduğu doğrulanır.
    const validActions: readonly DayPlanAction[] = [
      'keep',
      'shrink',
      'postpone_tomorrow',
      'release_someday',
      'skip_today',
      'do_not_recover',
    ];
    expect(validActions).toHaveLength(6);
  });
});
