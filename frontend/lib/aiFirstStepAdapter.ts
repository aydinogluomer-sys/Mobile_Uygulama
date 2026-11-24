/**
 * E11 (LEAF-02 / LEAF-03 / U04 / R09.05) — Şema doğrulamalı tek ilk adım
 * AI adapter'ı, sürüm/hesap koruması ve deterministik yerel fallback.
 *
 * Saf (pure) ve deterministik modül:
 *   - Ağ çağrısı, veritabanı yazımı, Zustand store, AsyncStorage veya saat
 *     okuması (`new Date()`, `Date.now()`) içermez.
 *   - Ham model çıktısı her zaman güvenilmeyen (`unknown`) kabul edilir:
 *     yetki, sahiplik, tamamlanma, puan, hedef, frekans veya tarih alanları
 *     (`user_id`, `id`, `completed`, `xp`, `total_xp`, `daily_goal`,
 *     `frequency_config`, `due_date`, `__proto__`, `constructor` vb.) içerirse
 *     kesin olarak reddedilir.
 *   - Çoklu alt görev listesi yerine yalnızca TEK başlatılabilir ilk mikro adım
 *     (`1..120` karakter) çıkarır; fazladan adımlar otomatik yazılmaz.
 *   - Süre tahmini yalnızca `1..60` dk geçerli tam sayı veya aralık ise
 *     `source: 'ai'` olarak taşınır; aksi halde yapay kesinlik üretilmeden
 *     `source: 'none'` («Tahmin yok») döner.
 *   - Görev eşleştirmede yalnız `task.user_id === context.userId` olan açık
 *     görevler dikkate alınır; birden çok aday varsa tahmin yürütülmez, tek
 *     netleştirme sorusu (`clarification_needed`) üretilir.
 *   - Sağlayıcı hatası (`timeout`, `offline`, `quota_exceeded`,
 *     `malformed_response`, `5xx`) durumunda aynı `requestId` korunur, aktif
 *     odak oturumu (`activeFocusRunning`) bozulmaz ve `taskDecomposition` +
 *     `smallStart` üzerinden yerel ilk adıma düşülür.
 */
import {
  resolveTaskQuery,
  staleness,
  taskFingerprint,
  type TaskLike,
} from './coachActionsV2';
import {
  DEFAULT_SMALL_STEP_MINUTES,
  MAX_SMALL_STEP_MINUTES,
  MAX_STEP_TITLE,
  validateSmallStep,
  type SmallStep,
  type SmallStepParent,
} from './smallStart';
import { deriveSplitSteps, shortTopic } from './taskDecomposition';
import { describeEstimateSource, type EstimateSourceLabel } from './taskDuration';
import type { Task } from './taskTypes';

// ---------------------------------------------------------------------------
// Sabitler ve sınırlar
// ---------------------------------------------------------------------------

export const MIN_FIRST_STEP_LENGTH = 1;
export const MAX_FIRST_STEP_LENGTH = MAX_STEP_TITLE;
export const MIN_AI_STEP_MINUTES = 1;
export const MAX_AI_STEP_MINUTES = MAX_SMALL_STEP_MINUTES;
export const MAX_RAW_STEPS_ARRAY_LENGTH = 20;
export const MAX_TASK_QUERY_LENGTH = 120;
export const CLARIFICATION_QUESTION = 'Hangi görev için ilk adımı hazırlayalım?' as const;

const MAX_NESTING_DEPTH = 6;

const FORBIDDEN_PROTOTYPE_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Modelin asla belirleyemeyeceği sahiplik, kimlik, durum, ödül, planlama ve
 * kaynak otoritesi alanları. Kök veya iç nesnelerin herhangi birinde geçerse
 * çıktı tamamen reddedilir.
 */
const FORBIDDEN_AUTHORITY_AND_WRITE_KEYS: ReadonlySet<string> = new Set([
  'user_id',
  'userId',
  'id',
  'task_id',
  'taskId',
  'habit_id',
  'habitId',
  'parent_task_id',
  'project_id',
  'conversation_id',
  'completed',
  'completed_at',
  'status',
  'is_subtask',
  'xp',
  'total_xp',
  'baseXp',
  'focus_points',
  'balance',
  'cost',
  'price',
  'daily_goal',
  'frequency_config',
  'due_date',
  'reminders',
  'time_block_start',
  'time_block_end',
  'priority',
  'list_type',
  'quadrant',
  'source',
  'estimate_source',
  'citations',
  'sources',
  'fabricated_source',
  'journal_entry_id',
  'table',
  'rpc',
  'sql',
]);

