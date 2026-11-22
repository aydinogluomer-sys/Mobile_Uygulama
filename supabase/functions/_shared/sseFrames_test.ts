import { drainFrames, encodeFrame, SSE_EVENTS } from './sseFrames.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertEquals(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Assertion failed (${msg}): expected ${e}, got ${a}`);
  }
}

Deno.test('SSE_EVENTS pins the exact server/client frame vocabulary', () => {
  assertEquals([...SSE_EVENTS], ['delta', 'done', 'error'], 'exact SSE_EVENTS tuple');
});

Deno.test('encodeFrame formats exact SSE wire block and round-trips special characters via drainFrames', () => {
  const wire = encodeFrame('delta', { reply: 'Merhaba' });
  assertEquals(wire, 'event: delta\ndata: {"reply":"Merhaba"}\n\n', 'exact wire encoding');

  const tricky = {
    reply: 'Satır 1\nSatır 2 "tırnak" \\ters\\ 🎯 emoji \uD83D\uDE80 ğüşıöçĞÜŞİÖÇ `kod`',
    nested: { ok: true, count: 3 },
  };
  const combined =
    encodeFrame('delta', tricky) +
    encodeFrame('done', { ...tricky, balance: 20 }).replace(/\n/g, '\r\n');

  const drained = drainFrames(combined);
  assertEquals(drained.rest, '', 'no trailing rest');
  assertEquals(drained.frames.length, 2, 'two frames decoded');
  assertEquals(drained.frames[0], { event: 'delta', data: tricky }, 'delta round-trip');
  assertEquals(drained.frames[1], { event: 'done', data: { ...tricky, balance: 20 } }, 'CRLF done round-trip');
});

Deno.test('drainFrames holds incomplete trailing frames in rest and skips malformed JSON', () => {
  const half = 'event: delta\ndata: {"reply":"Yarım';
  const r1 = drainFrames(half);
  assertEquals(r1.frames, [], 'incomplete frame must not emit');
  assertEquals(r1.rest, half, 'incomplete frame kept in rest');

  const streamWithBadJson =
    ': keep-alive\n\n' +
    'event: delta\ndata: {not-valid-json}\n\n' +
    'event: delta\ndata: ["array-not-object"]\n\n' +
    encodeFrame('error', { status: 429, code: 'DAILY_LIMIT', error: 'Sınır doldu' }) +
    'event: delta\ndata: {"reply":"Sonraki';

  const r2 = drainFrames(streamWithBadJson);
  assertEquals(r2.frames, [
    { event: 'error', data: { status: 429, code: 'DAILY_LIMIT', error: 'Sınır doldu' } },
  ], 'malformed frames skipped while valid error frame survives');
  assert(r2.rest.startsWith('event: delta'), 'trailing partial preserved');
});
