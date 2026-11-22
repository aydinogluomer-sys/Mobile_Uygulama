/**
 * Dictation for inline task capture and the AI Coach composer.
 *
 * ## The one thing this hook must never do
 *
 * Send. Recognition fills the text box and stops there. A misheard sentence
 * that sends itself would spend 5 FP in Coach or commit a mangled task, so the
 * transcript lands in the composer and the user decides. `onTranscript` is
 * deliberately the ONLY output callback of this hook, and transcripts are never
 * logged or forwarded to error reporting.
 *
 * ## Permission timing
 *
 * Nothing is requested until `start()` is called, which only happens on a tap.
 * Mount only inspects `getPermissionsAsync()` (if available) to hide the mic
 * button when OS permission was permanently denied (`canAskAgain === false`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/** BCP-47. The app's UI language, so dictation matches what people speak. */
export const SPEECH_LOCALE = 'tr-TR';

type PermissionLike = {
  granted?: boolean;
  canAskAgain?: boolean;
  status?: string;
  restricted?: boolean;
};

type SpeechModuleLike = {
  getPermissionsAsync?: () => Promise<PermissionLike>;
  requestPermissionsAsync: () => Promise<PermissionLike>;
  start: (opts: Record<string, unknown>) => void;
  stop: () => void;
  abort?: () => void;
};

export type SpeechErrorKind =
  | 'permission'
  | 'blocked'
  | 'language'
  | 'network'
  | 'audio'
  | 'busy'
  | 'silent'
  | 'unknown';

const BLOCKED_MESSAGE =
  'Mikrofon izni kapalı. Ayarlar, Aderyth, Mikrofon yolundan açabilirsin; yazarak devam edebilirsin.';

export function classifySpeechError(code: string | undefined): {
  kind: SpeechErrorKind;
  message: string | null;
} {
  if (code === 'no-speech' || code === 'aborted' || code === 'speech-timeout') {
    return { kind: 'silent', message: null };
  }
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return { kind: 'permission', message: 'Mikrofon izni verilmedi. Yazarak devam edebilirsin.' };
  }
  if (code === 'language-not-supported') {
    return {
      kind: 'language',
      message: 'Türkçe ses tanıma bu cihazda kullanılamıyor. Yazarak devam edebilirsin.',
    };
  }
  if (code === 'network') {
    return {
      kind: 'network',
      message: 'Ses tanıma için bağlantı gerekiyor. Yazarak devam edebilirsin.',
    };
  }
  if (code === 'audio-capture') {
    return {
      kind: 'audio',
      message: 'Mikrofon açılamadı. Başka bir uygulama kullanıyor olabilir.',
    };
  }
  if (code === 'busy') {
    return {
      kind: 'busy',
      message: 'Ses tanıma şu an meşgul; birazdan tekrar dene.',
    };
  }
  return { kind: 'unknown', message: 'Ses anlaşılamadı. Yazarak devam edebilirsin.' };
}

export type DictationBase = { before: string; after: string };

/** Seçimin SONUNA ekler (seçim ezilmez). selection null ya da geçersizse metnin sonu. */
export function splitAtSelection(
  text: string,
  selection: { start: number; end: number } | null,
): DictationBase {
  if (
    !selection ||
    typeof selection.start !== 'number' ||
    typeof selection.end !== 'number' ||
    Number.isNaN(selection.start) ||
    Number.isNaN(selection.end)
  ) {
    return { before: text, after: '' };
  }
  const pos = Math.max(selection.start, selection.end);
  if (selection.start < 0 || selection.end < 0 || pos > text.length) {
    return { before: text, after: '' };
  }
  return { before: text.slice(0, pos), after: text.slice(pos) };
}

