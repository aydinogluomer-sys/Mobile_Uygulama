/**
 * E19 (DEC-E19 / A3) — Görev süre tahmininin saf (pure), deterministik çözümü.
 *
 * Saf modül: I/O, Supabase istemcisi, Zustand store, AsyncStorage veya saat
 * okuma (`new Date()`, `Date.now()`) içermez.
 *
 * Öncelik sırası:
 *   1. Geçerli `estimated_minutes` (`1..1440` tam sayı) -> `estimate_source`
 *      (`'user' | 'ai' | 'block' | 'default'`, yoksa `'user'`), `isMissingEstimate: false`.
 *   2. Geçerli `time_block_start` ve `time_block_end` (`HH:MM`, bitiş > başlangıç,
 *      `1..1440` dk) -> dakika farkı, `source: 'block'`, `isMissingEstimate: false`.
 *   3. İkisi de yoksa:
 *      - `allowDefault !== false` -> `DEFAULT_TASK_ESTIMATE_MINUTES = 15`
 *        (`lib/capacity.ts` ile uyumlu), `source: 'default'`, `isMissingEstimate: true`;
 *      - `allowDefault === false` -> `minutes: null`, `source: 'none'`, `isMissingEstimate: true`.
 *
 * Gerçekleşen odak oturumu süresi (`elapsedMinutes`) görevin `estimated_minutes`
 * alanını ASLA kendiliğinden değiştirmez (`reconcileFocusElapsedWithEstimate`).
 */

export const MIN_TASK_ESTIMATE_MINUTES = 1;
export const MAX_TASK_ESTIMATE_MINUTES = 1440;
/** `lib/capacity.ts` içindeki `DEFAULT_TASK_MINUTES` (15) ile birebir uyumlu varsayılan tahmin. */
export const DEFAULT_TASK_ESTIMATE_MINUTES = 15;

export type PersistedEstimateSource = 'user' | 'ai' | 'block' | 'default';
export type TaskEstimateSource = PersistedEstimateSource | 'none';

export type EstimateSourceLabel =
  | 'Seçtiğin süre'
  | 'Önerilen süre'
  | 'Takvim bloğundan'
  | 'Varsayılan tahmin (15 dk)'
  | 'Tahmin yok';

export type TaskDurationInput = {
  readonly estimated_minutes?: number | null;
  readonly estimate_source?: string | null;
  readonly time_block_start?: string | null;
  readonly time_block_end?: string | null;
};

export type ResolveTaskDurationOptions = {
  /** `false` verilirse tahmin veya saat bloğu olmayan görevde `15` yerine `null` döner. */
  readonly allowDefault?: boolean;
};

export type ResolvedTaskDurationWithDefault = {
  readonly minutes: number;
  readonly source: PersistedEstimateSource;
  readonly isMissingEstimate: boolean;
  readonly label: EstimateSourceLabel;
};

export type ResolvedTaskDurationNone = {
  readonly minutes: null;
  readonly source: 'none';
  readonly isMissingEstimate: true;
  readonly label: EstimateSourceLabel;
};

export type ResolvedTaskDuration = ResolvedTaskDurationWithDefault | ResolvedTaskDurationNone;

export type EstimateConfirmationCandidate = {
  readonly proposedMinutes: number;
  readonly proposedSource: 'user';
  readonly requiresUserConfirmation: true;
};

export type FocusEstimateReconciliation = {
  /** Varsayılan eklenmeden mevcut görev süresi çözümü (`user` / `ai` / `block` / `none`). */
  readonly currentResolution: ResolvedTaskDuration;
  /** Kapasite/planlama hesabında kullanılan etkin dakika (`default` dahil). */
  readonly effectiveMinutes: number;
  /** Görev üzerinde kayıtlı geçerli `estimated_minutes` (yoksa `null`); dokunulmadan korunur. */
  readonly preservedEstimatedMinutes: number | null;
  /** Temizlenmiş gerçekleşen odak süresi (`>= 0` tam dakika). */
  readonly actualFocusMinutes: number;
  /** Açık veya blok süresine göre fark (`actualFocusMinutes - currentResolution.minutes`, yoksa `null`). */
  readonly deltaMinutes: number | null;
  /** Odak süresinin tahmini kendiliğinden değiştirmediğini belgeleyen sabit sözleşme bayrağı. */
  readonly autoMutated: false;
  /** Kullanıcı onaylarsa yazılabilecek süre adayı; eşitse veya geçersizse `null`. */
  readonly confirmationCandidate: EstimateConfirmationCandidate | null;
  /** Kullanıcıya gösterilebilir sakin karşılaştırma özeti. */
  readonly summary: string;
};

/** `1..1440` aralığında tam sayı dakika mı? */
export function isValidTaskEstimateMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_TASK_ESTIMATE_MINUTES &&
    value <= MAX_TASK_ESTIMATE_MINUTES
  );
}

/** Kalıcı kaynak kodunu doğrular; tanımsız veya bozuk değerde `'user'` döner. */
export function normalizePersistedEstimateSource(raw: unknown): PersistedEstimateSource {
  if (raw === 'user' || raw === 'ai' || raw === 'block' || raw === 'default') {
    return raw;
  }
  return 'user';
}

function parseClockMinutes(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
}

/**
 * Geçerli `HH:MM` (veya Postgres `HH:MM:00`) başlangıç/bitiş çiftinden dakika farkını hesaplar.
 * Bitiş > başlangıç ve fark `1..1440` aralığında değilse `null` döner.
 */
