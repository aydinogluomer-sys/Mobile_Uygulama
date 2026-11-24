/**
 * E01 (§12.1) — Ortak Eylem Önerisi Sözleşmesi (`ActionSuggestion`).
 *
 * Bugün ekranı, Odak başlangıç yüzeyi (`SmallStartSheet` / `focusStore`) ve
 * Coach eylem onayı aynı deterministik öneri sözleşmesini paylaşır.
 *
 * Saf (pure) domain modülü:
 *   - I/O, ağ çağrısı, Supabase istemcisi, Zustand store veya AsyncStorage içermez.
 *   - Sistem saati (`Date.now()`, `new Date()`) veya rastgelelik (`Math.random()`) okumaz.
 *   - Mikro adımı bitirmek ana görevi ASLA kendiliğinden tamamlamaz (`completesParentOnFinish: false`).
 */
import {
  DEFAULT_STARTER_PACK_KEY,
  STARTER_QUICK_PACK_KEYS,
  listStarterQuickSteps,
  pickStarterQuickStep,
  type PackQuickStep,
  type RoutinePackKey,
} from './routinePacks';
import {
  MAX_STEP_TITLE,
  SMALL_STEP_MINUTES,
  validateSmallStep,
  type SmallStep,
} from './smallStart';
import { deriveSplitSteps, shortTopic } from './taskDecomposition';
import {
  DEFAULT_TASK_ESTIMATE_MINUTES,
  isValidTaskEstimateMinutes,
  resolveTaskDuration,
  type TaskDurationInput,
  type TaskEstimateSource,
} from './taskDuration';
import { OVERDUE_CALM_LIMIT } from './todayNarrative';
import { focusForNext } from './todayNext';

export { resolveTaskDuration as resolveTaskEstimate } from './taskDuration';

export const ACTION_SUGGESTION_POLICY_VERSION = 1 as const;

/** «Daha küçük yap» basamak merdiveni (`25 -> 15 -> 10 -> 5 -> 2 dk`). */
export const SHRINK_MINUTE_STEPS: readonly [25, 15, 10, 5, 2] = [25, 15, 10, 5, 2];

export type ActionSuggestionKind =
  | 'resume_focus'
  | 'resume_routine'
  | 'start_small'
  | 'recovery'
  | 'habit'
  | 'task';

export type SuggestionReasonCode =
  | 'active_focus'
  | 'active_routine'
  | 'planned_recovery'
  | 'overdue_priority'
  | 'overdue_calm_pick'
  | 'due_habit'
  | 'due_task'
  | 'yielded_focus'
  | 'starter_sample'
  | 'ai_first_step'
  | 'quick_capture';

export type SuggestionSourceEntity =
  | 'task'
  | 'habit'
  | 'routine'
  | 'recovery'
  | 'focus'
  | 'starter_pack'
  | 'draft';

export type SuggestionSourceRef = {
  entity: SuggestionSourceEntity;
  id: string;
  parentTitle?: string;
};

export type SuggestionEstimate = {
  source: TaskEstimateSource;
  minutes: number | null;
  rangeMin?: number | null;
  rangeMax?: number | null;
  isMissingEstimate: boolean;
};

type ActionSuggestionCommon = {
  suggestionId: string;
  policyVersion: 1;
  userId: string | null;
  expectedVersion: string | null;
  localDayKey: string;
  title: string;
  firstStepTitle: string;
  displayReason: string;
  estimate: SuggestionEstimate;
  requiresConfirmation: boolean;
  completesParentOnFinish: false;
  expiresAt: string | null;
};

export type ResumeFocusActionSuggestion = ActionSuggestionCommon & {
  kind: 'resume_focus';
  sourceRef: SuggestionSourceRef & { entity: 'focus' };
  reasonCode: 'active_focus' | 'yielded_focus';
};

export type ResumeRoutineActionSuggestion = ActionSuggestionCommon & {
  kind: 'resume_routine';
  sourceRef: SuggestionSourceRef & { entity: 'routine' };
  reasonCode: 'active_routine';
};

export type RecoveryActionSuggestion = ActionSuggestionCommon & {
  kind: 'recovery';
  sourceRef: SuggestionSourceRef & { entity: 'recovery' };
  reasonCode: 'planned_recovery';
};

export type HabitActionSuggestion = ActionSuggestionCommon & {
  kind: 'habit';
  sourceRef: SuggestionSourceRef & { entity: 'habit' };
  reasonCode: 'due_habit';
};

export type StartSmallActionSuggestion = ActionSuggestionCommon & {
  kind: 'start_small';
  sourceRef: SuggestionSourceRef & { entity: 'task' | 'starter_pack' | 'draft' | 'habit' };
  reasonCode:
    | 'starter_sample'
    | 'overdue_priority'
    | 'overdue_calm_pick'
    | 'due_task'
    | 'ai_first_step'
    | 'quick_capture';
};

export type TaskActionSuggestion = ActionSuggestionCommon & {
  kind: 'task';
  sourceRef: SuggestionSourceRef & { entity: 'task' | 'draft' };
  reasonCode:
    | 'overdue_priority'
    | 'overdue_calm_pick'
    | 'due_task'
    | 'ai_first_step'
    | 'quick_capture';
};

/** `kind` üzerinden ayrıştırılmış (discriminated union) ortak eylem önerisi sözleşmesi (§12.1). */
export type ActionSuggestion =
  | ResumeFocusActionSuggestion
  | ResumeRoutineActionSuggestion
  | RecoveryActionSuggestion
  | HabitActionSuggestion
  | StartSmallActionSuggestion
  | TaskActionSuggestion;

