import {
  ALLOWED_HEADERS,
  corsHeadersFor,
  jsonResponse,
  parseAllowedOrigins,
  readJsonBody,
} from './http.ts';

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

Deno.test('parseAllowedOrigins and corsHeadersFor enforce allowlist reflection and wildcard fallback', () => {
  assertEquals(parseAllowedOrigins(undefined), null, 'undefined -> null');
  assertEquals(parseAllowedOrigins('   ,  '), null, 'blank -> null');

  const two = parseAllowedOrigins(' https://aderyth.com , https://app.aderyth.com ');
  assertEquals(two, ['https://aderyth.com', 'https://app.aderyth.com'], 'two-element allowlist');

  const wildcardHeaders = corsHeadersFor(new Request('https://example.test/fn'), null);
  assertEquals(wildcardHeaders['Access-Control-Allow-Origin'], '*', 'null allowlist -> *');
  assertEquals(wildcardHeaders['Access-Control-Allow-Headers'], ALLOWED_HEADERS, 'allowed headers');

  const allowedReq = new Request('https://example.test/fn', {
    headers: { Origin: 'https://app.aderyth.com' },
  });
  const reflected = corsHeadersFor(allowedReq, two);
  assertEquals(reflected['Access-Control-Allow-Origin'], 'https://app.aderyth.com', 'listed origin reflected');
  assertEquals(reflected['Vary'], 'Origin', 'Vary: Origin set');

  const localDevReq = new Request('https://example.test/fn', {
    headers: { Origin: 'http://localhost:8081' },
  });
  const localReflected = corsHeadersFor(localDevReq, two);
  assertEquals(localReflected['Access-Control-Allow-Origin'], 'http://localhost:8081', 'localhost:8081 allowed');

  const evilReq = new Request('https://example.test/fn', {
    headers: { Origin: 'https://evil.example.com' },
  });
  const blocked = corsHeadersFor(evilReq, two);
  assert(!('Access-Control-Allow-Origin' in blocked), 'unlisted origin receives no ACAO');
  assertEquals(blocked['Vary'], 'Origin', 'Vary: Origin still present');
});

Deno.test('readJsonBody accepts exact 65536-byte JSON and rejects empty, invalid, and >maxBytes payloads', async () => {
  const prefix = '{"pad":"';
  const suffix = '"}';
  const exactText = prefix + 'a'.repeat(65_536 - prefix.length - suffix.length) + suffix;
  assertEquals(new TextEncoder().encode(exactText).byteLength, 65_536, 'exact 65536 bytes');

  const okExact = await readJsonBody(
    new Request('https://example.test/fn', { method: 'POST', body: exactText }),
    65_536,
  );
  assert(okExact.ok, 'exact 65536 bytes accepted');

  const empty = await readJsonBody(
    new Request('https://example.test/fn', { method: 'POST', body: '   ' }),
    65_536,
  );
  assert(!empty.ok && empty.status === 400 && empty.code === 'BAD_JSON', 'empty body -> 400 BAD_JSON');

  const malformed = await readJsonBody(
    new Request('https://example.test/fn', { method: 'POST', body: '{"broken":' }),
    65_536,
  );
  assert(!malformed.ok && malformed.status === 400 && malformed.code === 'BAD_JSON', 'malformed JSON -> 400 BAD_JSON');

  let textCalled = false;
  const fakeOversizeHeaderReq = {
    headers: new Headers({ 'Content-Length': '70000' }),
    text: async () => {
      textCalled = true;
      return '{}';
    },
  } as unknown as Request;
  const byHeader = await readJsonBody(fakeOversizeHeaderReq, 65_536);
  assert(!byHeader.ok && byHeader.status === 413 && byHeader.code === 'BODY_TOO_LARGE', 'Content-Length > max -> 413');
  assert(!textCalled, 'body stream not read when Content-Length exceeds maxBytes');

  const oversizeStream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"x":"' + 'b'.repeat(70_000) + '"}'));
      c.close();
    },
  });
  const byBytes = await readJsonBody(
    new Request('https://example.test/fn', { method: 'POST', body: oversizeStream }),
    65_536,
  );
  assert(!byBytes.ok && byBytes.status === 413 && byBytes.code === 'BODY_TOO_LARGE', 'headerless 70000 bytes -> 413');

  const res = jsonResponse({ ok: true }, 201, { 'Access-Control-Allow-Origin': '*' });
  assertEquals(res.status, 201, 'jsonResponse status');
});
