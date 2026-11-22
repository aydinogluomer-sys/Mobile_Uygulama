/**
 * F46 (REP-14) — dependency-free FIPS 180-4 SHA-256, RFC 2104 HMAC-SHA256, and random hex helper.
 *
 * Neither `TextEncoder` nor `crypto.subtle` is guaranteed across all Hermes / React Native runtimes,
 * and no native crypto dependency is added in this phase.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H_INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

/** Encodes a JavaScript UTF-16 string into UTF-8 bytes without relying on `TextEncoder`. */
export function utf8(s: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + (((code - 0xd800) << 10) | (next - 0xdc00));
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        i += 1;
      } else {
        bytes.push(0xef, 0xbf, 0xbd);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd);
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

/** FIPS 180-4 SHA-256 over arbitrary bytes. */
export function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const totalLen = (((len + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(totalLen);
  padded.set(data, 0);
  padded[len] = 0x80;

  const bitLenHi = Math.floor((len * 8) / 0x100000000) >>> 0;
  const bitLenLo = (len * 8) >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, bitLenHi, false);
  view.setUint32(totalLen - 4, bitLenLo, false);

  let h0 = H_INIT[0];
  let h1 = H_INIT[1];
  let h2 = H_INIT[2];
  let h3 = H_INIT[3];
  let h4 = H_INIT[4];
  let h5 = H_INIT[5];
  let h6 = H_INIT[6];
  let h7 = H_INIT[7];

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

const BLOCK_SIZE = 64;

/** RFC 2104 HMAC-SHA256. Keys longer than 64 bytes are hashed first. */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const normalizedKey = key.length > BLOCK_SIZE ? sha256(key) : key;
  const blockKey = new Uint8Array(BLOCK_SIZE);
  blockKey.set(normalizedKey, 0);

  const innerInput = new Uint8Array(BLOCK_SIZE + data.length);
  const outerPad = new Uint8Array(BLOCK_SIZE + 32);
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    innerInput[i] = blockKey[i] ^ 0x36;
    outerPad[i] = blockKey[i] ^ 0x5c;
  }
  innerInput.set(data, BLOCK_SIZE);

  const innerDigest = sha256(innerInput);
  outerPad.set(innerDigest, BLOCK_SIZE);
  return sha256(outerPad);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hmacSha256Hex(secret: string, message: string): string {
  return toHex(hmacSha256(utf8(secret), utf8(message)));
}

let fallbackCounter = 0;

export function randomHex(
  byteLength: number,
  deps?: { getRandomValues?: ((a: Uint8Array) => Uint8Array) | null },
): string {
  const n = Math.max(0, Math.floor(byteLength));
  if (n === 0) return '';
  const buf = new Uint8Array(n);
  const globalCrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  const getRandom =
    deps && 'getRandomValues' in deps
      ? deps.getRandomValues ?? undefined
      : typeof globalCrypto?.getRandomValues === 'function'
        ? (a: Uint8Array) => globalCrypto.getRandomValues!(a)
        : undefined;

  if (getRandom) {
    try {
      getRandom(buf);
      return toHex(buf);
    } catch {
      /* fall through to deterministic entropy-mixed SHA-256 fallback */
    }
  }

  let offset = 0;
  while (offset < n) {
    fallbackCounter = (fallbackCounter + 1) >>> 0;
    const seed = `${Date.now()}:${fallbackCounter}:${Math.random()}:${Math.random()}`;
    const chunk = sha256(utf8(seed));
    const take = Math.min(chunk.length, n - offset);
    buf.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return toHex(buf);
}
