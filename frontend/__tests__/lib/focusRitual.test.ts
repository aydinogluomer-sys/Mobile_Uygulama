import { FLOW_COPY } from '../../lib/flowCopy';
import {
  EMPTY_TALLY,
  INTENT_MAX_LENGTH,
  acknowledgementFor,
  classifyAway,
  focusIntentKey,
  interruptionSummary,
  normalizeIntent,
  parseIntent,
  recordAway,
  serializeIntent,
} from '../../lib/focusRitual';

const JUDGING = /başarısız|kaybet|ceza|tembel|rezil|yine mi/i;

describe('focusRitual (PS-11, PS-15)', () => {
  it('(+) normalizes whitespace/controls, preserves surrogate emoji pairs at 80 code points, and round-trips JSON', () => {
    expect(normalizeIntent('  Rapor   taslağı\n')).toBe('Rapor taslağı');
    expect(normalizeIntent('İlk\u0007\u0000 paragraf\tbitir')).toBe(
      'İlk paragraf bitir',
    );

    const eightyEmojis = '🎯'.repeat(85);
    const clipped = normalizeIntent(eightyEmojis)!;
    expect(Array.from(clipped)).toHaveLength(INTENT_MAX_LENGTH);
    // No lone UTF-16 surrogate halves
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(clipped)).toBe(
      false,
    );

    expect(focusIntentKey('user-1')).toBe('aderyth.focus.intent.v1.user-1');
    const encoded = serializeIntent('Sunum slaytları', 1_800_000_000_000);
    expect(parseIntent(encoded)).toEqual({
      text: 'Sunum slaytları',
      at: 1_800_000_000_000,
    });
  });

  it('(+) records away tally, classifies causes, builds compassionate summary, and returns distinct acknowledgements', () => {
    const t1 = recordAway(EMPTY_TALLY, 15_000);
    expect(t1).toEqual({
      total: 1,
      byCause: { notification: 0, someone: 0, self: 0 },
      pendingAwayMs: 15_000,
    });

    const t2 = classifyAway(t1, 'self');
    expect(t2).toEqual({
      total: 1,
      byCause: { notification: 0, someone: 0, self: 1 },
      pendingAwayMs: null,
    });

    const t3 = classifyAway(recordAway(t2, 22_000), null);
    expect(t3.total).toBe(2);
    expect(t3.pendingAwayMs).toBeNull();

    expect(interruptionSummary(2)).toBe(
      'Bu oturumda 2 kez ayrıldın ve döndün.',
    );

    const acks = new Set([
      acknowledgementFor('yes'),
      acknowledgementFor('partly'),
      acknowledgementFor('no'),
    ]);
    expect(acks.size).toBe(3);
  });

  it('(-) rejects empty/corrupt inputs, ignores classifyAway without pending away, returns null for 0 away, and uses zero judging language', () => {
    expect(normalizeIntent('')).toBeNull();
    expect(normalizeIntent('   \n\t  ')).toBeNull();
    expect(normalizeIntent('\u0000\u0007')).toBeNull();

    expect(parseIntent(null)).toBeNull();
    expect(parseIntent('{bad-json')).toBeNull();
    expect(parseIntent(JSON.stringify({ v: 2, text: 'x', at: 1 }))).toBeNull();
    expect(parseIntent(JSON.stringify({ v: 1, text: '   ', at: 1 }))).toBeNull();
    expect(
      parseIntent(JSON.stringify({ v: 1, text: 'x', at: Number.NaN })),
    ).toBeNull();

    expect(classifyAway(EMPTY_TALLY, 'self')).toEqual(EMPTY_TALLY);
    expect(recordAway(EMPTY_TALLY, 0)).toEqual(EMPTY_TALLY);
    expect(recordAway(EMPTY_TALLY, -100)).toEqual(EMPTY_TALLY);

    expect(interruptionSummary(0)).toBeNull();
    expect(interruptionSummary(-1)).toBeNull();
    expect(interruptionSummary(Number.NaN)).toBeNull();

    for (const copy of Object.values(FLOW_COPY)) {
      expect(copy).not.toMatch(JUDGING);
    }
    expect(interruptionSummary(3)).not.toMatch(JUDGING);
  });
});
