/**
 * F3 (Dalga 2A) — E01 (`ActionSuggestion` sözleşmesi) ve P03 (hazır paketlerden tek ilk adım) testleri.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  ACTION_SUGGESTION_POLICY_VERSION,
  SHRINK_MINUTE_STEPS,
  cycleAlternativeSuggestion,
  deterministicSuggestionId,
  evaluateActionSuggestion,
  forSuggestionSurface,
  resolveTaskEstimate,
  shrinkActionSuggestion,
  suggestionToSmallStep,
  type ActionSuggestion,
  type EvaluateSuggestionInput,
} from '../../lib/actionSuggestion';
import {
  DEFAULT_STARTER_PACK_KEY,
  ROUTINE_PACKS,
  STARTER_QUICK_PACK_KEYS,
  listStarterQuickSteps,
  pickStarterQuickStep,
} from '../../lib/routinePacks';
import { FOCUS_PAUSE_YIELD_MS, FOCUS_STALE_MS } from '../../lib/todayNext';
import { buildRecoveryFixture, buildStartFixture } from '../helpers/playbookFixtures';
import { stripComments } from '../helpers/sourceText';

const LIB_DIR = join(__dirname, '..', '..', 'lib');
const DAY = '2026-11-24';
const USER_ID = 'user-f3-test';

const CLINICAL_TERMS_RE =
  /\b(adhd|dehb|terapi|klinik|tanı|tani|teşhis|teshis|semptom|nöro|noro|dopamin|bozukluk|hastalık|hastalik|tedavi|psikiyatri)\b/i;

describe('Saf domain modülü sınırları (purity & zero I/O)', () => {
  function runtimeImportGraph(entry: string): string[] {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const raw = stripComments(readFileSync(current, 'utf8')).replace(
        /import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g,
        '',
      );
      const importRe = /from\s+['"](\.[^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRe.exec(raw)) !== null) {
        const base = resolve(dirname(current), match[1]);
        const found = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((p) =>
          existsSync(p),
        );
        if (found) stack.push(found);
      }
    }
    return [...seen];
  }

  it('actionSuggestion.ts hiçbir I/O, Supabase istemcisi, Zustand store veya rastgele/saat çağrısı içermez', () => {
    const entryFile = join(LIB_DIR, 'actionSuggestion.ts');
    const graph = runtimeImportGraph(entryFile);
    expect(graph.length).toBeGreaterThanOrEqual(4);

    const forbiddenModules = ['supabase.ts', 'aiInvoke.ts', 'edgeCall.ts', 'Store.ts'];
    const offenders = graph.filter((filePath) =>
      forbiddenModules.some((bad) => filePath.endsWith(bad)),
    );
    expect(offenders).toEqual([]);

    const ownCode = stripComments(readFileSync(entryFile, 'utf8'));
    for (const call of ['Date.now(', 'new Date(', 'Math.random(', 'crypto.randomUUID(', 'fetch(']) {
      expect(ownCode.includes(call)).toBe(false);
    }
  });
});

describe('E01 Kabul Testi — Bugün, Odak girişi ve Coach onayında deterministik suggestionId', () => {
  it('aynı aday için Bugün, Odak girişi ve Coach onayında birebir aynı suggestionId ve completesParentOnFinish === false üretir', () => {
    const fixture = buildStartFixture({ localDayKey: DAY, userId: USER_ID });
    const baseInput: EvaluateSuggestionInput = {
      localDayKey: fixture.localDayKey,
      userId: fixture.userId,
      tasks: fixture.tasks,
      habits: fixture.habits,
    };

    const todaySuggestion = evaluateActionSuggestion({ ...baseInput, surface: 'today' });
    const focusSuggestion = evaluateActionSuggestion({ ...baseInput, surface: 'focus_entry' });
    const coachSuggestion = evaluateActionSuggestion({ ...baseInput, surface: 'coach' });
    const adaptedCoach = forSuggestionSurface(todaySuggestion, 'coach');

    const directId = deterministicSuggestionId({
      userId: fixture.userId,
      localDayKey: fixture.localDayKey,
      kind: todaySuggestion.kind,
      sourceEntity: todaySuggestion.sourceRef.entity,
      sourceId: todaySuggestion.sourceRef.id,
      stepTitle: todaySuggestion.firstStepTitle,
    });

    expect(todaySuggestion.suggestionId).toBe(directId);
    expect(focusSuggestion.suggestionId).toBe(todaySuggestion.suggestionId);
    expect(coachSuggestion.suggestionId).toBe(todaySuggestion.suggestionId);
    expect(adaptedCoach.suggestionId).toBe(todaySuggestion.suggestionId);

    expect(todaySuggestion.policyVersion).toBe(ACTION_SUGGESTION_POLICY_VERSION);
    expect(todaySuggestion.completesParentOnFinish).toBe(false);
    expect(focusSuggestion.completesParentOnFinish).toBe(false);
    expect(coachSuggestion.completesParentOnFinish).toBe(false);
    expect(adaptedCoach.completesParentOnFinish).toBe(false);

    expect(todaySuggestion.requiresConfirmation).toBe(false);
    expect(focusSuggestion.requiresConfirmation).toBe(false);
    expect(coachSuggestion.requiresConfirmation).toBe(true);
    expect(adaptedCoach.requiresConfirmation).toBe(true);

    const smallStep = suggestionToSmallStep(focusSuggestion);
    expect(smallStep).toEqual({
      title: 'Gerekenleri tek bir yere topla — Teklifi hazırla',
      minutes: 15,
      parent: {
        kind: 'task',
        id: 'task-start-proposal',
        title: 'Teklifi hazırla',
      },
    });
  });

  it('farklı gün, kullanıcı, kaynak veya adım başlığında ayrık suggestionId üretir ve ayraç çakışmasına izin vermez', () => {
    const a = deterministicSuggestionId({
      userId: 'u1',
      localDayKey: DAY,
      kind: 'task',
      sourceEntity: 'task',
      sourceId: 'ab|c',
      stepTitle: 'd',
    });
    const b = deterministicSuggestionId({
      userId: 'u1',
      localDayKey: DAY,
      kind: 'task',
      sourceEntity: 'task',
      sourceId: 'ab',
      stepTitle: 'c|d',
    });
    const nextDay = deterministicSuggestionId({
      userId: 'u1',
      localDayKey: '2026-11-25',
      kind: 'task',
      sourceEntity: 'task',
      sourceId: 'ab|c',
      stepTitle: 'd',
    });

    expect(a).not.toBe(b);
    expect(a).not.toBe(nextDay);
  });
});

describe('LEAF-01 — Boş hesapta yardımsız ilk adım üretimi', () => {
  it('görev, alışkanlık ve açık oturum yokken routinePacks içinden 5 dakikalık somut başlangıç adımı döner', () => {
    const suggestion = evaluateActionSuggestion({
      localDayKey: DAY,
      userId: USER_ID,
      tasks: [],
      habits: [],
    });

    expect(suggestion.kind).toBe('start_small');
    expect(suggestion.reasonCode).toBe('starter_sample');
    expect(suggestion.sourceRef).toEqual({
      entity: 'starter_pack',
      id: DEFAULT_STARTER_PACK_KEY,
      parentTitle: 'Günlük Temeller',
    });
    expect(suggestion.estimate).toEqual({
      source: 'default',
      minutes: 5,
      rangeMin: 2,
      rangeMax: 5,
      isMissingEstimate: false,
    });
    expect(suggestion.firstStepTitle.length).toBeGreaterThan(10);
    expect(suggestion.completesParentOnFinish).toBe(false);
    expect(suggestion.displayReason).not.toMatch(CLINICAL_TERMS_RE);
  });
});

describe('LEAF-06 — todayNext öncelik sırası, uzun duraklama (yielded) ve sakin gecikmiş seçimi', () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60_000;

  it('7 seviyeli öncelik sırasını yukarıdan aşağıya eksiksiz korur', () => {
    const full: EvaluateSuggestionInput = {
      localDayKey: DAY,
      userId: USER_ID,
      focus: { id: 'f1', status: 'running', title: 'Rapor taslağı', remainingMinutes: 18 },
      routine: { id: 'rt1', status: 'running', templateName: 'Sabah', done: 1, total: 4 },
      recoveryToday: [{ id: 'rec1', habitName: 'Koşu', estimatedMinutes: 10 }],
      overdueTasks: [{ id: 't-ov', title: 'Faturayı öde', estimated_minutes: 10 }],
      habitsToDo: [{ id: 'h1', name: 'Kitap oku', estimated_minutes: 10 }],
      tasksToday: [{ id: 't-td', title: 'Müşteriyi ara', estimated_minutes: 15 }],
    };

    const steps: ((s: EvaluateSuggestionInput) => EvaluateSuggestionInput)[] = [
      (s) => ({ ...s, focus: { status: 'idle' } }),
      (s) => ({ ...s, routine: { status: 'finished', templateName: 'Sabah', done: 4, total: 4 } }),
      (s) => ({ ...s, recoveryToday: [] }),
      (s) => ({ ...s, overdueTasks: [] }),
      (s) => ({ ...s, habitsToDo: [] }),
      (s) => ({ ...s, tasksToday: [] }),
    ];

    const observed: string[] = [];
    let current = full;
    for (const peel of steps) {
      const res = evaluateActionSuggestion(current);
      observed.push(`${res.kind}:${res.reasonCode}:${res.sourceRef.id}`);
      expect(res.completesParentOnFinish).toBe(false);
      current = peel(current);
    }
    const emptyRes = evaluateActionSuggestion(current);
    observed.push(`${emptyRes.kind}:${emptyRes.reasonCode}:${emptyRes.sourceRef.id}`);

    expect(observed).toEqual([
      'resume_focus:active_focus:f1',
      'resume_routine:active_routine:rt1',
      'recovery:planned_recovery:rec1',
      'task:overdue_priority:t-ov',
      'habit:due_habit:h1',
      'task:due_task:t-td',
      `start_small:starter_sample:${DEFAULT_STARTER_PACK_KEY}`,
    ]);
  });

  it('30 dakikadan uzun duraklatılmış veya 12 saatten eski odak oturumu sırayı bırakır; kuyruk boşsa yielded_focus olarak döner', () => {
    const paused31m: EvaluateSuggestionInput = {
      localDayKey: DAY,
      userId: USER_ID,
      nowMs: NOW,
      focus: {
        id: 'focus-paused-long',
        status: 'paused',
        title: 'Sunum hazırlığı',
        pausedAt: NOW - (FOCUS_PAUSE_YIELD_MS + MIN),
        startedAtIso: new Date(NOW - 50 * MIN).toISOString(),
      },
      habitsToDo: [{ id: 'h1', name: 'Su iç', estimated_minutes: 2 }],
    };

    const yieldedToHabit = evaluateActionSuggestion(paused31m);
    expect(yieldedToHabit.kind).toBe('habit');
    expect(yieldedToHabit.reasonCode).toBe('due_habit');

    const pausedExact30m: EvaluateSuggestionInput = {
      ...paused31m,
      focus: {
        ...paused31m.focus!,
        pausedAt: NOW - FOCUS_PAUSE_YIELD_MS,
      },
    };
    expect(evaluateActionSuggestion(pausedExact30m).reasonCode).toBe('active_focus');

    const staleWithEmptyQueue = evaluateActionSuggestion({
      localDayKey: DAY,
      userId: USER_ID,
      nowMs: NOW,
      focus: {
        id: 'focus-stale',
        status: 'paused',
        title: 'Eski oturum',
        pausedAt: NOW - 5 * MIN,
        startedAtIso: new Date(NOW - FOCUS_STALE_MS - MIN).toISOString(),
      },
      tasks: [],
      habits: [],
    });
    expect(staleWithEmptyQueue.kind).toBe('resume_focus');
    expect(staleWithEmptyQueue.reasonCode).toBe('yielded_focus');
    expect(staleWithEmptyQueue.sourceRef.id).toBe('focus-stale');
  });

  it('OVERDUE_CALM_LIMIT (> 5) aşıldığında alışkanlık ve bugünkü görevi öne alır, gecikmişlerden en kısa süreli işi seçer', () => {
    const sixOverdue = Array.from({ length: 6 }, (_, idx) => ({
      id: `ov-${idx + 1}`,
      title: `Gecikmiş rapor ${idx + 1} yaz`,
      estimated_minutes: idx === 3 ? 5 : 25,
    }));

    const withHabitAndToday = evaluateActionSuggestion({
      localDayKey: DAY,
      overdueTasks: sixOverdue,
      habitsToDo: [{ id: 'h-calm', name: 'Yürüyüş' }],
      tasksToday: [{ id: 't-today', title: 'Notları düzenle' }],
    });
    expect(withHabitAndToday.kind).toBe('habit');
    expect(withHabitAndToday.sourceRef.id).toBe('h-calm');

    const onlyOverduePile = evaluateActionSuggestion({
      localDayKey: DAY,
      overdueTasks: sixOverdue,
    });
    expect(onlyOverduePile.kind).toBe('task');
    expect(onlyOverduePile.reasonCode).toBe('overdue_calm_pick');
    expect(onlyOverduePile.sourceRef.id).toBe('ov-4');
    expect(onlyOverduePile.estimate.minutes).toBe(5);
  });
});

describe('Süre kaynağı çözümü, mikro adım ayrıştırma ve şeffaf / tıbbi olmayan displayReason', () => {
  it('eksik sürede 15 dk varsayımı açıklar, düşük enerji ve yüksek yükte sade ve tıbbi olmayan dil kullanır', () => {
    const suggestion = evaluateActionSuggestion({
      localDayKey: DAY,
      userId: USER_ID,
      energyLevel: 'low',
      loadState: { currentLoad: 82, ceiling: 70 },
      tasksToday: [
        {
          id: 't-unestimated',
          title: 'Teklifi hazırla',
          estimated_minutes: null,
          updated_at: '2026-11-24T08:00:00.000Z',
        },
      ],
    });

    expect(suggestion.kind).toBe('task');
    expect(suggestion.firstStepTitle).toBe('Gerekenleri tek bir yere topla — Teklifi hazırla');
    expect(suggestion.expectedVersion).toBe('2026-11-24T08:00:00.000Z');
    expect(suggestion.estimate).toEqual({
      source: 'default',
      minutes: 15,
      rangeMin: 5,
      rangeMax: 15,
      isMissingEstimate: true,
    });
    expect(suggestion.displayReason).toContain('15 dk varsayılan süre alındı');
    expect(suggestion.displayReason).toContain('düşük enerji');
    expect(suggestion.displayReason).toContain('yoğun günlük yük');
    expect(suggestion.displayReason).not.toMatch(CLINICAL_TERMS_RE);
  });

  it('takvim bloğu süresini ve toparlanma fixture verisini doğru çözümler', () => {
    const blockResolved = resolveTaskEstimate({
      estimated_minutes: null,
      time_block_start: '15:00',
      time_block_end: '15:45',
    });
    expect(blockResolved.minutes).toBe(45);
    expect(blockResolved.source).toBe('block');

    const blockSuggestion = evaluateActionSuggestion({
      localDayKey: DAY,
      tasksToday: [
        {
          id: 't-block',
          title: 'Sunum taslağını hazırla',
          estimated_minutes: null,
          time_block_start: '15:00',
          time_block_end: '15:45',
        },
      ],
    });
    expect(blockSuggestion.estimate).toEqual({
      source: 'block',
      minutes: 45,
      isMissingEstimate: false,
    });
    expect(blockSuggestion.displayReason).toContain('takvim bloğundan 45 dk');

    const recoveryFixture = buildRecoveryFixture({ localDayKey: DAY, userId: USER_ID });
    const fromFixture = evaluateActionSuggestion({
      localDayKey: recoveryFixture.localDayKey,
      userId: recoveryFixture.userId,
      tasks: recoveryFixture.tasks,
      habits: recoveryFixture.habits,
      todayLogs: recoveryFixture.todayLogs,
    });
    expect(fromFixture.sourceRef.id).toBe('task-rec-overdue');
    expect(fromFixture.reasonCode).toBe('overdue_priority');
  });
});

describe('«Daha küçük yap» (shrinkActionSuggestion) ve «Değiştir» (cycleAlternativeSuggestion)', () => {
  it('shrinkActionSuggestion süreyi 45 -> 25 -> 15 -> 10 -> 5 -> 2 dk basamaklarıyla indirir ve adımı korur', () => {
    let current: ActionSuggestion = evaluateActionSuggestion({
      localDayKey: DAY,
      userId: USER_ID,
      tasksToday: [{ id: 't-big', title: 'Dönem raporunu yaz', estimated_minutes: 45 }],
    });

    const originalId = current.suggestionId;
    const originalStep = current.firstStepTitle;
    const sequence: (number | null)[] = [];

    for (let i = 0; i < 6; i += 1) {
      current = shrinkActionSuggestion(current);
      sequence.push(current.estimate.minutes);
      expect(current.suggestionId).toBe(originalId);
      expect(current.firstStepTitle).toBe(originalStep);
      expect(current.completesParentOnFinish).toBe(false);
    }

    expect(SHRINK_MINUTE_STEPS).toEqual([25, 15, 10, 5, 2]);
    expect(sequence).toEqual([25, 15, 10, 5, 2, 2]);
  });

  it('cycleAlternativeSuggestion dışlanan adayları atlayarak sıradaki adayı seçer ve tümü tükendiğinde başa sarar', () => {
    const input: EvaluateSuggestionInput = {
      localDayKey: DAY,
      userId: USER_ID,
      overdueTasks: [{ id: 't-ov', title: 'Faturayı öde', estimated_minutes: 10 }],
      habitsToDo: [{ id: 'h-1', name: 'Su iç', estimated_minutes: 2 }],
      tasksToday: [{ id: 't-1', title: 'Notları topla', estimated_minutes: 15 }],
    };

    const first = evaluateActionSuggestion(input);
    expect(first.sourceRef.id).toBe('t-ov');

    const second = cycleAlternativeSuggestion(input, ['t-ov']);
    expect(second.sourceRef.id).toBe('h-1');

    const third = cycleAlternativeSuggestion(input, ['t-ov', 'h-1']);
    expect(third.sourceRef.id).toBe('t-1');

    const fourthStarter = cycleAlternativeSuggestion(input, ['t-ov', 'h-1', 't-1']);
    expect(fourthStarter.kind).toBe('start_small');
    expect(fourthStarter.reasonCode).toBe('starter_sample');

    const allStarterIds = listStarterQuickSteps().map((s) => s.packKey);
    const wrapped = cycleAlternativeSuggestion(input, [
      't-ov',
      'h-1',
      't-1',
      ...allStarterIds,
    ]);
    expect(wrapped.sourceRef.id).toBe('t-ov');
  });
});

describe('P03 — Hazır paketlerden zorunlu kurulum gerektirmeyen tek ilk adım (routinePacks)', () => {
  it('listStarterQuickSteps her paketten 2–5 dakikalık tek ilk adımı ve paket yükünü listeler', () => {
    const steps = listStarterQuickSteps();
    expect(steps).toHaveLength(ROUTINE_PACKS.length);

    for (let i = 0; i < ROUTINE_PACKS.length; i += 1) {
      const pack = ROUTINE_PACKS[i];
      const step = steps[i];
      expect(step.packKey).toBe(pack.key);
      expect(step.packTitle).toBe(pack.title);
      expect(step.statedPackLoad).toBe(pack.statedLoad);
      expect(step.estimatedMinutes).toBeGreaterThanOrEqual(2);
      expect(step.estimatedMinutes).toBeLessThanOrEqual(5);
      expect(step.firstStepTitle.trim().length).toBeGreaterThan(10);
      expect(step.firstStepTitle).not.toMatch(CLINICAL_TERMS_RE);

      const backingHabit = pack.habits.find((h) => h.name === step.habitName);
      expect(backingHabit).toBeDefined();
      expect(backingHabit!.difficulty).toBe(1);
    }
  });

  it('pickStarterQuickStep çekirdek başlangıç paketlerinden (morning-reset, deep-work, everyday-foundations) tek adım döndürür', () => {
    expect(STARTER_QUICK_PACK_KEYS).toEqual([
      'morning-reset',
      'deep-work',
      'everyday-foundations',
    ]);

    for (const key of STARTER_QUICK_PACK_KEYS) {
      const step = pickStarterQuickStep(key);
      expect(step.packKey).toBe(key);
      expect(step.estimatedMinutes).toBeGreaterThanOrEqual(2);
      expect(step.estimatedMinutes).toBeLessThanOrEqual(5);
      expect(step.firstStepTitle.trim().length).toBeGreaterThan(10);
    }

    const defaultStep = pickStarterQuickStep();
    expect(defaultStep.packKey).toBe('everyday-foundations');
    expect(defaultStep.estimatedMinutes).toBe(5);
  });
});