export function computeTimeBlockDurationMinutes(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined,
): number | null {
  const startTotal = parseClockMinutes(startRaw);
  const endTotal = parseClockMinutes(endRaw);
  if (startTotal === null || endTotal === null) return null;
  const diff = endTotal - startTotal;
  if (diff < MIN_TASK_ESTIMATE_MINUTES || diff > MAX_TASK_ESTIMATE_MINUTES) {
    return null;
  }
  return diff;
}

/** Kaynak kodunu kullanıcıya gösterilebilir sade Türkçe etikete çevirir. */
export function describeEstimateSource(
  source: TaskEstimateSource | null | undefined,
): EstimateSourceLabel {
  switch (source) {
    case 'user':
      return 'Seçtiğin süre';
    case 'ai':
      return 'Önerilen süre';
    case 'block':
      return 'Takvim bloğundan';
    case 'default':
      return 'Varsayılan tahmin (15 dk)';
    case 'none':
    default:
      return 'Tahmin yok';
  }
}

export function resolveTaskDuration(
  task: TaskDurationInput,
  options: { readonly allowDefault: false },
): ResolvedTaskDuration;
export function resolveTaskDuration(
  task: TaskDurationInput,
  options?: { readonly allowDefault?: true },
): ResolvedTaskDurationWithDefault;
export function resolveTaskDuration(
  task: TaskDurationInput,
  options?: ResolveTaskDurationOptions,
): ResolvedTaskDuration;
export function resolveTaskDuration(
  task: TaskDurationInput,
  options?: ResolveTaskDurationOptions,
): ResolvedTaskDuration {
  if (isValidTaskEstimateMinutes(task.estimated_minutes)) {
    const source = normalizePersistedEstimateSource(task.estimate_source);
    return {
      minutes: task.estimated_minutes,
      source,
      isMissingEstimate: false,
      label: describeEstimateSource(source),
    };
  }

  const blockMinutes = computeTimeBlockDurationMinutes(task.time_block_start, task.time_block_end);
  if (blockMinutes !== null) {
    return {
      minutes: blockMinutes,
      source: 'block',
      isMissingEstimate: false,
      label: describeEstimateSource('block'),
    };
  }

  if (options?.allowDefault === false) {
    return {
      minutes: null,
      source: 'none',
      isMissingEstimate: true,
      label: describeEstimateSource('none'),
    };
  }

  return {
    minutes: DEFAULT_TASK_ESTIMATE_MINUTES,
    source: 'default',
    isMissingEstimate: true,
    label: describeEstimateSource('default'),
  };
}

/** `lib/capacity.dailyLoad` için görevi deterministik `{ estimated_minutes }` öğesine dönüştürür. */
export function toTaskLoadItem(task: TaskDurationInput): { estimated_minutes: number } {
  return { estimated_minutes: resolveTaskDuration(task).minutes };
}

/**
 * Gerçekleşen odak süresini görev tahminiyle karşılaştırır; görevi ASLA mutate etmez.
 * Yalnızca kullanıcı onaylarsa uygulanabilecek isteğe bağlı bir aday üretir.
 */
export function reconcileFocusElapsedWithEstimate(
  task: TaskDurationInput,
  elapsedMinutes: number,
): FocusEstimateReconciliation {
  const currentResolution = resolveTaskDuration(task, { allowDefault: false });
  const effectiveMinutes = resolveTaskDuration(task).minutes;
  const preservedEstimatedMinutes = isValidTaskEstimateMinutes(task.estimated_minutes)
    ? task.estimated_minutes
    : null;

  const actualFocusMinutes =
    typeof elapsedMinutes === 'number' && Number.isFinite(elapsedMinutes) && elapsedMinutes > 0
      ? Math.min(MAX_TASK_ESTIMATE_MINUTES, Math.round(elapsedMinutes))
      : 0;

  const deltaMinutes =
    currentResolution.minutes !== null ? actualFocusMinutes - currentResolution.minutes : null;

  const canSuggestCandidate =
    actualFocusMinutes >= MIN_TASK_ESTIMATE_MINUTES &&
    actualFocusMinutes <= MAX_TASK_ESTIMATE_MINUTES &&
    actualFocusMinutes !== currentResolution.minutes;

  const confirmationCandidate: EstimateConfirmationCandidate | null = canSuggestCandidate
    ? {
        proposedMinutes: actualFocusMinutes,
        proposedSource: 'user',
        requiresUserConfirmation: true,
      }
    : null;

  let summary: string;
  if (currentResolution.minutes === null) {
    summary =
      actualFocusMinutes > 0
        ? `Odak oturumu ${actualFocusMinutes} dk sürdü; görevde kayıtlı süre tahmini yok. İstersen bu süreyi tahmin olarak kaydedebilirsin.`
        : 'Odak oturumu tamamlanmadı; görevde kayıtlı süre tahmini yok.';
  } else if (deltaMinutes === 0) {
    summary = `Odak oturumu ${actualFocusMinutes} dk sürdü; mevcut ${currentResolution.minutes} dk tahminiyle uyumlu.`;
  } else {
    summary = `Odak oturumu ${actualFocusMinutes} dk sürdü; mevcut ${currentResolution.minutes} dk tahmini kendiliğinden değiştirilmedi.`;
  }

  return {
    currentResolution,
    effectiveMinutes,
    preservedEstimatedMinutes,
    actualFocusMinutes,
    deltaMinutes,
    autoMutated: false,
    confirmationCandidate,
    summary,
  };
}
