import { registerAccountStorage } from './accountScope';
import { FLOW_COPY } from './flowCopy';

export const INTENT_MAX_LENGTH = 80;
export const BREATH_CYCLE_MS = 4000;
export const AWAY_PROMPT_AUTO_DISMISS_MS = 12000;

export function focusIntentKey(userId: string): string {
  return `aderyth.focus.intent.v1.${userId}`;
}

export type IntentAnswer = 'yes' | 'partly' | 'no';
export type InterruptionCause = 'notification' | 'someone' | 'self';

export type InterruptionTally = {
  total: number;
  byCause: Record<InterruptionCause, number>;
  pendingAwayMs: number | null;
};

export const EMPTY_TALLY: InterruptionTally = {
  total: 0,
  byCause: {
    notification: 0,
    someone: 0,
    self: 0,
  },
  pendingAwayMs: null,
};

export function normalizeIntent(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const withoutControls = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
  const collapsed = withoutControls.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  const codePoints = Array.from(collapsed);
  const sliced =
    codePoints.length > INTENT_MAX_LENGTH
      ? codePoints.slice(0, INTENT_MAX_LENGTH).join('').trim()
      : collapsed;
  return sliced.length > 0 ? sliced : null;
}

export function serializeIntent(text: string, at: number): string {
  return JSON.stringify({ v: 1, text, at });
}

export function parseIntent(raw: string | null): { text: string; at: number } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.v !== 1) return null;
    if (typeof obj.text !== 'string') return null;
    if (typeof obj.at !== 'number' || !Number.isFinite(obj.at)) return null;
    const text = normalizeIntent(obj.text);
    if (!text) return null;
    return { text, at: obj.at };
  } catch {
    return null;
  }
}

export function recordAway(t: InterruptionTally, awayMs: number): InterruptionTally {
  if (!Number.isFinite(awayMs) || awayMs <= 0) return t;
  return {
    total: t.total + 1,
    byCause: { ...t.byCause },
    pendingAwayMs: awayMs,
  };
}

export function classifyAway(
  t: InterruptionTally,
  cause: InterruptionCause | null,
): InterruptionTally {
  if (t.pendingAwayMs === null) return t;
  return {
    total: t.total,
    byCause: cause
      ? { ...t.byCause, [cause]: (t.byCause[cause] ?? 0) + 1 }
      : { ...t.byCause },
    pendingAwayMs: null,
  };
}

export function interruptionSummary(total: number): string | null {
  if (!Number.isFinite(total) || total < 1) return null;
  return `Bu oturumda ${Math.floor(total)} kez ayrıldın ve döndün.`;
}

export function acknowledgementFor(a: IntentAnswer): string {
  if (a === 'yes') return FLOW_COPY.intentAckYes;
  if (a === 'partly') return FLOW_COPY.intentAckPartly;
  return FLOW_COPY.intentAckNo;
}

// ---------------------------------------------------------------------------
// P06 — Optional, lightweight, dismissible focus starter guide (zero OS blockers)
// ---------------------------------------------------------------------------

export const FOCUS_GUIDE_DISMISSED_KEY = (userId: string): string =>
  `aderyth.focus.guideDismissed.v1.${userId}`;

export type FocusStarterGuideStep = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly durationSec: number;
};

export const DEFAULT_STARTER_GUIDE: readonly FocusStarterGuideStep[] = [
  {
    id: 'clear-desk',
    title: 'Masayı sadeleştir',
    body: 'Önünde yalnız şu anki işe ait nesneler kalsın.',
    durationSec: 10,
  },
  {
    id: 'single-target',
    title: 'Tek sekme veya dosya aç',
    body: 'Dikkatini dağıtacak diğer pencereleri sessizce kapat.',
    durationSec: 10,
  },
  {
    id: 'first-two-min',
    title: 'İlk 2 dakikaya başla',
    body: 'Bitirmeyi değil, yalnız ilk küçük adımı başlatmayı hedefle.',
    durationSec: 10,
  },
];

const LOW_ENERGY_STARTER_STEP: FocusStarterGuideStep = {
  id: 'first-two-min',
  title: 'İlk 2 dakikaya başla',
  body: 'Yalnız ilk küçük adımı başlat.',
  durationSec: 10,
};

export type ResolvedFocusStarterGuide = {
  readonly visible: boolean;
  readonly steps: readonly FocusStarterGuideStep[];
  readonly requiresExtraPermissions: false;
};

export function resolveFocusStarterGuide(opts: {
  enabled: boolean;
  dismissed: boolean;
  lowEnergy?: boolean;
}): ResolvedFocusStarterGuide {
  if (!opts.enabled || opts.dismissed) {
    return {
      visible: false,
      steps: [],
      requiresExtraPermissions: false,
    };
  }
  return {
    visible: true,
    steps: opts.lowEnergy ? [LOW_ENERGY_STARTER_STEP] : DEFAULT_STARTER_GUIDE,
    requiresExtraPermissions: false,
  };
}

registerAccountStorage({
  name: 'focusIntent',
  transient: true,
  keysFor: (uid) => [focusIntentKey(uid)],
});

registerAccountStorage({
  name: 'focusStarterGuide',
  transient: true,
  keysFor: (uid) => [FOCUS_GUIDE_DISMISSED_KEY(uid)],
});
