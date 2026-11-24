/**
 * U14 / E17 — Pure, deterministic routine cue policy (quiet-hour awareness,
 * screen-reader harmony, lock-screen/widget private title masking) and
 * cross-surface single-action deduplication coordinator.
 *
 * Pure: no I/O, no native modules, no spoken TTS packages.
 */
import { inQuietHours, parseTime } from './reminderPlan';

export type SurfaceOrigin = 'in_app' | 'notification' | 'lock_screen' | 'widget';

export type RoutineCueEvent = 'step_start' | 'time_up' | 'pause';

export type RoutineCueSettings = {
  soundCueEnabled: boolean;
  hapticEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  hidePrivateStepTitles: boolean;
  screenReaderActive: boolean;
};

export const DEFAULT_ROUTINE_CUE_SETTINGS: RoutineCueSettings = {
  soundCueEnabled: true,
  hapticEnabled: true,
  quietStart: null,
  quietEnd: null,
  hidePrivateStepTitles: true,
  screenReaderActive: false,
};

export const MASKED_ROUTINE_STEP_TITLE = 'Rutin adımı devam ediyor';
export const MASKED_REMINDER_TITLE = 'Hatırlatıcı';

export type RoutineStepCueParams = {
  stepId: string;
  stepTitle: string;
  remainingSec: number | null;
  nowHm: string;
  settings: RoutineCueSettings;
  event: RoutineCueEvent;
  surface?: SurfaceOrigin;
};

export type RoutineStepCueDecision = {
  stepId: string;
  event: RoutineCueEvent;
  playSound: boolean;
  playHaptic: boolean;
  hapticStyle: 'light' | 'warning' | 'none';
  visualCue: 'calm_active' | 'calm_time_up' | 'calm_paused';
  inQuietWindow: boolean;
  suppressedByQuietHours: boolean;
  suppressedByScreenReader: boolean;
  inAppTitle: string;
  externalSurfaceTitle: string;
  surfaceTitle: string;
  screenReaderAnnouncement: string | null;
};

export function maskPrivateSurfaceTitle(
  rawTitle: string,
  opts?: {
    surface?: SurfaceOrigin;
    hidePrivateStepTitles?: boolean;
    fallbackKind?: 'routine_step' | 'reminder';
  },
): string {
  const trimmed = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const fallback =
    opts?.fallbackKind === 'reminder' ? MASKED_REMINDER_TITLE : MASKED_ROUTINE_STEP_TITLE;
  const surface = opts?.surface ?? 'lock_screen';
  if (surface === 'in_app') {
    return trimmed || fallback;
  }
  const shouldMask = opts?.hidePrivateStepTitles ?? true;
  if (shouldMask) {
    return fallback;
  }
  return trimmed || fallback;
}

export function parseReminderQuietPrefs(
  raw: string | null,
): Pick<RoutineCueSettings, 'quietStart' | 'quietEnd' | 'hidePrivateStepTitles'> {
  if (!raw || typeof raw !== 'string') {
    return {
      quietStart: null,
      quietEnd: null,
      hidePrivateStepTitles: true,
    };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { quietStart: null, quietEnd: null, hidePrivateStepTitles: true };
    }
    const obj = parsed as Record<string, unknown>;
    const quietStart =
      typeof obj.quietStart === 'string' && parseTime(obj.quietStart) ? obj.quietStart : null;
    const quietEnd =
      typeof obj.quietEnd === 'string' && parseTime(obj.quietEnd) ? obj.quietEnd : null;
    const hidePrivateStepTitles = obj.hideTitles === undefined ? true : obj.hideTitles === true;
    return { quietStart, quietEnd, hidePrivateStepTitles };
  } catch {
    return { quietStart: null, quietEnd: null, hidePrivateStepTitles: true };
  }
}