const ALLOWED_RAW_TOP_KEYS: ReadonlySet<string> = new Set([
  'type',
  'task_query',
  'taskQuery',
  'step',
  'step_title',
  'stepTitle',
  'first_step',
  'steps',
  'subtasks',
  'minutes',
  'estimated_minutes',
  'range_min',
  'rangeMin',
  'range_max',
  'rangeMax',
  'estimate',
]);

const ALLOWED_ESTIMATE_OBJECT_KEYS: ReadonlySet<string> = new Set([
  'minutes',
  'estimated_minutes',
  'range_min',
  'rangeMin',
  'range_max',
  'rangeMax',
]);

const ALLOWED_STEP_ITEM_KEYS: ReadonlySet<string> = new Set([
  'step',
  'title',
  'description',
  'minutes',
  'estimated_minutes',
  'range_min',
  'rangeMin',
  'range_max',
  'rangeMax',
]);

const ALLOWED_ACTION_TYPES: ReadonlySet<string> = new Set([
  'suggest_small_step',
  'suggest_first_step',
]);

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type AiFirstStepContext = {
  readonly userId: string;
  readonly localDayKey: string;
  /** Mantıksal istek kimliği; timeout/retry ve fallback akışlarında aynı kalır. */
  readonly requestId: string;
  readonly userPrompt: string;
  readonly openTasks: readonly Task[];
  /** Aktif odak oturumu varken gecikmiş/hatalı yanıt mevcut oturuma dokunmaz. */
  readonly activeFocusRunning?: boolean;
  /** Varsayılan `false`; günlük metni yalnız açık kullanıcı izni `true` ise bağlama girer. */
  readonly includeJournalContext?: boolean;
  /** İsteğe bağlı ham günlük metni; `includeJournalContext !== true` ise dışarı sızmaz. */
  readonly journalText?: string | null;
};

export type AiFirstStepPromptEnvelope = {
  readonly requestId: string;
  readonly localDayKey: string;
  readonly userPrompt: string;
  readonly includeJournalContext: boolean;
  readonly journalExcerpt: string | null;
  readonly openTaskTitles: readonly string[];
};

export type AiFirstStepEstimate =
  | {
      readonly source: 'ai';
      readonly minutes: number;
      readonly rangeMin: number | null;
      readonly rangeMax: number | null;
      readonly editable: true;
    }
  | {
      readonly source: 'none';
      readonly minutes: null;
      readonly rangeMin: null;
      readonly rangeMax: null;
      readonly editable: true;
    };

export const NO_AI_ESTIMATE: AiFirstStepEstimate = {
  source: 'none',
  minutes: null,
  rangeMin: null,
  rangeMax: null,
  editable: true,
};

export type RawAiFirstStepRejectionReason =
  | 'not_an_object'
  | 'forbidden_prototype_field'
  | 'forbidden_authority_field'
  | 'unexpected_field'
  | 'invalid_type'
  | 'invalid_task_query'
  | 'invalid_step';

export type ValidatedRawAiFirstStep = {
  readonly taskQuery: string | null;
  readonly stepTitle: string;
  readonly estimate: AiFirstStepEstimate;
  readonly droppedExtraStepsCount: number;
};

export type RawAiFirstStepValidationResult =
  | { readonly ok: true; readonly value: ValidatedRawAiFirstStep }
  | {
      readonly ok: false;
      readonly reason: RawAiFirstStepRejectionReason;
      readonly field?: string;
      readonly message: string;
    };

export type ClarificationTaskCandidate = {
  readonly id: string;
  readonly title: string;
  readonly due_date: string | null;
  readonly updated_at: string | null;
};

export type AiReadyFirstStepSuggestion = {
  readonly kind: 'ready_suggestion';
  readonly fallbackUsed: false;
  readonly requestId: string;
  readonly taskId: string;
  readonly parentTitle: string;
  readonly expectedFingerprint: string;
  readonly expectedVersion: string | null;
  readonly stepTitle: string;
  readonly estimate: AiFirstStepEstimate;
  readonly requiresConfirmation: true;
  readonly completesParentOnFinish: false;
  readonly droppedExtraStepsCount: number;
  readonly preserveActiveSession: boolean;
  readonly includeJournalContext: boolean;
};

export type AiClarificationNeededResult = {
  readonly kind: 'clarification_needed';
  readonly fallbackUsed: false;
  readonly requestId: string;
  readonly question: typeof CLARIFICATION_QUESTION;
  readonly candidates: readonly ClarificationTaskCandidate[];
  readonly stepTitle: string;
  readonly estimate: AiFirstStepEstimate;
  readonly preserveActiveSession: boolean;
  readonly includeJournalContext: boolean;
};

