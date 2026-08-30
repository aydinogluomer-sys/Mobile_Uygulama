/**
 * §22 emission seam — `lib/analytics.ts`'s sink.
 *
 * Before this, `lib/analytics.ts` could only BUILD events; nothing could
 * receive one, so the whole event layer was inert. These are the properties
 * the seam must have for a real transport to be attachable later without
 * touching a single emission site.
 *
 * AC-E01  a built event reaches the attached sink, unchanged
 * AC-E02  the DEFAULT sink is silent — no transport is configured, and a
 *         chatty default would print a habit id on every tap
 * AC-E03  `emitEvent` never throws, whatever the sink does. Emission sits
 *         inside a habit completion; a telemetry failure is not a product
 *         failure.
 * AC-E04  `setAnalyticsSink(null)` restores the default — a test (or a
 *         logged-out session) can detach a transport
 * AC-E05  `buildEvent`'s throw on an undeclared name is NOT swallowed by the
 *         seam. That failure is a programming error and stays loud.
 */
import {
  buildEvent,
  emitEvent,
  setAnalyticsSink,
  consoleAnalyticsSink,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from '../../lib/analytics';

afterEach(() => setAnalyticsSink(null));

describe('AC-E01 — a built event reaches the sink unchanged', () => {
  it('hands the sink exactly the event that was built', () => {
    const seen: AnalyticsEvent[] = [];
    setAnalyticsSink((e) => { seen.push(e); });

    const built = buildEvent('habit_completed', {
      habit_id: '11111111-1111-1111-1111-111111111111',
      state: 'done',
      xp: 30,
    });
    emitEvent(built);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(built);
    expect(seen[0].name).toBe('habit_completed');
    expect(seen[0].props.xp).toBe(30);
  });

  it('emits once per call, not once per listener re-attach', () => {
    let count = 0;
    setAnalyticsSink(() => { count += 1; });
    setAnalyticsSink(() => { count += 1; });
    emitEvent(buildEvent('habit_missed', {}));
    expect(count).toBe(1);
  });
});

describe('AC-E02 — the default sink is silent', () => {
  it('does not write to the console when no transport is attached', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      emitEvent(buildEvent('habit_partial', { xp: 3 }));
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('the opt-in developer sink DOES log — so silence above is the default, not a broken sink', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      setAnalyticsSink(consoleAnalyticsSink);
      emitEvent(buildEvent('habit_partial', { xp: 3 }));
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('AC-E03 — the seam never becomes the crash', () => {
  it('swallows a throwing sink', () => {
    setAnalyticsSink(() => { throw new Error('transport exploded'); });
    expect(() => emitEvent(buildEvent('habit_completed', {}))).not.toThrow();
  });

  it('a throwing sink does not poison the next emission', () => {
    let delivered = 0;
    setAnalyticsSink(() => { throw new Error('boom'); });
    emitEvent(buildEvent('habit_completed', {}));
    setAnalyticsSink(() => { delivered += 1; });
    emitEvent(buildEvent('habit_completed', {}));
    expect(delivered).toBe(1);
  });
});

describe('AC-E04 — a transport can be detached', () => {
  it('setAnalyticsSink(null) stops delivery to the previous sink', () => {
    const seen: AnalyticsEvent[] = [];
    setAnalyticsSink((e) => { seen.push(e); });
    emitEvent(buildEvent('habit_completed', {}));
    setAnalyticsSink(null);
    emitEvent(buildEvent('habit_completed', {}));
    expect(seen).toHaveLength(1);
  });
});

describe('AC-E05 — an undeclared event name still fails loudly', () => {
  it('buildEvent throws before the seam is ever reached', () => {
    const seen: AnalyticsEvent[] = [];
    setAnalyticsSink((e) => { seen.push(e); });
    expect(() => buildEvent('habit_skipped' as AnalyticsEventName, {})).toThrow(/unknown event/);
    expect(seen).toHaveLength(0);
  });
});
