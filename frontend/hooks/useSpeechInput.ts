/**
 * Dictation for the AI Coach composer.
 *
 * ## The one thing this hook must never do
 *
 * Send. Recognition fills the text box and stops there. A misheard sentence
 * that sends itself would spend 5 FP, and — now that the coach can propose
 * habit writes — could stage an action against a habit the user never named.
 * So the transcript lands in the composer and the user presses Send, or does
 * not. `onTranscript` is deliberately the ONLY output of this hook.
 *
 * ## Permission timing
 *
 * Nothing is requested until `start()` is called, which only happens on a tap.
 * The microphone is never opened at launch, never in the background, and no
 * audio is written anywhere by this app.
 *
 * ## Where the audio actually goes
 *
 * This wraps the OS recognisers — `SFSpeechRecognizer` on iOS,
 * `android.speech.SpeechRecognizer` on Android. Both MAY process audio on a
 * server depending on the device, the locale and whether an on-device model is
 * installed; `requiresOnDeviceRecognition` asks for local processing but is not
 * universally honoured. This hook therefore does not claim the audio stays on
 * the device, because for these two platforms that would not be true in
 * general. No third-party speech API is contacted and no key ships in the
 * bundle: the only parties are the user's own OS vendor and the user.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** BCP-47. The app's UI language, so dictation matches what people speak. */
export const SPEECH_LOCALE = 'tr-TR';

type PermissionLike = { granted?: boolean };

type SpeechModuleLike = {
  requestPermissionsAsync: () => Promise<PermissionLike>;
  start: (opts: Record<string, unknown>) => void;
  stop: () => void;
  abort?: () => void;
};

/**
 * Load the native module WITHOUT letting its absence break the screen.
 *
 * Jest, web and any build predating the config plugin have no native module.
 * A chat screen that throws on import because dictation is unavailable would
 * be a far worse defect than dictation being unavailable, so this resolves to
 * `null` and the microphone button hides itself.
 */
function loadModule(): SpeechModuleLike | null {
  try {
    // `require`, not `import`, on purpose: this dependency is OPTIONAL at
    // runtime and a static import cannot be guarded. Jest, web and any binary
    // built before the config plugin have no native module, and a chat screen
    // that fails to load because dictation is unavailable would be a worse
    // defect than dictation being unavailable.
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
    // Same optional-dependency reasoning as loadModule above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as { useSpeechRecognitionEvent?: (n: string, cb: (e: unknown) => void) => void };
    return typeof mod?.useSpeechRecognitionEvent === 'function' ? mod.useSpeechRecognitionEvent : null;
  } catch {
    return null;
  }
}

export type SpeechInputState = {
  /** False when there is no native module — the button should not be shown. */
  available: boolean;
  listening: boolean;
  /** User-facing, already in Turkish. Null when there is nothing to say. */
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
};

/**
 * Resolved ONCE, at module load, because that is what it is: a native module
 * either linked into this binary or not. Holding it in a ref made it look like
 * per-component state and meant reading `.current` during render, which is
 * exactly the pattern `react-hooks/refs` exists to catch.
 */
const MOD: SpeechModuleLike | null = loadModule();
/** No-op fallback keeps the hook call unconditional when there is no module. */
const useSpeechEvent = loadEventHook() ?? ((_name: string, _cb: (e: unknown) => void) => {});

export function useSpeechInput(onTranscript: (text: string) => void): SpeechInputState {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the newest callback without re-subscribing the native listener.
  const cbRef = useRef(onTranscript);
  useEffect(() => { cbRef.current = onTranscript; }, [onTranscript]);

  useSpeechEvent('result', (e: unknown) => {
    const ev = e as { results?: { transcript?: string }[]; isFinal?: boolean };
    const text = ev?.results?.[0]?.transcript;
    // Interim results are surfaced too: watching the words appear is what
    // tells someone the microphone is actually hearing them.
    if (typeof text === 'string' && text.length > 0) cbRef.current(text);
  });

  useSpeechEvent('error', (e: unknown) => {
    const ev = e as { error?: string };
    setListening(false);
    // "no-speech" is someone thinking, not a failure worth a red message.
    setError(ev?.error === 'no-speech' ? null : 'Ses anlaşılamadı. Yazarak da sorabilirsin.');
  });

  useSpeechEvent('end', () => setListening(false));

  const mod = MOD;

  const start = useCallback(async () => {
    if (!mod) return;
    setError(null);
    try {
      // Asked here and nowhere else: on the tap, never at launch.
      const perm = await mod.requestPermissionsAsync();
      if (!perm?.granted) {
        setError('Mikrofon izni verilmedi. Yazarak sormaya devam edebilirsin.');
        return;
      }
      mod.start({
        lang: SPEECH_LOCALE,
        interimResults: true,
        continuous: false,
        // Ask for local processing where the device offers it. Not a promise:
        // see this file's header.
        requiresOnDeviceRecognition: false,
      });
      setListening(true);
    } catch {
      // A native failure must leave the user exactly where they were: typing.
      setListening(false);
      setError('Ses tanıma başlatılamadı. Yazarak sorabilirsin.');
    }
  }, [mod]);

  const stop = useCallback(() => {
    setListening(false);
    try { mod?.stop(); } catch { /* stopping a stopped recogniser is not an error */ }
  }, [mod]);

  // Never leave the microphone open behind a screen the user has left.
  useEffect(() => () => { try { mod?.stop(); } catch { /* unmount */ } }, [mod]);

  return { available: !!mod, listening, error, start, stop };
}