export type AiDraftFirstStepCandidate = {
  readonly kind: 'draft_candidate';
  readonly fallbackUsed: false;
  readonly requestId: string;
  readonly draftParentTitle: string;
  readonly stepTitle: string;
  readonly estimate: AiFirstStepEstimate;
  readonly requiresConfirmation: true;
  readonly completesParentOnFinish: false;
  readonly droppedExtraStepsCount: number;
  readonly preserveActiveSession: boolean;
  readonly includeJournalContext: boolean;
};

export type AiRejectedFirstStepResult = {
  readonly kind: 'rejected';
  readonly requestId: string;
  readonly reason: RawAiFirstStepRejectionReason;
  readonly field?: string;
  readonly message: string;
  readonly preserveActiveSession: boolean;
  readonly includeJournalContext: boolean;
};

export type AdaptedAiFirstStepResult =
  | AiReadyFirstStepSuggestion
  | AiClarificationNeededResult
  | AiDraftFirstStepCandidate
  | AiRejectedFirstStepResult;

export type SuggestionFreshnessStatus = 'fresh' | 'refresh_required' | 'task_gone';

export type StagedAiTaskExpectation = {
  readonly taskId: string;
  readonly expectedFingerprint: string;
  readonly expectedVersion: string | null;
  readonly userId?: string;
};

export type AiFallbackReason =
  | 'timeout'
  | 'offline'
  | 'quota_exceeded'
  | 'malformed_response'
  | '5xx'
  | 'provider_error';

export type LocalFallbackFirstStepResult = {
  readonly kind: 'local_fallback';
  readonly fallbackUsed: true;
  readonly source: 'local_splitter';
  readonly reason: AiFallbackReason;
  readonly rejectedAiReason?: RawAiFirstStepRejectionReason;
  readonly requestId: string;
  readonly retryRequestId: string;
  readonly preserveActiveSession: boolean;
  readonly includeJournalContext: boolean;
  readonly taskId: string | null;
  readonly parentTitle: string;
  readonly expectedFingerprint: string | null;
  readonly expectedVersion: string | null;
  readonly stepTitle: string;
  readonly smallStep: SmallStep;
  readonly estimate: AiFirstStepEstimate;
  readonly ambiguousCandidates: readonly ClarificationTaskCandidate[];
  readonly requiresConfirmation: true;
  readonly completesParentOnFinish: false;
};

export type AiProviderAttemptOutcome =
  | { readonly ok: true; readonly payload: unknown; readonly rawText?: undefined }
  | { readonly ok: true; readonly rawText: string; readonly payload?: undefined }
  | {
      readonly ok: false;
      readonly reason?: AiFallbackReason;
      readonly error?: unknown;
      readonly status?: number;
      readonly code?: string;
    };

export type ResolvedFirstStepOutcome =
  | AiReadyFirstStepSuggestion
  | AiClarificationNeededResult
  | AiDraftFirstStepCandidate
  | LocalFallbackFirstStepResult;

// ---------------------------------------------------------------------------
// İç yardımcılar
// ---------------------------------------------------------------------------

function isNonPrimitiveObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Error ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return false;
  }
  return true;
}

function hasCustomPrototype(value: Record<string, unknown>): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto !== null && proto !== Object.prototype;
}

type KeyViolation = {
  readonly reason: 'forbidden_prototype_field' | 'forbidden_authority_field';
  readonly field: string;
};