export function resolveRoutineStepCue(params: RoutineStepCueParams): RoutineStepCueDecision {
  const { stepId, stepTitle, nowHm, settings, event } = params;
  const surface = params.surface ?? 'in_app';
  const cleanTitle = stepTitle.trim() || MASKED_ROUTINE_STEP_TITLE;
  const inQuietWindow = inQuietHours(nowHm, {
    quietStart: settings.quietStart,
    quietEnd: settings.quietEnd,
  });

  const externalSurfaceTitle = maskPrivateSurfaceTitle(cleanTitle, {
    surface: surface === 'in_app' ? 'lock_screen' : surface,
    hidePrivateStepTitles: settings.hidePrivateStepTitles,
    fallbackKind: 'routine_step',
  });
  const surfaceTitle = surface === 'in_app' ? cleanTitle : externalSurfaceTitle;

  if (event === 'pause') {
    return {
      stepId,
      event,
      playSound: false,
      playHaptic: false,
      hapticStyle: 'none',
      visualCue: 'calm_paused',
      inQuietWindow,
      suppressedByQuietHours: inQuietWindow,
      suppressedByScreenReader: false,
      inAppTitle: cleanTitle,
      externalSurfaceTitle,
      surfaceTitle,
      screenReaderAnnouncement: settings.screenReaderActive ? 'Oturum duraklatıldı' : null,
    };
  }

  if (event === 'step_start') {
    const suppressedByQuietHours = settings.soundCueEnabled && inQuietWindow;
    // U14: When VoiceOver/TalkBack is active, never play overlapping chime/audio on step_start
    // so "Sıradaki adım: ..." announcement is never drowned out.
    const suppressedByScreenReader = settings.soundCueEnabled && settings.screenReaderActive;
    const playSound =
      settings.soundCueEnabled && !inQuietWindow && !settings.screenReaderActive;
    const playHaptic =
      settings.hapticEnabled && !inQuietWindow && !settings.screenReaderActive;

    return {
      stepId,
      event,
      playSound,
      playHaptic,
      hapticStyle: playHaptic ? 'light' : 'none',
      visualCue: 'calm_active',
      inQuietWindow,
      suppressedByQuietHours,
      suppressedByScreenReader,
      inAppTitle: cleanTitle,
      externalSurfaceTitle,
      surfaceTitle,
      screenReaderAnnouncement: settings.screenReaderActive
        ? `Sıradaki adım: ${cleanTitle}`
        : null,
    };
  }

  // event === 'time_up'
  const suppressedByQuietHours =
    (settings.soundCueEnabled || settings.hapticEnabled) && inQuietWindow;
  const suppressedByScreenReader = settings.soundCueEnabled && settings.screenReaderActive;
  const playSound =
    settings.soundCueEnabled && !inQuietWindow && !settings.screenReaderActive;
  const playHaptic = settings.hapticEnabled && !inQuietWindow;

  return {
    stepId,
    event,
    playSound,
    playHaptic,
    hapticStyle: !playHaptic ? 'none' : settings.screenReaderActive ? 'light' : 'warning',
    visualCue: 'calm_time_up',
    inQuietWindow,
    suppressedByQuietHours,
    suppressedByScreenReader,
    inAppTitle: cleanTitle,
    externalSurfaceTitle,
    surfaceTitle,
    screenReaderAnnouncement: settings.screenReaderActive
      ? 'Süre doldu. Tamamlamak sana kalmış.'
      : null,
  };
}

// ---------------------------------------------------------------------------
// E17 — Cross-Surface Single-Action Coordinator
// ---------------------------------------------------------------------------

export type CrossSurfaceTargetKind = 'habit' | 'routine_step' | 'focus';
export type CrossSurfaceActionKind = 'done' | 'skip' | 'pause' | 'resume' | 'snooze';

export type CrossSurfaceActionInput = {
  userId: string;
  localDayKey: string;
  targetKind: CrossSurfaceTargetKind;
  targetId: string;
  action: CrossSurfaceActionKind;
  surface: SurfaceOrigin;
  flagEnabled?: boolean;
};

export type SurfaceActionOutcome =
  | 'accepted'
  | 'duplicate_ignored'
  | 'rejected_account_mismatch'
  | 'rejected_disabled_surface';

export type SurfaceActionResult = {
  outcome: SurfaceActionOutcome;
  actionId: string;
  executed: boolean;
  surface: SurfaceOrigin;
};

export type SurfaceSnapshot = {
  userId: string;
  localDayKey: string;
  title: string;
  subtitle: string | null;
  updatedAtMs: number;
};

export type SurfaceActionGateOptions = {
  activeUserId?: string | null;
  externalSurfacesEnabled?: boolean;
  maxEntries?: number;
};

export type SurfaceActionGate = {
  dispatch: (input: CrossSurfaceActionInput, onAccept?: () => void) => SurfaceActionResult;
  publishSnapshot: (params: {
    userId: string;
    localDayKey: string;
    rawTitle: string;
    subtitle?: string | null;
    hidePrivateStepTitles?: boolean;
    fallbackKind?: 'routine_step' | 'reminder';
    flagEnabled?: boolean;
    nowMs?: number;
  }) => SurfaceSnapshot | null;
  getSnapshot: () => SurfaceSnapshot | null;
  setAccount: (nextUserId: string | null) => void;
  setFlagEnabled: (enabled: boolean) => void;
  getActiveUserId: () => string | null;
  isFlagEnabled: () => boolean;
  reset: () => void;
};

