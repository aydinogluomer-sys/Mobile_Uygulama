/**
 * Plan §24 Phase 4 "crash reporting" + §22's privacy boundary.
 *
 * The assertions that carry real weight here are the SCRUBBER ones. A crash
 * reporter is the one payload the app sends that it does not author: the
 * message string comes from whatever threw, and error messages routinely
 * quote the offending value back — which, in an app full of journal entries
 * and habit titles, means user prose ends up inside a diagnostic string. §22
 * forbids sending that. So these tests are written against real error-message
 * shapes (a `JSON.parse` failure, a PostgREST query error) rather than
 * synthetic strings, because those are the exact paths that would leak.
 */
import {
  scrubMessage,
  scrubStack,
  buildCrashReport,
  reportError,
  setCrashSink,
  installGlobalErrorHandlers,
  __resetGlobalHandlersForTest,
  type CrashReport,
} from '../../lib/crashReporting';

afterEach(() => {
  setCrashSink(null);
  __resetGlobalHandlersForTest();
});

describe('scrubMessage — user content must not survive', () => {
  it('redacts a journal excerpt quoted by a real JSON.parse error', () => {
    // Verbatim shape of what V8/Hermes produces for JSON.parse of prose.
    const raw =
      `Unexpected token 'B', "Bugün terapistimle konuştuğum şey beni çok etkiledi" is not valid JSON`;
    const { text, redacted } = scrubMessage(raw);
    expect(redacted).toBe(true);
    expect(text).not.toContain('terapistimle');
    expect(text).not.toContain('etkiledi');
    // The diagnostic spine survives — otherwise the report is useless and the
    // scrubber would just be deleting the feature.
    expect(text).toContain('is not valid JSON');
  });

  it('redacts a habit title carried in a PostgREST query string', () => {
    const raw =
      'PGRST116: JSON object requested from habits?title=eq.Sabah%20meditasyonu&select=*';
    const { text, redacted } = scrubMessage(raw);
    expect(redacted).toBe(true);
    expect(text).not.toContain('meditasyonu');
    expect(text).toContain('PGRST116');
    expect(text).toContain('title=');
  });

  it('redacts emails and bearer-style tokens', () => {
    const { text } = scrubMessage(
      'auth failed for aydinogluomer@gmail.com with eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    );
    expect(text).not.toContain('@gmail.com');
    expect(text).not.toContain('eyJhbGciOi');
  });

  it('caps runaway messages and marks them redacted', () => {
    const { text, redacted } = scrubMessage('x'.repeat(5000));
    expect(text.length).toBeLessThanOrEqual(301);
    expect(redacted).toBe(true);
  });

  it('leaves an ordinary short error untouched and does NOT claim redaction', () => {
    // The counter-assertion. Without it, a scrubber that returned
    // `{ text: '[redacted]', redacted: true }` for every input would pass
    // every test above — maximally "private" and completely useless.
    const { text, redacted } = scrubMessage('Network request failed');
    expect(text).toBe('Network request failed');
    expect(redacted).toBe(false);
  });

  it('handles an empty message without throwing', () => {
    expect(scrubMessage('').text).toBe('');
  });
});

describe('scrubStack', () => {
  it('drops absolute paths that contain the OS user name', () => {
    const stack = [
      'TypeError: x is not a function',
      '    at foo (C:\\Users\\Trade Bilisim\\Mobile_Uygulama\\frontend\\lib\\habitEngine.ts:12:3)',
      '    at bar (/Users/someone/app/store/logStore.ts:44:1)',
    ].join('\n');
    const out = scrubStack(stack)!;
    expect(out).not.toContain('Trade Bilisim');
    expect(out).not.toContain('/Users/someone');
    // The part a developer actually needs is kept.
    expect(out).toContain('habitEngine.ts:12:3');
    expect(out).toContain('logStore.ts:44:1');
  });

  it('truncates to the top frames', () => {
    const stack = Array.from({ length: 40 }, (_, i) => `    at f${i} (a.ts:${i}:1)`).join('\n');
    expect(scrubStack(stack)!.split('\n').length).toBeLessThanOrEqual(12);
  });

  it('returns undefined for a missing stack', () => {
    expect(scrubStack(undefined)).toBeUndefined();
  });
});

describe('buildCrashReport — anything can be thrown in JS', () => {
  it.each([
    ['string', 'boom', 'ThrownString'],
    ['null', null, 'ThrownValue'],
    ['number', 42, 'ThrownValue'],
    ['plain object', { code: 'X' }, 'ThrownObject'],
  ])('survives a thrown %s', (_label, thrown, expectedName) => {
    const r = buildCrashReport(thrown, 'manual');
    expect(r.name).toBe(expectedName);
    expect(typeof r.message).toBe('string');
    expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps an Error name and scrubbed message', () => {
    const r = buildCrashReport(new TypeError('undefined is not an object'), 'render', 'today');
    expect(r.name).toBe('TypeError');
    expect(r.message).toContain('undefined is not an object');
    expect(r.context).toBe('today');
    expect(r.source).toBe('render');
  });

  it('refuses a context that is not enum-shaped, so it cannot smuggle user text', () => {
    // A call site passing a habit title as `context` would route straight
    // past the message scrubber — the context field is not scrubbed, it is
    // shape-gated, and this proves the gate is real.
    const r = buildCrashReport(new Error('e'), 'manual', 'Sabah meditasyonu yapmayı unutma');
    expect(r.context).toBeUndefined();
  });

  it('does not throw on a circular thrown object', () => {
    const circular: Record<string, unknown> = { code: 'X' };
    circular.self = circular;
    expect(() => buildCrashReport(circular, 'manual')).not.toThrow();
  });
});

describe('reportError — the funnel must never become the crash', () => {
  it('sends the report to the configured sink', () => {
    const seen: CrashReport[] = [];
    setCrashSink((r) => seen.push(r));
    reportError(new Error('Network request failed'), 'unhandled', 'boot');
    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('unhandled');
    expect(seen[0].context).toBe('boot');
  });

  it('swallows a sink that throws', () => {
    // A reporting path that can itself throw turns one bug into two and hides
    // the first — inside an error handler, where nothing is left to catch it.
    setCrashSink(() => {
      throw new Error('sink exploded');
    });
    expect(() => reportError(new Error('original'))).not.toThrow();
  });

  it('restores the console sink when the sink is cleared', () => {
    setCrashSink(() => {});
    setCrashSink(null);
    expect(() => reportError(new Error('x'))).not.toThrow();
  });
});

describe('installGlobalErrorHandlers', () => {
  type Handler = (e: unknown, isFatal?: boolean) => void;

  function fakeErrorUtils() {
    let current: Handler | undefined;
    const eu = {
      getGlobalHandler: () => current,
      setGlobalHandler: (h: Handler) => {
        current = h;
      },
    };
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = eu;
    return { get: () => current, set: (h: Handler) => (current = h) };
  }

  it('chains to the previous handler instead of replacing it', () => {
    // Replacing RN's default handler would trade a missing report for a
    // missing red box / clean fatal — a strictly worse deal.
    const eu = fakeErrorUtils();
    const prev = jest.fn();
    eu.set(prev);

    const seen: CrashReport[] = [];
    setCrashSink((r) => seen.push(r));
    installGlobalErrorHandlers();

    eu.get()!(new Error('kaboom'), true);

    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('unhandled');
    expect(seen[0].context).toBe('fatal');
    expect(prev).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second install does not double-report', () => {
    // Two installs would chain the handler to itself: every error reported
    // twice, and the count silently wrong forever after.
    const eu = fakeErrorUtils();
    eu.set(() => {});
    const seen: CrashReport[] = [];
    setCrashSink((r) => seen.push(r));

    installGlobalErrorHandlers();
    installGlobalErrorHandlers();
    eu.get()!(new Error('once'));

    expect(seen).toHaveLength(1);
  });

  it('returns an uninstaller that puts the original handler back', () => {
    const eu = fakeErrorUtils();
    const prev = jest.fn();
    eu.set(prev);
    const uninstall = installGlobalErrorHandlers();
    uninstall();
    expect(eu.get()).toBe(prev);
  });
});