function clipUtf16Safe(s: string, maxUnits: number): string {
  if (maxUnits <= 0) return '';
  if (s.length <= maxUnits) return s;
  const sliced = s.slice(0, maxUnits);
  // Avoid leaving a trailing lone high surrogate at the cut boundary
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

/** before + (gerekirse boşluk) + transkript + (gerekirse boşluk) + after; maxLength aşılırsa yalnız transkript kısalır. */
export function composeDictation(
  base: DictationBase,
  transcript: string,
  maxLength?: number,
): string {
  const clean = transcript.trim();
  if (!clean) return `${base.before}${base.after}`;

  const sepBefore = base.before.length > 0 && !/\s$/.test(base.before) ? ' ' : '';
  const sepAfter = base.after.length > 0 && !/^\s/.test(base.after) ? ' ' : '';

  if (maxLength !== undefined) {
    const budget = maxLength - base.before.length - base.after.length - sepBefore.length - sepAfter.length;
    if (budget <= 0) return `${base.before}${base.after}`;
    const clipped = clipUtf16Safe(clean, budget).trimEnd();
    if (!clipped) return `${base.before}${base.after}`;
    return `${base.before}${sepBefore}${clipped}${sepAfter}${base.after}`;
  }

  return `${base.before}${sepBefore}${clean}${sepAfter}${base.after}`;
}

function loadModule(): SpeechModuleLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: SpeechModuleLike };
    const m = mod?.ExpoSpeechRecognitionModule;
    return m && typeof m.start === 'function' ? m : null;
  } catch {
    return null;
  }
}

function loadEventHook(): ((name: string, cb: (e: unknown) => void) => void) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as {
      useSpeechRecognitionEvent?: (n: string, cb: (e: unknown) => void) => void;
    };
    return typeof mod?.useSpeechRecognitionEvent === 'function' ? mod.useSpeechRecognitionEvent : null;
  } catch {
    return null;
  }
}

function isWebSpeechSupported(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof globalThis === 'undefined') return false;
  const g = globalThis as Record<string, unknown>;
  return typeof g.SpeechRecognition === 'function' || typeof g.webkitSpeechRecognition === 'function';
}

export type SpeechInputOptions = {
  getBase?: () => DictationBase;
  maxLength?: number;
  enabled?: boolean;
};

export type SpeechInputState = {
  /** False when there is no native/web speech recognizer — the button should not be shown. */
  available: boolean;
  listening: boolean;
  /** User-facing, already in Turkish. Null when there is nothing to say. */
  error: string | null;
  errorKind?: SpeechErrorKind | null;
  blocked?: boolean;
  start: () => Promise<void>;
  stop: () => void;
};

const MOD: SpeechModuleLike | null = loadModule();
const useSpeechEvent = loadEventHook() ?? ((_name: string, _cb: (e: unknown) => void) => {});

/**
 * Module-level active owner: `expo-router` keeps multiple tabs mounted, and
 * `useSpeechRecognitionEvent` broadcasts native events to every mounted hook.
 * Only the active owner receives events, and starting dictation in another
 * composer cleanly stops the previous owner first.
 */
let activeOwner: { id: symbol; preempt: () => void } | null = null;