export type SuggestionSurface = 'today' | 'focus_entry' | 'coach';

export type SuggestionEnergyLevel = 'low' | 'normal' | 'high';

export type SuggestionFocusInput = {
  readonly id?: string | null;
  readonly status: 'idle' | 'running' | 'paused';
  readonly title?: string | null;
  readonly stepTitle?: string | null;
  readonly parentTitle?: string | null;
  readonly yielded?: boolean;
  readonly pausedAt?: number | null;
  readonly startedAtIso?: string | null;
  readonly remainingMinutes?: number | null;
  readonly plannedMinutes?: number | null;
  readonly expectedVersion?: string | null;
};

export type SuggestionRoutineInput = {
  readonly id?: string | null;
  readonly status: 'running' | 'paused' | 'finished';
  readonly templateName: string;
  readonly done: number;
  readonly total: number;
  readonly currentStepTitle?: string | null;
  readonly remainingMinutes?: number | null;
  readonly expectedVersion?: string | null;
};

export type SuggestionRecoveryInput = {
  readonly id: string;
  readonly habitName: string;
  readonly firstStepTitle?: string | null;
  readonly estimatedMinutes?: number | null;
  readonly expectedVersion?: string | null;
};

export type SuggestionTaskInput = TaskDurationInput & {
  readonly id: string;
  readonly title: string;
  readonly status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  readonly completed?: boolean;
  readonly due_date?: string | null;
  readonly list_type?: 'inbox' | 'this_week' | 'someday';
  readonly minutes?: number | null;
  readonly firstStepTitle?: string | null;
  readonly rangeMin?: number | null;
  readonly rangeMax?: number | null;
  readonly updated_at?: string | null;
  readonly expectedVersion?: string | null;
};

export type SuggestionHabitInput = {
  readonly id: string;
  readonly name: string;
  readonly status?: 'active' | 'paused' | 'archived' | string;
  readonly completedToday?: boolean;
  readonly tracking_type?: 'binary' | 'numeric' | string;
  readonly daily_goal?: number | null;
  readonly remainingValue?: number | null;
  readonly unit?: string | null;
  readonly estimated_minutes?: number | null;
  readonly firstStepTitle?: string | null;
  readonly updated_at?: string | null;
  readonly expectedVersion?: string | null;
};

export type SuggestionHabitLogLike = {
  readonly habit_id: string;
  readonly completed_at: string;
  readonly is_completed?: boolean | null;
  readonly state?: string | null;
};

export type SuggestionLoadState = {
  readonly currentLoad?: number | null;
  readonly ceiling?: number | null;
  readonly isHighLoad?: boolean;
};

export type EvaluateSuggestionInput = {
  readonly localDayKey: string;
  readonly userId?: string | null;
  readonly nowMs?: number | null;
  readonly surface?: SuggestionSurface;
  readonly requiresConfirmation?: boolean;
  readonly expiresAt?: string | null;
  readonly energyLevel?: SuggestionEnergyLevel | null;
  readonly lowEnergy?: boolean;
  readonly loadState?: SuggestionLoadState | null;
  readonly preferredStarterPackKey?: RoutinePackKey;
  readonly focus?: SuggestionFocusInput | null;
  readonly routine?: SuggestionRoutineInput | null;
  readonly recoveryToday?: readonly SuggestionRecoveryInput[];
  readonly overdueTasks?: readonly SuggestionTaskInput[];
  readonly tasksToday?: readonly SuggestionTaskInput[];
  readonly tasks?: readonly SuggestionTaskInput[];
  readonly habitsToDo?: readonly SuggestionHabitInput[];
  readonly habits?: readonly SuggestionHabitInput[];
  readonly todayLogs?: readonly SuggestionHabitLogLike[];
};

