import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

type Listener = (ev: unknown) => void;
const mockListeners: Record<string, Listener[]> = {};

function emitSpeech(name: string, ev: unknown) {
  for (const fn of [...(mockListeners[name] ?? [])]) fn(ev);
}

const mockGetPermissions = jest.fn(async () => ({ status: 'undetermined', granted: false, canAskAgain: true }));
const mockRequestPermissions = jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true }));
const mockStart = jest.fn();
const mockStop = jest.fn();

jest.mock('expo-speech-recognition', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react') as typeof import('react');
  const nativeMod = {
    getPermissionsAsync: () => mockGetPermissions(),
    requestPermissionsAsync: () => mockRequestPermissions(),
    start: (opts: Record<string, unknown>) => mockStart(opts),
    stop: () => mockStop(),
  };
  return {
    get ExpoSpeechRecognitionModule() {
      return (globalThis as Record<string, unknown>).__mockSpeechAbsent === true ? undefined : nativeMod;
    },
    useSpeechRecognitionEvent: (name: string, cb: Listener) => {
      const ref = R.useRef(cb);
      ref.current = cb;
      R.useEffect(() => {
        const handler: Listener = (ev) => ref.current(ev);
        mockListeners[name] ??= [];
        mockListeners[name].push(handler);
        return () => {
          mockListeners[name] = (mockListeners[name] ?? []).filter((h) => h !== handler);
        };
      }, [name]);
    },
  };
});

import {
  classifySpeechError,
  composeDictation,
  splitAtSelection,
  useSpeechInput,
  type SpeechInputOptions,
  type SpeechInputState,
} from '../../hooks/useSpeechInput';

function Harness({
  onTranscript,
  options,
  onState,
}: {
  onTranscript: (t: string) => void;
  options?: SpeechInputOptions;
  onState: (s: SpeechInputState) => void;
}) {
  const s = useSpeechInput(onTranscript, options);
  React.useEffect(() => {
    onState(s);
  });
  return null;
}

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function mountHook(onTranscript: (t: string) => void, options?: SpeechInputOptions) {
  const stateRef: { current: SpeechInputState | null } = { current: null };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <Harness
        onTranscript={onTranscript}
        options={options}
        onState={(s) => {
          stateRef.current = s;
        }}
      />,
    );
  });
  mounted.push(tree);
  return { tree, stateRef };
}

beforeEach(() => {
  for (const k of Object.keys(mockListeners)) delete mockListeners[k];
  mockGetPermissions.mockReset().mockResolvedValue({ status: 'undetermined', granted: false, canAskAgain: true });
  mockRequestPermissions.mockReset().mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  mockStart.mockReset();
  mockStop.mockReset();
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((t) => t.unmount());
  });
});

describe('pure speech helpers — classifySpeechError, splitAtSelection, composeDictation', () => {
  it('classifies every error code with neutral calm Turkish copy (never "sorabilirsin") and silences benign stops', () => {
    const activeCodes: [string | undefined, string][] = [
      ['not-allowed', 'permission'],
      ['service-not-allowed', 'permission'],
      ['language-not-supported', 'language'],
      ['network', 'network'],
      ['audio-capture', 'audio'],
      ['busy', 'busy'],
      ['unknown-code', 'unknown'],
      [undefined, 'unknown'],
    ];
    for (const [code, expectedKind] of activeCodes) {
      const res = classifySpeechError(code);
      expect(res.kind).toBe(expectedKind);
      expect(typeof res.message).toBe('string');
      expect(res.message!.length).toBeGreaterThan(5);
      expect(res.message).not.toContain('sorabilirsin');
    }

    for (const silentCode of ['no-speech', 'aborted', 'speech-timeout']) {
      expect(classifySpeechError(silentCode)).toEqual({ kind: 'silent', message: null });
    }
  });

  it('splitAtSelection inserts at the END of selection without overwriting selected text and falls back to end on null/out-of-range', () => {
    expect(splitAtSelection('Merhaba dünya', { start: 8, end: 8 })).toEqual({
      before: 'Merhaba ',
      after: 'dünya',
    });
    // Selection range [0, 7] -> appends after index 7 rather than erasing "Merhaba"
    expect(splitAtSelection('Merhaba dünya', { start: 0, end: 7 })).toEqual({
      before: 'Merhaba',
      after: ' dünya',
    });
    expect(splitAtSelection('Merhaba', null)).toEqual({ before: 'Merhaba', after: '' });
    expect(splitAtSelection('Merhaba', { start: -1, end: 3 })).toEqual({ before: 'Merhaba', after: '' });
    expect(splitAtSelection('Merhaba', { start: 0, end: 99 })).toEqual({ before: 'Merhaba', after: '' });
  });

  it('composeDictation preserves existing text across cumulative interim transcripts and respects maxLength', () => {
    const baseEnd = { before: 'abc', after: '' };
    expect(composeDictation(baseEnd, 'd')).toBe('abc d');
    expect(composeDictation(baseEnd, 'de')).toBe('abc de');
    expect(composeDictation(baseEnd, 'def')).toBe('abc def');

    const baseMid = { before: 'Merhaba ', after: ' dünya' };
    expect(composeDictation(baseMid, 'güzel')).toBe('Merhaba güzel dünya');

    // maxLength truncates ONLY transcript, keeping before/after intact
    expect(composeDictation({ before: 'abc', after: 'yz' }, '123456789', 10)).toBe('abc 123 yz');
    // No room left -> existing text untouched
    expect(composeDictation({ before: '1234567890', after: '' }, 'ek', 10)).toBe('1234567890');
  });
});