export function useSpeechInput(
  onTranscript: (text: string) => void,
  options?: SpeechInputOptions,
): SpeechInputState {
  const enabled = options?.enabled ?? true;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<SpeechErrorKind | null>(null);
  const [blocked, setBlocked] = useState(false);

  const ownerIdRef = useRef<symbol | null>(null);
  if (ownerIdRef.current === null) {
    ownerIdRef.current = Symbol('speech-owner');
  }
  const activeRef = useRef(false);
  const baseRef = useRef<DictationBase>({ before: '', after: '' });

  const cbRef = useRef(onTranscript);
  const optsRef = useRef(options);
  useEffect(() => {
    cbRef.current = onTranscript;
    optsRef.current = options;
  }, [onTranscript, options]);

  const mod = MOD;
  const available = Boolean(mod) && isWebSpeechSupported();

  // Read-only mount inspection: never prompts, only hides dead-end button if OS permanently denied.
  useEffect(() => {
    if (!enabled || !mod?.getPermissionsAsync) return;
    let alive = true;
    void mod
      .getPermissionsAsync()
      .then((perm) => {
        if (!alive) return;
        if (
          (perm?.status === 'denied' && perm?.canAskAgain === false) ||
          perm?.restricted === true
        ) {
          setBlocked(true);
        }
      })
      .catch(() => {
        // Ignore read failure; tap path handles permission explicitly.
      });
    return () => {
      alive = false;
    };
  }, [enabled, mod]);

  const releaseOwner = useCallback(() => {
    activeRef.current = false;
    if (activeOwner?.id === ownerIdRef.current) {
      activeOwner = null;
    }
  }, []);

  useSpeechEvent('result', (e: unknown) => {
    if (!activeRef.current || activeOwner?.id !== ownerIdRef.current) return;
    const ev = e as { results?: { transcript?: string }[]; isFinal?: boolean };
    const text = ev?.results?.[0]?.transcript;
    if (typeof text !== 'string' || text.length === 0) return;

    if (optsRef.current?.getBase) {
      cbRef.current(composeDictation(baseRef.current, text, optsRef.current.maxLength));
    } else {
      cbRef.current(text);
    }
  });

  useSpeechEvent('error', (e: unknown) => {
    if (!activeRef.current || activeOwner?.id !== ownerIdRef.current) return;
    const ev = e as { error?: string };
    releaseOwner();
    setListening(false);
    const classified = classifySpeechError(ev?.error);
    setErrorKind(classified.kind === 'silent' ? null : classified.kind);
    setError(classified.message);
  });

  useSpeechEvent('end', () => {
    if (!activeRef.current || activeOwner?.id !== ownerIdRef.current) return;
    releaseOwner();
    setListening(false);
  });

  const start = useCallback(async () => {
    if (!mod || !available || !enabled) return;
    // Rapid double-tap or calling start() while already active on this instance: no-op
    if (activeRef.current) return;

    // If another composer is currently listening, stop it cleanly before claiming ownership
    if (activeOwner && activeOwner.id !== ownerIdRef.current) {
      activeOwner.preempt();
    }

    const myId = ownerIdRef.current!;
    activeRef.current = true;
    activeOwner = {
      id: myId,
      preempt: () => {
        activeRef.current = false;
        setListening(false);
        try {
          mod.stop();
        } catch {
          /* ignore */
        }
      },
    };

    if (optsRef.current?.getBase) {
      baseRef.current = optsRef.current.getBase();
    } else {
      baseRef.current = { before: '', after: '' };
    }

    setError(null);
    setErrorKind(null);

    try {
      const perm = await mod.requestPermissionsAsync();
      if (activeOwner?.id !== myId || !activeRef.current) return;

      if (!perm?.granted) {
        releaseOwner();
        if (perm?.canAskAgain === false || perm?.restricted === true) {
          setBlocked(true);
          setErrorKind('blocked');
          setError(BLOCKED_MESSAGE);
        } else {
          const denied = classifySpeechError('not-allowed');
          setErrorKind(denied.kind);
          setError(denied.message);
        }
        return;
      }

      mod.start({
        lang: SPEECH_LOCALE,
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: false,
      });
      setListening(true);
    } catch {
      releaseOwner();
      setListening(false);
      const fallback = classifySpeechError('unknown');
      setErrorKind(fallback.kind);
      setError(fallback.message);
    }
  }, [available, enabled, mod, releaseOwner]);

  const stop = useCallback(() => {
    const wasActive = activeRef.current;
    releaseOwner();
    setListening(false);
    if (wasActive) {
      try {
        mod?.stop();
      } catch {
        /* stopping a stopped recogniser is not an error */
      }
    }
  }, [mod, releaseOwner]);

  // Never leave the microphone open behind a screen the user has left.
  useEffect(
    () => () => {
      if (activeRef.current) {
        releaseOwner();
        try {
          mod?.stop();
        } catch {
          /* unmount */
        }
      }
    },
    [mod, releaseOwner],
  );

  return { available, listening, error, errorKind, blocked, start, stop };
}