export type DeterministicSuggestionIdParams = {
  userId: string | null;
  localDayKey: string;
  kind: ActionSuggestionKind;
  sourceEntity: string;
  sourceId: string;
  stepTitle?: string;
};

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizeIdToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function encodeSegment(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * Aynı kullanıcı, yerel gün, öneri türü, kaynak varlık ve ilk adım başlığı için
 * Bugün ekranı, Odak girişi ve Coach onayında birebir aynı `suggestionId` değerini üretir (`E01`).
 */
export function deterministicSuggestionId(params: DeterministicSuggestionIdParams): string {
  const userToken = normalizeIdToken(params.userId ?? '') || 'anon';
  const dayToken = normalizeIdToken(params.localDayKey);
  const kindToken = normalizeIdToken(params.kind).toLowerCase();
  const entityToken = normalizeIdToken(params.sourceEntity).toLowerCase();
  const sourceIdToken = normalizeIdToken(params.sourceId);
  const stepToken = normalizeIdToken(params.stepTitle ?? '').toLowerCase();

  const canonical = [
    `v${ACTION_SUGGESTION_POLICY_VERSION}`,
    encodeSegment(userToken),
    encodeSegment(dayToken),
    encodeSegment(kindToken),
    encodeSegment(entityToken),
    encodeSegment(sourceIdToken),
    encodeSegment(stepToken),
  ].join('|');

  const hi = fnv1a32(canonical, 0x811c9dc5).toString(16).padStart(8, '0');
  const lo = fnv1a32(`aderyth:${canonical}`, 0x9e3779b9).toString(16).padStart(8, '0');
  return `sug_v${ACTION_SUGGESTION_POLICY_VERSION}_${kindToken}_${hi}${lo}`;
}

/**
 * Mevcut bir öneriyi hedef yüzeye (`today` | `focus_entry` | `coach`) uyarlar;
 * `suggestionId` ve `completesParentOnFinish: false` garantisini korur.
 */
export function forSuggestionSurface(
  suggestion: ActionSuggestion,
  surface: SuggestionSurface,
): ActionSuggestion {
  const requiresConfirmation =
    surface === 'coach' ? true : suggestion.estimate.source === 'ai';
  if (suggestion.requiresConfirmation === requiresConfirmation) {
    return suggestion;
  }
  return {
    ...suggestion,
    requiresConfirmation,
  };
}

/**
 * Görev kaynaklı bir öneriyi Odak başlangıcı için doğrulanmış `SmallStep` nesnesine dönüştürür;
 * görev dışı önerilerde `null` döner.
 */
export function suggestionToSmallStep(suggestion: ActionSuggestion): SmallStep | null {
  if (suggestion.sourceRef.entity !== 'task') return null;
  const rawMinutes = suggestion.estimate.minutes ?? DEFAULT_TASK_ESTIMATE_MINUTES;
  const clampedMinutes = Math.min(60, Math.max(1, Math.round(rawMinutes)));
  const parentTitle = suggestion.sourceRef.parentTitle ?? suggestion.title;
  const check = validateSmallStep(
    { kind: 'task', id: suggestion.sourceRef.id, title: parentTitle },
    { title: suggestion.firstStepTitle, minutes: clampedMinutes },
  );
  return check.ok ? check.step : null;
}

function isLowEnergyContext(input: EvaluateSuggestionInput): boolean {
  return input.lowEnergy === true || input.energyLevel === 'low';
}

function isHighLoadContext(input: EvaluateSuggestionInput): boolean {
  const load = input.loadState;
  if (!load) return false;
  if (load.isHighLoad === true) return true;
  return (
    typeof load.currentLoad === 'number' &&
    typeof load.ceiling === 'number' &&
    Number.isFinite(load.currentLoad) &&
    Number.isFinite(load.ceiling) &&
    load.currentLoad > load.ceiling
  );
}

function resolveRequiresConfirmation(
  input: EvaluateSuggestionInput,
  estimateSource: TaskEstimateSource,
): boolean {
  if (typeof input.requiresConfirmation === 'boolean') {
    return input.requiresConfirmation;
  }
  if (input.surface === 'coach') return true;
  return estimateSource === 'ai';
}

function clampStepTitle(raw: string, fallback: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const candidate = trimmed.length > 0 ? trimmed : fallback;
  if (candidate.length <= MAX_STEP_TITLE) return candidate;
  const shortened = shortTopic(candidate, MAX_STEP_TITLE);
  return shortened.length > 0 ? shortened : candidate.slice(0, MAX_STEP_TITLE).trim();
}

function isTaskActionable(task: SuggestionTaskInput): boolean {
  if (task.completed === true) return false;
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  return true;
}

function normalizeTaskCollections(input: EvaluateSuggestionInput): {
  overdue: SuggestionTaskInput[];
  today: SuggestionTaskInput[];
} {
  const overdueById = new Map<string, SuggestionTaskInput>();
  const todayById = new Map<string, SuggestionTaskInput>();

  for (const t of input.overdueTasks ?? []) {
    if (isTaskActionable(t)) overdueById.set(t.id, t);
  }
  for (const t of input.tasksToday ?? []) {
    if (isTaskActionable(t) && !overdueById.has(t.id)) {
      todayById.set(t.id, t);
    }
  }

  for (const t of input.tasks ?? []) {
    if (!isTaskActionable(t)) continue;
    if (overdueById.has(t.id) || todayById.has(t.id)) continue;

    if (typeof t.due_date === 'string' && t.due_date.length > 0) {
      if (t.due_date < input.localDayKey) {
        overdueById.set(t.id, t);
      } else if (t.due_date === input.localDayKey) {
        todayById.set(t.id, t);
      }
    } else if (t.due_date === undefined && t.list_type !== 'someday') {
      todayById.set(t.id, t);
    } else if (t.due_date === null && t.list_type !== 'someday' && !input.tasksToday && !input.overdueTasks) {
      todayById.set(t.id, t);
    }
  }

  return {
    overdue: [...overdueById.values()],
    today: [...todayById.values()],
  };
}

function normalizeHabitsToDo(input: EvaluateSuggestionInput): SuggestionHabitInput[] {
  const completedHabitIds = new Set<string>();
  for (const log of input.todayLogs ?? []) {
    if (
      log.completed_at === input.localDayKey &&
      (log.is_completed === true || log.state === 'done')
    ) {
      completedHabitIds.add(log.habit_id);
    }
  }

  const byId = new Map<string, SuggestionHabitInput>();
  const acceptHabit = (h: SuggestionHabitInput): void => {
    if (h.completedToday === true) return;
    if (h.status !== undefined && h.status !== 'active') return;
    if (completedHabitIds.has(h.id)) return;
    if (!byId.has(h.id)) byId.set(h.id, h);
  };

  for (const h of input.habitsToDo ?? []) acceptHabit(h);
  for (const h of input.habits ?? []) acceptHabit(h);

  return [...byId.values()];
}

function toTaskDurationInput(task: SuggestionTaskInput): TaskDurationInput {
  const fallbackMinutes =
    isValidTaskEstimateMinutes(task.estimated_minutes)
      ? task.estimated_minutes
      : isValidTaskEstimateMinutes(task.minutes)
        ? task.minutes
        : null;

  return {
    estimated_minutes: fallbackMinutes,
    estimate_source: task.estimate_source ?? null,
    time_block_start: task.time_block_start ?? null,
    time_block_end: task.time_block_end ?? null,
  };
}

function pickCalmOverdueTask(
  items: readonly SuggestionTaskInput[],
): SuggestionTaskInput | undefined {
  if (items.length === 0) return undefined;
  let best: SuggestionTaskInput | undefined;
  let bestMin = Number.POSITIVE_INFINITY;

  for (const item of items) {
    const explicit = resolveTaskDuration(toTaskDurationInput(item), { allowDefault: false });
    if (explicit.minutes !== null && explicit.minutes > 0 && explicit.minutes < bestMin) {
      bestMin = explicit.minutes;
      best = item;
    }
  }
  return best ?? items[0];
}

function deriveTaskFirstStepTitle(task: SuggestionTaskInput): string {
  if (typeof task.firstStepTitle === 'string' && task.firstStepTitle.trim().length > 0) {
    return clampStepTitle(task.firstStepTitle, task.title);
  }
  const steps = deriveSplitSteps(task.title);
  const step = steps[0];
  const topic = shortTopic(task.title, 60);
  const combined = topic.length > 0 ? `${step} — ${topic}` : step;
  return clampStepTitle(combined, step);
}

function buildContextNotes(params: {
  estimate: SuggestionEstimate;
  lowEnergy: boolean;
  highLoad: boolean;
}): string[] {
  const notes: string[] = [];

  if (params.estimate.isMissingEstimate) {
    const assumed = params.estimate.minutes ?? DEFAULT_TASK_ESTIMATE_MINUTES;
    notes.push(`kayıtlı süre tahmini olmadığı için ${assumed} dk varsayılan süre alındı`);
  } else if (params.estimate.source === 'block' && params.estimate.minutes !== null) {
    notes.push(`takvim bloğundan ${params.estimate.minutes} dk süre alındı`);
  } else if (params.estimate.source === 'ai' && params.estimate.minutes !== null) {
    notes.push(`önerilen ${params.estimate.minutes} dk tahmini kullanıldı`);
  }

  if (params.lowEnergy && params.highLoad) {
    notes.push('düşük enerji tercihi ve yoğun günlük yük nedeniyle yalnızca küçük ilk adıma odaklanıldı');
  } else if (params.lowEnergy) {
    notes.push('düşük enerji tercihi nedeniyle tamamını bitirmek yerine ilk küçük adımla başlaman önerildi');
  } else if (params.highLoad) {
    notes.push('günlük yük yüksek olduğu için tek küçük adımla ilerlemek üzere seçildi');
  }

  return notes;
}

function joinReasonClauses(lead: string, clauses: readonly string[]): string {
  const all = [lead, ...clauses].filter((c) => c.trim().length > 0);
  return `${all.join('; ')}.`;
}

function resolveFocusState(
  focus: SuggestionFocusInput | null | undefined,
  nowMs: number | null | undefined,
): {
  open: boolean;
  status: 'idle' | 'running' | 'paused';
  yielded: boolean;
  id: string;
  title: string | null;
  stepTitle: string | null;
  parentTitle: string | null;
  remainingMinutes: number | null;
  plannedMinutes: number | null;
  expectedVersion: string | null;
} {
  if (!focus || focus.status === 'idle') {
    return {
      open: false,
      status: 'idle',
      yielded: false,
      id: 'active-focus',
      title: null,
      stepTitle: null,
      parentTitle: null,
      remainingMinutes: null,
      plannedMinutes: null,
      expectedVersion: null,
    };
  }

  let yielded = focus.yielded === true;
  if (
    focus.yielded === undefined &&
    typeof nowMs === 'number' &&
    Number.isFinite(nowMs) &&
    (focus.pausedAt !== undefined || focus.startedAtIso !== undefined)
  ) {
    const computed = focusForNext(
      {
        status: focus.status,
        title: focus.title ?? null,
        pausedAt: focus.pausedAt ?? null,
        startedAtIso: focus.startedAtIso ?? null,
      },
      nowMs,
    );
    yielded = computed.yielded === true;
  }

  return {
    open: true,
    status: focus.status,
    yielded,
    id: (focus.id ?? '').trim() || 'active-focus',
    title: focus.title?.trim() || null,
    stepTitle: focus.stepTitle?.trim() || null,
    parentTitle: focus.parentTitle?.trim() || null,
    remainingMinutes:
      typeof focus.remainingMinutes === 'number' &&
      Number.isFinite(focus.remainingMinutes) &&
      focus.remainingMinutes >= 1
        ? Math.min(1440, Math.round(focus.remainingMinutes))
        : null,
    plannedMinutes:
      typeof focus.plannedMinutes === 'number' &&
      Number.isFinite(focus.plannedMinutes) &&
      focus.plannedMinutes >= 1
        ? Math.min(1440, Math.round(focus.plannedMinutes))
        : null,
    expectedVersion: focus.expectedVersion ?? null,
  };
}

function buildFocusSuggestion(
  input: EvaluateSuggestionInput,
  focusState: ReturnType<typeof resolveFocusState>,
  reasonCode: 'active_focus' | 'yielded_focus',
): ResumeFocusActionSuggestion {
  const userId = input.userId ?? null;
  const title = focusState.title ? `Odak: ${focusState.title}` : 'Odak oturumu';
  const rawStep =
    focusState.stepTitle ??
    (focusState.title
      ? focusState.status === 'paused'
        ? `"${focusState.title}" oturumuna kaldığın yerden devam et`
        : `"${focusState.title}" oturumunu sürdür`
      : focusState.status === 'paused'
        ? 'Duraklatılan odak oturumuna kaldığın yerden devam et'
        : 'Açık odak oturumunu sürdür');
  const firstStepTitle = clampStepTitle(rawStep, 'Odak oturumuna devam et');

  const minutes = focusState.remainingMinutes ?? focusState.plannedMinutes;
  const estimate: SuggestionEstimate =
    minutes !== null
      ? { source: 'user', minutes, isMissingEstimate: false }
      : { source: 'none', minutes: null, isMissingEstimate: true };

  const displayReason =
    reasonCode === 'yielded_focus'
      ? 'Yarım kalan odak oturumu var — istersen kaldığın yerden bitir ya da bırak.'
      : focusState.status === 'paused'
        ? 'Duraklatıldı — kaldığın yerden devam et.'
        : 'Açık odak oturumu sürüyor — önce elindeki adımı tamamla.';

  const sourceRef: SuggestionSourceRef & { entity: 'focus' } = {
    entity: 'focus',
    id: focusState.id,
    ...(focusState.parentTitle
      ? { parentTitle: focusState.parentTitle }
      : focusState.title
        ? { parentTitle: focusState.title }
        : {}),
  };

  return {
    suggestionId: deterministicSuggestionId({
      userId,
      localDayKey: input.localDayKey,
      kind: 'resume_focus',
      sourceEntity: sourceRef.entity,
      sourceId: sourceRef.id,
      stepTitle: firstStepTitle,
    }),
    policyVersion: ACTION_SUGGESTION_POLICY_VERSION,
    userId,
    sourceRef,
    expectedVersion: focusState.expectedVersion,
    localDayKey: input.localDayKey,
    kind: 'resume_focus',
    title,
    firstStepTitle,
    reasonCode,
    displayReason,
    estimate,
    requiresConfirmation: resolveRequiresConfirmation(input, estimate.source),
    completesParentOnFinish: false,
    expiresAt: input.expiresAt ?? null,
  };
}

function buildRoutineSuggestion(
  input: EvaluateSuggestionInput,
  routine: SuggestionRoutineInput,
): ResumeRoutineActionSuggestion {
  const userId = input.userId ?? null;
  const routineId = (routine.id ?? '').trim() || `routine:${routine.templateName.trim()}`;
  const rawStep =
    routine.currentStepTitle?.trim() ||
    `${routine.templateName} rutininde sıradaki adıma devam et (${routine.done}/${routine.total})`;
  const firstStepTitle = clampStepTitle(rawStep, `${routine.templateName} rutinine devam et`);

  const minutes =
    typeof routine.remainingMinutes === 'number' &&
    Number.isFinite(routine.remainingMinutes) &&
    routine.remainingMinutes >= 1
      ? Math.min(1440, Math.round(routine.remainingMinutes))
      : null;

  const estimate: SuggestionEstimate =
    minutes !== null
      ? { source: 'user', minutes, isMissingEstimate: false }
      : { source: 'none', minutes: null, isMissingEstimate: true };

  const statusText =
    routine.status === 'paused' ? 'duraklatıldı, kaldığın yerden devam et' : 'devam et';
  const displayReason = `${routine.done}/${routine.total} adım — ${statusText}.`;

  const sourceRef: SuggestionSourceRef & { entity: 'routine' } = {
    entity: 'routine',
    id: routineId,
    parentTitle: routine.templateName,
  };

  return {
    suggestionId: deterministicSuggestionId({
      userId,
      localDayKey: input.localDayKey,
      kind: 'resume_routine',
      sourceEntity: sourceRef.entity,
      sourceId: sourceRef.id,
      stepTitle: firstStepTitle,
    }),
    policyVersion: ACTION_SUGGESTION_POLICY_VERSION,
    userId,
    sourceRef,
    expectedVersion: routine.expectedVersion ?? null,
    localDayKey: input.localDayKey,
    kind: 'resume_routine',
    title: routine.templateName,
    firstStepTitle,
    reasonCode: 'active_routine',
    displayReason,
    estimate,
    requiresConfirmation: resolveRequiresConfirmation(input, estimate.source),
    completesParentOnFinish: false,
    expiresAt: input.expiresAt ?? null,
  };
}

function buildRecoverySuggestion(
  input: EvaluateSuggestionInput,
  recovery: SuggestionRecoveryInput,
): RecoveryActionSuggestion {
  const userId = input.userId ?? null;
  const rawStep =
    recovery.firstStepTitle?.trim() ||
    `${recovery.habitName} için bugünkü telafi adımını tamamla`;
  const firstStepTitle = clampStepTitle(rawStep, recovery.habitName);

  const hasExplicitMinutes =
    typeof recovery.estimatedMinutes === 'number' &&
    Number.isFinite(recovery.estimatedMinutes) &&
    recovery.estimatedMinutes >= 1 &&
    recovery.estimatedMinutes <= 1440;

  const estimate: SuggestionEstimate = hasExplicitMinutes
    ? {
        source: 'user',
        minutes: Math.round(recovery.estimatedMinutes as number),
        isMissingEstimate: false,
      }
    : {
        source: 'default',
        minutes: 5,
        isMissingEstimate: true,
      };

  const notes = buildContextNotes({
    estimate,
    lowEnergy: isLowEnergyContext(input),
    highLoad: isHighLoadContext(input),
  });
  const displayReason = joinReasonClauses('Bugün için planladığın telafi adımı sırada', notes);

  const sourceRef: SuggestionSourceRef & { entity: 'recovery' } = {
    entity: 'recovery',
    id: recovery.id,
    parentTitle: recovery.habitName,
  };

  return {
    suggestionId: deterministicSuggestionId({
      userId,
      localDayKey: input.localDayKey,
      kind: 'recovery',
      sourceEntity: sourceRef.entity,
      sourceId: sourceRef.id,
      stepTitle: firstStepTitle,
    }),
    policyVersion: ACTION_SUGGESTION_POLICY_VERSION,
    userId,
    sourceRef,
    expectedVersion: recovery.expectedVersion ?? null,
    localDayKey: input.localDayKey,
    kind: 'recovery',
    title: recovery.habitName,
    firstStepTitle,
    reasonCode: 'planned_recovery',
    displayReason,
    estimate,
    requiresConfirmation: resolveRequiresConfirmation(input, estimate.source),
    completesParentOnFinish: false,
    expiresAt: input.expiresAt ?? null,
  };
}

function buildHabitSuggestion(
  input: EvaluateSuggestionInput,
  habit: SuggestionHabitInput,
): HabitActionSuggestion {
  const userId = input.userId ?? null;

  let generatedStep = `${habit.name} alışkanlığını şimdi uygula`;
  if (typeof habit.firstStepTitle === 'string' && habit.firstStepTitle.trim().length > 0) {
    generatedStep = habit.firstStepTitle.trim();
  } else if (habit.tracking_type === 'numeric' && habit.unit) {
    if (typeof habit.remainingValue === 'number' && habit.remainingValue > 0) {
      generatedStep = `${habit.name} için kalan ${habit.remainingValue} ${habit.unit} hedefinden ilk adımı kaydet`;
    } else if (typeof habit.daily_goal === 'number' && habit.daily_goal > 0) {
      generatedStep = `${habit.name} için ilk ölçümü kaydet (${habit.daily_goal} ${habit.unit})`;
    }
  }
  const firstStepTitle = clampStepTitle(generatedStep, habit.name);

  const hasValidMinutes = isValidTaskEstimateMinutes(habit.estimated_minutes);
  const estimate: SuggestionEstimate = hasValidMinutes
    ? {
        source: 'user',
        minutes: habit.estimated_minutes as number,
        isMissingEstimate: false,
      }
    : {
        source: 'default',
        minutes: 5,
        isMissingEstimate: true,
      };

  const notes = buildContextNotes({
    estimate,
    lowEnergy: isLowEnergyContext(input),
    highLoad: isHighLoadContext(input),
  });
  const displayReason = joinReasonClauses('Bugünün alışkanlığı sırada', notes);

  const sourceRef: SuggestionSourceRef & { entity: 'habit' } = {
    entity: 'habit',
    id: habit.id,
    parentTitle: habit.name,
  };

  return {
    suggestionId: deterministicSuggestionId({
      userId,
      localDayKey: input.localDayKey,
      kind: 'habit',
      sourceEntity: sourceRef.entity,
      sourceId: sourceRef.id,
      stepTitle: firstStepTitle,
    }),
    policyVersion: ACTION_SUGGESTION_POLICY_VERSION,
    userId,
    sourceRef,
    expectedVersion: habit.expectedVersion ?? habit.updated_at ?? null,
    localDayKey: input.localDayKey,
    kind: 'habit',
    title: habit.name,
    firstStepTitle,
    reasonCode: 'due_habit',
    displayReason,
    estimate,
    requiresConfirmation: resolveRequiresConfirmation(input, estimate.source),
    completesParentOnFinish: false,
    expiresAt: input.expiresAt ?? null,
  };
}

function buildTaskSuggestion(
  input: EvaluateSuggestionInput,
  task: SuggestionTaskInput,
  reasonCode: 'overdue_priority' | 'overdue_calm_pick' | 'due_task',
): TaskActionSuggestion {
  const userId = input.userId ?? null;
  const resolved = resolveTaskDuration(toTaskDurationInput(task));
  const firstStepTitle = deriveTaskFirstStepTitle(task);

  const estimate: SuggestionEstimate = {
    source: resolved.source,
    minutes: resolved.minutes,
    ...(task.rangeMin !== undefined
      ? { rangeMin: task.rangeMin }
      : resolved.isMissingEstimate
        ? { rangeMin: 5 }
        : {}),
    ...(task.rangeMax !== undefined
      ? { rangeMax: task.rangeMax }
      : resolved.isMissingEstimate
        ? { rangeMax: DEFAULT_TASK_ESTIMATE_MINUTES }
        : {}),
    isMissingEstimate: resolved.isMissingEstimate,
  };

  let lead: string;
  switch (reasonCode) {
    case 'overdue_calm_pick':
      lead = 'Birikmiş işler arasından en kısa başlangıç adımı seçildi';
      break;
    case 'overdue_priority':
      lead = 'Gecikmiş görev — tamamını bitirmek zorunda kalmadan ilk somut adımla başla';
      break;
    case 'due_task':
    default:
      lead = 'Bugünün görevi — ilk somut adımla başla';
      break;
  }

  const notes = buildContextNotes({
    estimate,
    lowEnergy: isLowEnergyContext(input),
    highLoad: isHighLoadContext(input),
  });
  const displayReason = joinReasonClauses(lead, notes);

  const sourceRef: SuggestionSourceRef & { entity: 'task' } = {
    entity: 'task',
    id: task.id,
    parentTitle: task.title,
  };

  return {
    suggestionId: deterministicSuggestionId({
      userId,
      localDayKey: input.localDayKey,
      kind: 'task',
      sourceEntity: sourceRef.entity,
      sourceId: sourceRef.id,
      stepTitle: firstStepTitle,
    }),
    policyVersion: ACTION_SUGGESTION_POLICY_VERSION,
    userId,
    sourceRef,
    expectedVersion: task.expectedVersion ?? task.updated_at ?? null,
    localDayKey: input.localDayKey,
    kind: 'task',
    title: task.title,
    firstStepTitle,
    reasonCode,
    displayReason,
    estimate,
    requiresConfirmation: resolveRequiresConfirmation(input, estimate.source),
    completesParentOnFinish: false,
    expiresAt: input.expiresAt ?? null,
  };
}

function buildStarterSampleSuggestion(
  input: EvaluateSuggestionInput,
  quickStep: PackQuickStep,
): StartSmallActionSuggestion {
  const userId = input.userId ?? null;
  const firstStepTitle = clampStepTitle(quickStep.firstStepTitle, quickStep.habitName);
  const minutes =
    input.preferredStarterPackKey !== undefined ? quickStep.estimatedMinutes : 5;

  const estimate: SuggestionEstimate = {
    source: 'default',
    minutes,
    rangeMin: 2,
    rangeMax: 5,
    isMissingEstimate: false,
  };

  const lowEnergy = isLowEnergyContext(input);
  const lead =
    `Henüz açık görev veya alışkanlık yok — "${quickStep.packTitle}" paketinden ` +
    `kurulum gerektirmeyen ${minutes} dakikalık örnek adımla hemen başlayabilirsin`;
  const clauses = lowEnergy
    ? ['düşük enerji tercihi için en düşük sürtünmeli başlangıç adımı korundu']
    : [];
  const displayReason = joinReasonClauses(lead, clauses);

  const sourceRef: SuggestionSourceRef & { entity: 'starter_pack' } = {
    entity: 'starter_pack',
    id: quickStep.packKey,
    parentTitle: quickStep.packTitle,
  };

  return {
    suggestionId: deterministicSuggestionId({
      userId,
      localDayKey: input.localDayKey,
      kind: 'start_small',
      sourceEntity: sourceRef.entity,
      sourceId: sourceRef.id,
      stepTitle: firstStepTitle,
    }),
    policyVersion: ACTION_SUGGESTION_POLICY_VERSION,
    userId,
    sourceRef,
    expectedVersion: null,
    localDayKey: input.localDayKey,
    kind: 'start_small',
    title: quickStep.habitName,
    firstStepTitle,
    reasonCode: 'starter_sample',
    displayReason,
    estimate,
    requiresConfirmation: resolveRequiresConfirmation(input, estimate.source),
    completesParentOnFinish: false,
    expiresAt: input.expiresAt ?? null,
  };
}

function isExcluded(
  excludeSet: ReadonlySet<string>,
  entity: SuggestionSourceEntity,
  id: string,
): boolean {
  if (excludeSet.size === 0) return false;
  return excludeSet.has(id) || excludeSet.has(`${entity}:${id}`);
}

function pickStarterSampleForEvaluation(
  input: EvaluateSuggestionInput,
  excludeSet: ReadonlySet<string>,
): PackQuickStep | null {
  const preferredKey = input.preferredStarterPackKey ?? DEFAULT_STARTER_PACK_KEY;
  const preferred = pickStarterQuickStep(preferredKey);
  if (!isExcluded(excludeSet, 'starter_pack', preferred.packKey)) {
    return preferred;
  }

  for (const key of STARTER_QUICK_PACK_KEYS) {
    if (!isExcluded(excludeSet, 'starter_pack', key)) {
      return pickStarterQuickStep(key);
    }
  }

  for (const candidate of listStarterQuickSteps()) {
    if (!isExcluded(excludeSet, 'starter_pack', candidate.packKey)) {
      return candidate;
    }
  }

  return null;
}

function evaluateWithExclusions(
  input: EvaluateSuggestionInput,
  excludeSet: ReadonlySet<string>,
): ActionSuggestion | null {
  const focusState = resolveFocusState(input.focus, input.nowMs);
  const focusEligible =
    focusState.open && !isExcluded(excludeSet, 'focus', focusState.id);

  // 1. Açık ve sırayı bırakmamış (fresh) odak oturumu
  if (focusEligible && !focusState.yielded) {
    return buildFocusSuggestion(input, focusState, 'active_focus');
  }

  // 2. Açık rutin oturumu
  if (input.routine && input.routine.status !== 'finished') {
    const routineId =
      (input.routine.id ?? '').trim() || `routine:${input.routine.templateName.trim()}`;
    if (!isExcluded(excludeSet, 'routine', routineId)) {
      return buildRoutineSuggestion(input, input.routine);
    }
  }

  // 3. Bugün için planlanmış telafi adımı
  const recoveryCandidate = (input.recoveryToday ?? []).find(
    (r) => !isExcluded(excludeSet, 'recovery', r.id),
  );
  if (recoveryCandidate) {
    return buildRecoverySuggestion(input, recoveryCandidate);
  }

  // 4–6. Gecikmiş görevler (OVERDUE_CALM_LIMIT kuralı korunur), bugünkü alışkanlık ve bugünkü görev
  const allTasks = normalizeTaskCollections(input);
  const totalOverdueCount = allTasks.overdue.length;
  const remainingOverdue = allTasks.overdue.filter(
    (t) => !isExcluded(excludeSet, 'task', t.id),
  );
  const remainingHabits = normalizeHabitsToDo(input).filter(
    (h) => !isExcluded(excludeSet, 'habit', h.id),
  );
  const remainingTodayTasks = allTasks.today.filter(
    (t) => !isExcluded(excludeSet, 'task', t.id),
  );

  if (totalOverdueCount > OVERDUE_CALM_LIMIT) {
    const firstHabit = remainingHabits[0];
    if (firstHabit) {
      return buildHabitSuggestion(input, firstHabit);
    }
    const firstTodayTask = remainingTodayTasks[0];
    if (firstTodayTask) {
      return buildTaskSuggestion(input, firstTodayTask, 'due_task');
    }
    const calmOverdue = pickCalmOverdueTask(remainingOverdue);
    if (calmOverdue) {
      return buildTaskSuggestion(input, calmOverdue, 'overdue_calm_pick');
    }
  } else {
    const firstOverdue = remainingOverdue[0];
    if (firstOverdue) {
      return buildTaskSuggestion(input, firstOverdue, 'overdue_priority');
    }
    const firstHabit = remainingHabits[0];
    if (firstHabit) {
      return buildHabitSuggestion(input, firstHabit);
    }
    const firstTodayTask = remainingTodayTasks[0];
    if (firstTodayTask) {
      return buildTaskSuggestion(input, firstTodayTask, 'due_task');
    }
  }

  // Sırayı bırakmış (uzun duraklamalı / eski) açık odak oturumu kuyruk sonuna yerleşir
  if (focusEligible && focusState.yielded) {
    return buildFocusSuggestion(input, focusState, 'yielded_focus');
  }

  // 7. Boş hesap veya tüm açık işler dışlandığında 5 dakikalık başlangıç örnek adımı (LEAF-01)
  const starterSample = pickStarterSampleForEvaluation(input, excludeSet);
  if (starterSample) {
    return buildStarterSampleSuggestion(input, starterSample);
  }

  return null;
}

/**
 * `todayNext.ts` öncelik sırasını birebir koruyarak tek bir uygulanabilir `ActionSuggestion` üretir (`E01`).
 */
export function evaluateActionSuggestion(input: EvaluateSuggestionInput): ActionSuggestion {
  const result = evaluateWithExclusions(input, new Set<string>());
  if (result) return result;
  return buildStarterSampleSuggestion(input, pickStarterQuickStep(input.preferredStarterPackKey));
}

function nextSmallerMinutes(currentMinutes: number | null): number {
  const effective =
    typeof currentMinutes === 'number' && Number.isFinite(currentMinutes) && currentMinutes > 0
      ? currentMinutes
      : DEFAULT_TASK_ESTIMATE_MINUTES;

  for (const step of SHRINK_MINUTE_STEPS) {
    if (step < effective) return step;
  }
  return SMALL_STEP_MINUTES[0];
}

/**
 * «Daha küçük yap» eylemi için önerinin süresini bir alt basamağa (`25 -> 15 -> 10 -> 5 -> 2 dk`)
 * indirir; ilk adımı, kimliği ve `completesParentOnFinish: false` garantisini korur (`E01`).
 */
export function shrinkActionSuggestion(s: ActionSuggestion): ActionSuggestion {
  const shrunkMinutes = nextSmallerMinutes(s.estimate.minutes);
  const nextRangeMin =
    typeof s.estimate.rangeMin === 'number'
      ? Math.min(s.estimate.rangeMin, shrunkMinutes)
      : s.estimate.rangeMin;
  const nextRangeMax =
    typeof s.estimate.rangeMax === 'number'
      ? Math.min(s.estimate.rangeMax, shrunkMinutes)
      : s.estimate.rangeMax;

  const nextEstimate: SuggestionEstimate = {
    ...s.estimate,
    source: s.estimate.source === 'none' ? 'default' : s.estimate.source,
    minutes: shrunkMinutes,
    ...(nextRangeMin !== undefined ? { rangeMin: nextRangeMin } : {}),
    ...(nextRangeMax !== undefined ? { rangeMax: nextRangeMax } : {}),
  };

  return {
    ...s,
    estimate: nextEstimate,
    completesParentOnFinish: false,
  };
}

/**
 * «Değiştir» eylemi için `excludeSourceIds` içinde olmayan sıradaki alternatif öneriyi seçer.
 * Tüm adaylar dışlanmışsa deterministik olarak ilk öneriye sarar (`E01`).
 */
export function cycleAlternativeSuggestion(
  input: EvaluateSuggestionInput,
  excludeSourceIds: readonly string[],
): ActionSuggestion {
  const cleanedIds = excludeSourceIds
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (cleanedIds.length === 0) {
    return evaluateActionSuggestion(input);
  }

  const next = evaluateWithExclusions(input, new Set(cleanedIds));
  if (next) return next;

  return evaluateActionSuggestion(input);
}