function scanDeepForbiddenKeys(value: unknown, depth: number = 0): KeyViolation | null {
  if (depth > MAX_NESTING_DEPTH) {
    return { reason: 'forbidden_prototype_field', field: '$depth' };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && i < MAX_RAW_STEPS_ARRAY_LENGTH + 5; i += 1) {
      const nested = scanDeepForbiddenKeys(value[i], depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (!isNonPrimitiveObject(value)) {
    return null;
  }
  if (hasCustomPrototype(value)) {
    return { reason: 'forbidden_prototype_field', field: '__proto__' };
  }

  const ownNames = Object.getOwnPropertyNames(value);
  for (const key of ownNames) {
    if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) {
      return { reason: 'forbidden_prototype_field', field: key };
    }
    if (FORBIDDEN_AUTHORITY_AND_WRITE_KEYS.has(key)) {
      return { reason: 'forbidden_authority_field', field: key };
    }
  }

  for (const key of ownNames) {
    const nested = scanDeepForbiddenKeys(value[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

function isValidAiStepMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_AI_STEP_MINUTES &&
    value <= MAX_AI_STEP_MINUTES
  );
}

function normalizeBoundedStepTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < MIN_FIRST_STEP_LENGTH || trimmed.length > MAX_FIRST_STEP_LENGTH) {
    return null;
  }
  return trimmed;
}

function parseDurationFieldsFromRecord(record: Record<string, unknown>): AiFirstStepEstimate {
  const rawMinutes =
    record.minutes !== undefined ? record.minutes : record.estimated_minutes;
  const rawRangeMin =
    record.rangeMin !== undefined ? record.rangeMin : record.range_min;
  const rawRangeMax =
    record.rangeMax !== undefined ? record.rangeMax : record.range_max;

  const hasRangeBound =
    (rawRangeMin !== undefined && rawRangeMin !== null) ||
    (rawRangeMax !== undefined && rawRangeMax !== null);

  if (hasRangeBound) {
    if (!isValidAiStepMinutes(rawRangeMin) || !isValidAiStepMinutes(rawRangeMax)) {
      return NO_AI_ESTIMATE;
    }
    if (rawRangeMin > rawRangeMax) {
      return NO_AI_ESTIMATE;
    }
    if (rawMinutes !== undefined && rawMinutes !== null) {
      if (
        !isValidAiStepMinutes(rawMinutes) ||
        rawMinutes < rawRangeMin ||
        rawMinutes > rawRangeMax
      ) {
        return NO_AI_ESTIMATE;
      }
      return {
        source: 'ai',
        minutes: rawMinutes,
        rangeMin: rawRangeMin,
        rangeMax: rawRangeMax,
        editable: true,
      };
    }
    return {
      source: 'ai',
      minutes: Math.round((rawRangeMin + rawRangeMax) / 2),
      rangeMin: rawRangeMin,
      rangeMax: rawRangeMax,
      editable: true,
    };
  }

  if (rawMinutes === undefined || rawMinutes === null) {
    return NO_AI_ESTIMATE;
  }
  if (!isValidAiStepMinutes(rawMinutes)) {
    return NO_AI_ESTIMATE;
  }
  return {
    source: 'ai',
    minutes: rawMinutes,
    rangeMin: null,
    rangeMax: null,
    editable: true,
  };
}

function resolveRawEstimate(
  root: Record<string, unknown>,
  chosenItemObject: Record<string, unknown> | null,
): AiFirstStepEstimate {
  if (root.estimate !== undefined && root.estimate !== null) {
    if (typeof root.estimate === 'number') {
      return isValidAiStepMinutes(root.estimate)
        ? {
            source: 'ai',
            minutes: root.estimate,
            rangeMin: null,
            rangeMax: null,
            editable: true,
          }
        : NO_AI_ESTIMATE;
    }
    if (!isNonPrimitiveObject(root.estimate)) {
      return NO_AI_ESTIMATE;
    }
    const unknownEstimateKey = Object.keys(root.estimate).find(
      (k) => !ALLOWED_ESTIMATE_OBJECT_KEYS.has(k),
    );
    if (unknownEstimateKey) {
      return NO_AI_ESTIMATE;
    }
    return parseDurationFieldsFromRecord(root.estimate);
  }

  const rootEstimate = parseDurationFieldsFromRecord(root);
  if (rootEstimate.source === 'ai') {
    return rootEstimate;
  }

  const rootHadExplicitInvalidDuration =
    (root.minutes !== undefined && root.minutes !== null) ||
    (root.estimated_minutes !== undefined && root.estimated_minutes !== null) ||
    (root.rangeMin !== undefined && root.rangeMin !== null) ||
    (root.range_min !== undefined && root.range_min !== null) ||
    (root.rangeMax !== undefined && root.rangeMax !== null) ||
    (root.range_max !== undefined && root.range_max !== null);

  if (rootHadExplicitInvalidDuration || !chosenItemObject) {
    return NO_AI_ESTIMATE;
  }

  return parseDurationFieldsFromRecord(chosenItemObject);
}

function ownedOpenTasksForUser(context: AiFirstStepContext): Task[] {
  const ownerId = context.userId.trim();
  if (!ownerId) return [];
  return context.openTasks.filter(
    (task) => task.user_id === ownerId && !task.completed && task.status !== 'cancelled',
  );
}

function mapClarificationCandidates(tasks: readonly Task[]): ClarificationTaskCandidate[] {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    due_date: task.due_date ?? null,
    updated_at: task.updated_at ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Günlük (journal) gizlilik zarfı ve süre etiketi yardımcıları
// ---------------------------------------------------------------------------

/**
 * R09.05 / E11 — Günlük metni varsayılan olarak bağlama GİRMEZ (`false`).
 * Yalnız kullanıcı açıkça `includeJournalContext: true` seçtiyse ve boş olmayan
 * bir metin varsa kırpılmış özet zarfına eklenir; görev başlıkları da yalnız
 * oturumdaki kullanıcıya ait açık görevlerle sınırlandırılır.
 */
export function resolveAiFirstStepPromptContext(
  context: AiFirstStepContext,
): AiFirstStepPromptEnvelope {
  const includeJournalContext = context.includeJournalContext === true;
  const rawJournal =
    includeJournalContext && typeof context.journalText === 'string'
      ? context.journalText.trim()
      : '';
  const ownedTasks = ownedOpenTasksForUser(context);

  return {
    requestId: context.requestId,
    localDayKey: context.localDayKey,
    userPrompt: context.userPrompt.trim(),
    includeJournalContext,
    journalExcerpt: rawJournal.length > 0 ? rawJournal.slice(0, 1000) : null,
    openTaskTitles: ownedTasks.slice(0, 25).map((t) => t.title),
  };
}

/** `AiFirstStepEstimate` değerini kullanıcıya gösterilebilir Türkçe etikete çevirir. */
export function formatAiEstimateLabel(estimate: AiFirstStepEstimate): string {
  const sourceLabel: EstimateSourceLabel = describeEstimateSource(estimate.source);
  if (estimate.source === 'none') {
    return sourceLabel;
  }
  if (
    estimate.rangeMin !== null &&
    estimate.rangeMax !== null &&
    estimate.rangeMin !== estimate.rangeMax
  ) {
    return `${estimate.rangeMin}-${estimate.rangeMax} dk (${sourceLabel})`;
  }
  return `${estimate.minutes} dk (${sourceLabel})`;
}

// ---------------------------------------------------------------------------
// 1. Ham model çıktısı şema doğrulayıcısı
// ---------------------------------------------------------------------------

export function validateRawAiFirstStepPayload(raw: unknown): RawAiFirstStepValidationResult {
  if (!isNonPrimitiveObject(raw)) {
    return {
      ok: false,
      reason: 'not_an_object',
      message: 'AI ilk adım yanıtı düz bir nesne olmalıdır.',
    };
  }

  const violation = scanDeepForbiddenKeys(raw);
  if (violation) {
    return {
      ok: false,
      reason: violation.reason,
      field: violation.field,
      message: `Model çıktısı yasaklı alan içeriyor: ${violation.field}`,
    };
  }

  const unexpectedTopKey = Object.keys(raw).find((k) => !ALLOWED_RAW_TOP_KEYS.has(k));
  if (unexpectedTopKey) {
    return {
      ok: false,
      reason: 'unexpected_field',
      field: unexpectedTopKey,
      message: `Model çıktısında beklenmeyen alan: ${unexpectedTopKey}`,
    };
  }

  if (raw.type !== undefined) {
    if (typeof raw.type !== 'string' || !ALLOWED_ACTION_TYPES.has(raw.type)) {
      return {
        ok: false,
        reason: 'invalid_type',
        field: 'type',
        message: 'Geçersiz AI eylem türü.',
      };
    }
  }

  const rawTaskQuery = raw.task_query !== undefined ? raw.task_query : raw.taskQuery;
  let taskQuery: string | null = null;
  if (rawTaskQuery !== undefined && rawTaskQuery !== null) {
    if (typeof rawTaskQuery !== 'string') {
      return {
        ok: false,
        reason: 'invalid_task_query',
        field: 'task_query',
        message: 'task_query metin olmalıdır.',
      };
    }
    const trimmedQuery = rawTaskQuery.trim();
    if (!trimmedQuery || trimmedQuery.length > MAX_TASK_QUERY_LENGTH) {
      return {
        ok: false,
        reason: 'invalid_task_query',
        field: 'task_query',
        message: 'task_query boş olamaz ve sınırı aşamaz.',
      };
    }
    taskQuery = trimmedQuery;
  }

  const directStepField =
    raw.step !== undefined
      ? raw.step
      : raw.step_title !== undefined
        ? raw.step_title
        : raw.stepTitle !== undefined
          ? raw.stepTitle
          : raw.first_step;

  let chosenStepTitle: string | null = null;
  let chosenStepItemObject: Record<string, unknown> | null = null;
  let droppedExtraStepsCount = 0;

  if (directStepField !== undefined && directStepField !== null) {
    const normalized = normalizeBoundedStepTitle(directStepField);
    if (!normalized) {
      return {
        ok: false,
        reason: 'invalid_step',
        field: 'step',
        message: `İlk adım 1..${MAX_FIRST_STEP_LENGTH} karakter aralığında somut bir metin olmalıdır.`,
      };
    }
    chosenStepTitle = normalized;
  }

  const rawArray = raw.steps !== undefined ? raw.steps : raw.subtasks;
  if (rawArray !== undefined && rawArray !== null) {
    if (
      !Array.isArray(rawArray) ||
      rawArray.length === 0 ||
      rawArray.length > MAX_RAW_STEPS_ARRAY_LENGTH
    ) {
      return {
        ok: false,
        reason: 'invalid_step',
        field: raw.steps !== undefined ? 'steps' : 'subtasks',
        message: 'Alt adım dizisi boş veya sınır dışı olamaz.',
      };
    }

    const validItems: { title: string; obj: Record<string, unknown> | null }[] = [];
    for (const item of rawArray) {
      if (typeof item === 'string') {
        const normalized = normalizeBoundedStepTitle(item);
        if (normalized) {
          validItems.push({ title: normalized, obj: null });
        }
      } else if (isNonPrimitiveObject(item)) {
        const unexpectedItemKey = Object.keys(item).find((k) => !ALLOWED_STEP_ITEM_KEYS.has(k));
        if (unexpectedItemKey) {
          return {
            ok: false,
            reason: 'unexpected_field',
            field: unexpectedItemKey,
            message: `Alt adım öğesinde beklenmeyen alan: ${unexpectedItemKey}`,
          };
        }
        const rawCandidate = item.step !== undefined ? item.step : item.title;
        const normalized = normalizeBoundedStepTitle(rawCandidate);
        if (normalized) {
          validItems.push({ title: normalized, obj: item });
        }
      } else {
        return {
          ok: false,
          reason: 'invalid_step',
          field: raw.steps !== undefined ? 'steps' : 'subtasks',
          message: 'Alt adım öğesi metin veya nesne olmalıdır.',
        };
      }
    }

    if (chosenStepTitle === null) {
      if (validItems.length === 0) {
        return {
          ok: false,
          reason: 'invalid_step',
          field: raw.steps !== undefined ? 'steps' : 'subtasks',
          message: 'Alt adım dizisinde geçerli somut bir ilk adım bulunamadı.',
        };
      }
      chosenStepTitle = validItems[0].title;
      chosenStepItemObject = validItems[0].obj;
      droppedExtraStepsCount = rawArray.length - 1;
    } else {
      droppedExtraStepsCount = rawArray.length;
    }
  }

  if (chosenStepTitle === null) {
    return {
      ok: false,
      reason: 'invalid_step',
      field: 'step',
      message: 'Başlatılabilir ilk mikro adım alanı eksik.',
    };
  }

  const estimate = resolveRawEstimate(raw, chosenStepItemObject);

  return {
    ok: true,
    value: {
      taskQuery,
      stepTitle: chosenStepTitle,
      estimate,
      droppedExtraStepsCount,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Görev eşleştirme, belirsizlik, taslak ve sürüm (staleness) koruması
// ---------------------------------------------------------------------------

export function adaptAiFirstStep(
  raw: unknown,
  context: AiFirstStepContext,
): AdaptedAiFirstStepResult {
  const preserveActiveSession = context.activeFocusRunning === true;
  const includeJournalContext = context.includeJournalContext === true;

  const validatedResult = validateRawAiFirstStepPayload(raw);
  if (!validatedResult.ok) {
    return {
      kind: 'rejected',
      requestId: context.requestId,
      reason: validatedResult.reason,
      field: validatedResult.field,
      message: validatedResult.message,
      preserveActiveSession,
      includeJournalContext,
    };
  }

  const { taskQuery, stepTitle, estimate, droppedExtraStepsCount } = validatedResult.value;
  const ownedOpenTasks = ownedOpenTasksForUser(context);
  const effectiveQuery = (taskQuery ?? context.userPrompt).trim();

  const resolution =
    effectiveQuery.length > 0
      ? resolveTaskQuery(effectiveQuery, ownedOpenTasks)
      : ({ kind: 'none' } as const);

  if (resolution.kind === 'ambiguous') {
    return {
      kind: 'clarification_needed',
      fallbackUsed: false,
      requestId: context.requestId,
      question: CLARIFICATION_QUESTION,
      candidates: mapClarificationCandidates(resolution.candidates),
      stepTitle,
      estimate,
      preserveActiveSession,
      includeJournalContext,
    };
  }

  if (resolution.kind === 'none') {
    const draftParentTitle =
      shortTopic(effectiveQuery, MAX_FIRST_STEP_LENGTH) ||
      shortTopic(context.userPrompt, MAX_FIRST_STEP_LENGTH) ||
      'Yeni görev';

    return {
      kind: 'draft_candidate',
      fallbackUsed: false,
      requestId: context.requestId,
      draftParentTitle,
      stepTitle,
      estimate,
      requiresConfirmation: true,
      completesParentOnFinish: false,
      droppedExtraStepsCount,
      preserveActiveSession,
      includeJournalContext,
    };
  }

  const matchedTask = resolution.task;
  return {
    kind: 'ready_suggestion',
    fallbackUsed: false,
    requestId: context.requestId,
    taskId: matchedTask.id,
    parentTitle: matchedTask.title,
    expectedFingerprint: taskFingerprint(matchedTask),
    expectedVersion: matchedTask.updated_at ?? null,
    stepTitle,
    estimate,
    requiresConfirmation: true,
    completesParentOnFinish: false,
    droppedExtraStepsCount,
    preserveActiveSession,
    includeJournalContext,
  };
}

/**
 * E11 — Onay anında kaynak görevin sahnelendiği andaki parmak izi ve sürümüyle
 * hâlâ birebir aynı olup olmadığını denetler. Görev silindiyse `'task_gone'`,
 * başka bir yerde düzenlendiyse / tamamlandıysa `'refresh_required'` döner.
 */
export function verifyStagedAiSuggestionFreshness(
  staged: StagedAiTaskExpectation,
  currentTask: (TaskLike & { readonly user_id?: string }) | null | undefined,
): SuggestionFreshnessStatus {
  if (!currentTask) {
    return 'task_gone';
  }
  if (currentTask.id !== staged.taskId) {
    return 'task_gone';
  }
  if (
    staged.userId !== undefined &&
    currentTask.user_id !== undefined &&
    staged.userId !== currentTask.user_id
  ) {
    return 'task_gone';
  }

  const state = staleness(staged.expectedFingerprint, currentTask, taskFingerprint);
  if (state === 'gone') {
    return 'task_gone';
  }
  if (state !== 'same') {
    return 'refresh_required';
  }
  if ((currentTask.updated_at ?? null) !== staged.expectedVersion) {
    return 'refresh_required';
  }
  return 'fresh';
}

// ---------------------------------------------------------------------------
// 3. Sağlayıcı hatası sınıflandırma ve deterministik yerel fallback (LEAF-03)
// ---------------------------------------------------------------------------

export function classifyAiFailureReason(errorOrOutcome: unknown): AiFallbackReason {
  if (
    errorOrOutcome === 'timeout' ||
    errorOrOutcome === 'offline' ||
    errorOrOutcome === 'quota_exceeded' ||
    errorOrOutcome === 'malformed_response' ||
    errorOrOutcome === '5xx' ||
    errorOrOutcome === 'provider_error'
  ) {
    return errorOrOutcome;
  }

  if (errorOrOutcome instanceof SyntaxError) {
    return 'malformed_response';
  }

  if (typeof errorOrOutcome === 'object' && errorOrOutcome !== null) {
    const obj = errorOrOutcome as {
      readonly reason?: unknown;
      readonly name?: unknown;
      readonly message?: unknown;
      readonly code?: unknown;
      readonly status?: unknown;
      readonly error?: unknown;
    };

    if (
      obj.reason === 'timeout' ||
      obj.reason === 'offline' ||
      obj.reason === 'quota_exceeded' ||
      obj.reason === 'malformed_response' ||
      obj.reason === '5xx' ||
      obj.reason === 'provider_error'
    ) {
      return obj.reason;
    }

    if (typeof obj.status === 'number') {
      if (obj.status === 402 || obj.status === 429) return 'quota_exceeded';
      if (obj.status === 408 || obj.status === 504) return 'timeout';
      if (obj.status >= 500 && obj.status <= 599) return '5xx';
    }

    const code = typeof obj.code === 'string' ? obj.code.toLowerCase() : '';
    if (
      code.includes('quota') ||
      code.includes('insufficient_credit') ||
      code.includes('rate_limit') ||
      code === '429' ||
      code === '402'
    ) {
      return 'quota_exceeded';
    }
    if (code.includes('timeout') || code === 'etimedout' || code === '408') {
      return 'timeout';
    }
    if (code.includes('offline') || code.includes('network')) {
      return 'offline';
    }
    if (/^5\d\d$/.test(code) || code === '5xx') {
      return '5xx';
    }
    if (code.includes('malformed') || code.includes('invalid_json')) {
      return 'malformed_response';
    }

    const name = typeof obj.name === 'string' ? obj.name : '';
    if (name === 'EdgeTimeoutError' || name === 'AbortError' || name === 'TimeoutError') {
      return 'timeout';
    }
    if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') {
      return 'offline';
    }
    if (name === 'SyntaxError') {
      return 'malformed_response';
    }

    const message = typeof obj.message === 'string' ? obj.message.toLowerCase() : '';
    if (message.includes('timeout') || message.includes('timed out') || message.includes('zaman aşımı')) {
      return 'timeout';
    }
    if (
      message.includes('network request failed') ||
      message.includes('failed to fetch') ||
      message.includes('offline') ||
      message.includes('çevrimdışı')
    ) {
      return 'offline';
    }
    if (
      message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('insufficient') ||
      message.includes('yetersiz') ||
      message.includes('kota')
    ) {
      return 'quota_exceeded';
    }
    if (message.includes('unexpected token') || message.includes('json')) {
      return 'malformed_response';
    }
    if (/\b5\d\d\b/.test(message)) {
      return '5xx';
    }

    if (obj.error !== undefined && obj.error !== errorOrOutcome) {
      return classifyAiFailureReason(obj.error);
    }
  }

  return 'provider_error';
}

/**
 * LEAF-03 — Sağlayıcı yanıt veremediğinde veya bozuk yanıt döndüğünde aynı
 * `requestId` ve aktif odak oturumu korunarak `taskDecomposition.deriveSplitSteps`
 * ve `smallStart.validateSmallStep` ile deterministik yerel ilk adım üretir.
 */
export function buildFallbackFirstStep(
  context: AiFirstStepContext,
  reason: AiFallbackReason,
  rejectedAiReason?: RawAiFirstStepRejectionReason,
): LocalFallbackFirstStepResult {
  const preserveActiveSession = context.activeFocusRunning === true;
  const includeJournalContext = context.includeJournalContext === true;
  const ownedOpenTasks = ownedOpenTasksForUser(context);
  const trimmedPrompt = context.userPrompt.trim();

  const resolution =
    trimmedPrompt.length > 0
      ? resolveTaskQuery(trimmedPrompt, ownedOpenTasks)
      : ({ kind: 'none' } as const);

  const matchedTask = resolution.kind === 'one' ? resolution.task : null;
  const ambiguousCandidates =
    resolution.kind === 'ambiguous' ? mapClarificationCandidates(resolution.candidates) : [];

  const parentTitle = matchedTask
    ? matchedTask.title
    : shortTopic(trimmedPrompt, MAX_FIRST_STEP_LENGTH) || 'Yeni görev';

  const splitSteps = deriveSplitSteps(parentTitle);
  const topic = shortTopic(parentTitle);
  const candidateStepTitle = topic ? `${splitSteps[0]} — ${topic}` : splitSteps[0];

  const parentRef: SmallStepParent = {
    kind: 'task',
    id: matchedTask ? matchedTask.id : 'draft',
    title: parentTitle,
  };

  const smallStepCheck = validateSmallStep(parentRef, {
    title: candidateStepTitle,
    minutes: DEFAULT_SMALL_STEP_MINUTES,
  });

  const validatedStep: SmallStep = smallStepCheck.ok
    ? smallStepCheck.step
    : {
        title: splitSteps[0],
        minutes: DEFAULT_SMALL_STEP_MINUTES,
        parent: parentRef,
      };

  return {
    kind: 'local_fallback',
    fallbackUsed: true,
    source: 'local_splitter',
    reason,
    ...(rejectedAiReason !== undefined ? { rejectedAiReason } : {}),
    requestId: context.requestId,
    retryRequestId: context.requestId,
    preserveActiveSession,
    includeJournalContext,
    taskId: matchedTask ? matchedTask.id : null,
    parentTitle,
    expectedFingerprint: matchedTask ? taskFingerprint(matchedTask) : null,
    expectedVersion: matchedTask ? (matchedTask.updated_at ?? null) : null,
    stepTitle: validatedStep.title,
    smallStep: validatedStep,
    estimate: NO_AI_ESTIMATE,
    ambiguousCandidates,
    requiresConfirmation: true,
    completesParentOnFinish: false,
  };
}

/**
 * Sağlayıcı denemesini (`ok: true` ham yük / JSON metni veya `ok: false` hata)
 * tek adımda doğrular; hata veya bozuk çıktı durumunda akışı kilitlemeden
 * `buildFallbackFirstStep` üzerinden yerel ilk adıma düşer.
 */
export function resolveFirstStepWithFallback(
  outcome: AiProviderAttemptOutcome,
  context: AiFirstStepContext,
): ResolvedFirstStepOutcome {
  if (!outcome.ok) {
    const reason = outcome.reason ?? classifyAiFailureReason(outcome);
    return buildFallbackFirstStep(context, reason);
  }

  let rawPayload: unknown = outcome.payload;
  if (typeof outcome.rawText === 'string') {
    try {
      rawPayload = JSON.parse(outcome.rawText) as unknown;
    } catch {
      return buildFallbackFirstStep(context, 'malformed_response');
    }
  }

  const adapted = adaptAiFirstStep(rawPayload, context);
  if (adapted.kind === 'rejected') {
    return buildFallbackFirstStep(context, 'malformed_response', adapted.reason);
  }

  return adapted;
}