describe('useSpeechInput hook — permissions, double-start guard, dictation base, and multi-owner isolation', () => {
  it('starts once when permission is granted and blocks rapid double-tap / re-start while listening', async () => {
    const cb = jest.fn();
    const { stateRef } = await mountHook(cb);

    expect(stateRef.current!.available).toBe(true);
    expect(mockRequestPermissions).not.toHaveBeenCalled();

    // Two unawaited start() calls in the same tick -> single native start
    await act(async () => {
      const p1 = stateRef.current!.start();
      const p2 = stateRef.current!.start();
      await Promise.all([p1, p2]);
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(stateRef.current!.listening).toBe(true);

    // Calling start() again while already listening does nothing
    await act(async () => {
      await stateRef.current!.start();
    });
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('distinguishes permanent permission denial (blocked=true) from retryable denial and reads mount status without prompting', async () => {
    mockGetPermissions.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false });
    const { stateRef: mountedBlocked } = await mountHook(jest.fn());
    expect(mountedBlocked.current!.blocked).toBe(true);
    expect(mockRequestPermissions).not.toHaveBeenCalled();

    // Retryable denial on tap -> permission kind, blocked=false
    mockRequestPermissions.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: true });
    const { stateRef: retryable } = await mountHook(jest.fn());
    await act(async () => {
      await retryable.current!.start();
    });
    expect(retryable.current!.blocked).toBe(false);
    expect(retryable.current!.errorKind).toBe('permission');
    expect(retryable.current!.error).not.toContain('sorabilirsin');
    expect(mockStart).not.toHaveBeenCalled();

    // Permanent denial on tap -> blocked=true, errorKind='blocked'
    mockRequestPermissions.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false });
    const { stateRef: permDenied } = await mountHook(jest.fn());
    await act(async () => {
      await permDenied.current!.start();
    });
    expect(permDenied.current!.blocked).toBe(true);
    expect(permDenied.current!.errorKind).toBe('blocked');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('composes interim results onto getBase without overwriting existing text, and falls back to raw transcript without getBase', async () => {
    const composedOut: string[] = [];
    const { stateRef } = await mountHook((t) => composedOut.push(t), {
      getBase: () => ({ before: 'abc', after: '' }),
      maxLength: 50,
    });

    await act(async () => {
      await stateRef.current!.start();
    });
    await act(async () => {
      emitSpeech('result', { results: [{ transcript: 'd' }], isFinal: false });
      emitSpeech('result', { results: [{ transcript: 'de' }], isFinal: false });
      emitSpeech('result', { results: [{ transcript: 'def' }], isFinal: true });
    });
    expect(composedOut).toEqual(['abc d', 'abc de', 'abc def']);

    await act(async () => {
      emitSpeech('end', {});
    });
    expect(stateRef.current!.listening).toBe(false);

    // Legacy caller without getBase receives raw transcript
    const rawOut: string[] = [];
    const { stateRef: legacyRef } = await mountHook((t) => rawOut.push(t));
    await act(async () => {
      await legacyRef.current!.start();
    });
    await act(async () => {
      emitSpeech('result', { results: [{ transcript: 'ham metin' }], isFinal: true });
    });
    expect(rawOut).toEqual(['ham metin']);
  });

  it('isolates events to the active owner, preempts cleanly when another composer starts, and stops on unmount', async () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const h1 = await mountHook(cb1);
    const h2 = await mountHook(cb2);

    await act(async () => {
      await h1.stateRef.current!.start();
    });
    await act(async () => {
      emitSpeech('result', { results: [{ transcript: 'yalnız birinci' }], isFinal: true });
    });
    expect(cb1).toHaveBeenCalledWith('yalnız birinci');
    expect(cb2).not.toHaveBeenCalled();

    // Starting mic in second composer cleanly stops first and transfers ownership
    await act(async () => {
      await h2.stateRef.current!.start();
    });
    expect(h1.stateRef.current!.listening).toBe(false);
    expect(h2.stateRef.current!.listening).toBe(true);

    cb1.mockClear();
    await act(async () => {
      emitSpeech('result', { results: [{ transcript: 'şimdi ikinci' }], isFinal: true });
    });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledWith('şimdi ikinci');

    // Unmounting active hook stops recognizer; expose contract has no send method
    expect('send' in (h2.stateRef.current as Record<string, unknown>)).toBe(false);
    mockStop.mockClear();
    await act(async () => {
      h2.tree.unmount();
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('gracefully reports available=false and no-ops start() when native module is absent', async () => {
    let isolatedHook!: typeof useSpeechInput;
    (globalThis as Record<string, unknown>).__mockSpeechAbsent = true;
    try {
      jest.isolateModules(() => {
        jest.doMock('react', () => React);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        isolatedHook = require('../../hooks/useSpeechInput').useSpeechInput;
      });
    } finally {
      delete (globalThis as Record<string, unknown>).__mockSpeechAbsent;
    }

    const holder: { value: SpeechInputState | null } = { value: null };
    function MissingHarness() {
      const s = isolatedHook(jest.fn());
      React.useEffect(() => {
        holder.value = s;
      });
      return null;
    }
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<MissingHarness />);
    });
    mounted.push(tree);

    expect(holder.value!.available).toBe(false);
    await act(async () => {
      await holder.value!.start();
    });
    expect(holder.value!.listening).toBe(false);
  });
});