export function buildCanonicalSurfaceActionId(
  input: Pick<
    CrossSurfaceActionInput,
    'userId' | 'localDayKey' | 'targetKind' | 'targetId' | 'action'
  >,
): string {
  return `act:${input.userId.trim()}:${input.localDayKey.trim()}:${input.targetKind}:${input.targetId.trim()}:${input.action}`;
}

export function createSurfaceActionGate(opts?: SurfaceActionGateOptions): SurfaceActionGate {
  const maxEntries = Math.max(16, opts?.maxEntries ?? 256);
  let activeUserId: string | null = opts?.activeUserId ?? null;
  let externalSurfacesEnabled: boolean = opts?.externalSurfacesEnabled ?? true;
  let snapshot: SurfaceSnapshot | null = null;
  const seenOrder: string[] = [];
  const seenSet = new Set<string>();

  function clearSeen(): void {
    seenOrder.length = 0;
    seenSet.clear();
  }

  function rememberAction(actionId: string): void {
    if (seenSet.has(actionId)) return;
    seenSet.add(actionId);
    seenOrder.push(actionId);
    while (seenOrder.length > maxEntries) {
      const oldest = seenOrder.shift();
      if (oldest !== undefined) seenSet.delete(oldest);
    }
  }

  function clearOppositeToggle(input: CrossSurfaceActionInput): void {
    if (input.action !== 'pause' && input.action !== 'resume') return;
    const opposite: CrossSurfaceActionKind = input.action === 'pause' ? 'resume' : 'pause';
    const oppositeId = buildCanonicalSurfaceActionId({ ...input, action: opposite });
    if (seenSet.delete(oppositeId)) {
      const idx = seenOrder.indexOf(oppositeId);
      if (idx >= 0) seenOrder.splice(idx, 1);
    }
  }

  return {
    dispatch(input, onAccept) {
      const actionId = buildCanonicalSurfaceActionId(input);

      const surfaceDisabled =
        input.flagEnabled === false ||
        (!externalSurfacesEnabled && input.surface !== 'in_app');
      if (surfaceDisabled) {
        snapshot = null;
        return {
          outcome: 'rejected_disabled_surface',
          actionId,
          executed: false,
          surface: input.surface,
        };
      }

      const incomingUser = input.userId.trim();
      if (!incomingUser || (activeUserId !== null && incomingUser !== activeUserId)) {
        if (snapshot && snapshot.userId !== activeUserId) {
          snapshot = null;
        }
        return {
          outcome: 'rejected_account_mismatch',
          actionId,
          executed: false,
          surface: input.surface,
        };
      }

      if (activeUserId === null) {
        activeUserId = incomingUser;
      }

      if (seenSet.has(actionId)) {
        return {
          outcome: 'duplicate_ignored',
          actionId,
          executed: false,
          surface: input.surface,
        };
      }

      clearOppositeToggle(input);
      rememberAction(actionId);
      onAccept?.();
      return {
        outcome: 'accepted',
        actionId,
        executed: true,
        surface: input.surface,
      };
    },

    publishSnapshot(params) {
      const enabled =
        params.flagEnabled === undefined
          ? externalSurfacesEnabled
          : params.flagEnabled && externalSurfacesEnabled;
      if (!enabled) {
        snapshot = null;
        return null;
      }
      const uid = params.userId.trim();
      if (!uid || (activeUserId !== null && uid !== activeUserId)) {
        snapshot = null;
        return null;
      }
      if (activeUserId === null) {
        activeUserId = uid;
      }
      const maskedTitle = maskPrivateSurfaceTitle(params.rawTitle, {
        surface: 'widget',
        hidePrivateStepTitles: params.hidePrivateStepTitles ?? true,
        fallbackKind: params.fallbackKind ?? 'routine_step',
      });
      snapshot = {
        userId: uid,
        localDayKey: params.localDayKey.trim(),
        title: maskedTitle,
        subtitle: params.subtitle ?? null,
        updatedAtMs: params.nowMs ?? 0,
      };
      return snapshot;
    },

    getSnapshot() {
      return snapshot;
    },

    setAccount(nextUserId) {
      const normalized = nextUserId?.trim() ? nextUserId.trim() : null;
      if (normalized !== activeUserId) {
        activeUserId = normalized;
        snapshot = null;
        clearSeen();
      } else if (normalized === null) {
        snapshot = null;
        clearSeen();
      }
    },

    setFlagEnabled(enabled) {
      externalSurfacesEnabled = enabled;
      if (!enabled) {
        snapshot = null;
        clearSeen();
      }
    },

    getActiveUserId() {
      return activeUserId;
    },

    isFlagEnabled() {
      return externalSurfacesEnabled;
    },

    reset() {
      activeUserId = null;
      externalSurfacesEnabled = true;
      snapshot = null;
      clearSeen();
    },
  };
}
