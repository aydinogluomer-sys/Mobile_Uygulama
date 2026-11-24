import { createHmac, randomBytes } from 'crypto';
import { hmacSha256, hmacSha256Hex, randomHex, sha256, toHex, utf8 } from '../../lib/hmacSha256';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('F46 (5.2-c) — pure TypeScript SHA-256 & HMAC-SHA256 (lib/hmacSha256.ts)', () => {
  it('(+) matches FIPS 180-4 SHA-256 standard vectors (empty string and "abc")', () => {
    expect(toHex(sha256(utf8('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('(+) matches RFC 4231 HMAC-SHA256 test vectors 1, 2, 3, 4, and 6 (including >64-byte key)', () => {
    // Test Case 1
    expect(
      toHex(
        hmacSha256(
          hexToBytes('0b'.repeat(20)),
          utf8('Hi There'),
        ),
      ),
    ).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');

    // Test Case 2
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );

    // Test Case 3
    expect(
      toHex(
        hmacSha256(
          hexToBytes('aa'.repeat(20)),
          hexToBytes('dd'.repeat(50)),
        ),
      ),
    ).toBe('773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe');

    // Test Case 4
    expect(
      toHex(
        hmacSha256(
          hexToBytes('0102030405060708090a0b0c0d0e0f10111213141516171819'),
          hexToBytes('cd'.repeat(50)),
        ),
      ),
    ).toBe('82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b');

    // Test Case 6 (131-byte key > 64-byte block size -> hashed first)
    expect(
      toHex(
        hmacSha256(
          hexToBytes('aa'.repeat(131)),
          utf8('Test Using Larger Than Block-Size Key - Hash Key First'),
        ),
      ),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('(+) matches node:crypto createHmac("sha256") across 200 random (key, message) pairs including Turkish & Astral UTF-8', () => {
    const samples = ['ğüşiöçĞÜŞİÖÇ', '🚀✨🔥', 'Aderyth\u0000webhook', ''];
    for (let i = 0; i < 200; i += 1) {
      const keyLen = (i % 90) + 1;
      const msgLen = i % 150;
      const keyStr = randomBytes(keyLen).toString('base64') + samples[i % samples.length];
      const msgStr = randomBytes(msgLen).toString('utf8') + samples[(i + 1) % samples.length];
      const expected = createHmac('sha256', Buffer.from(keyStr, 'utf8'))
        .update(Buffer.from(msgStr, 'utf8'))
        .digest('hex');
      expect(hmacSha256Hex(keyStr, msgStr)).toBe(expected);
    }
  });

  it('(-) encodes multi-byte UTF-8 accurately without TextEncoder (utf8("ğ") is 2 bytes) and randomHex works with or without getRandomValues', () => {
    const gBytes = utf8('ğ');
    expect(gBytes.length).toBe(2);
    expect(Array.from(gBytes)).toEqual([0xc4, 0x9f]);

    const a = randomHex(32);
    const b = randomHex(32);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);

    // Fallback path when getRandomValues is unavailable or throws
    const fallback = randomHex(32, {
      getRandomValues: () => {
        throw new Error('no CSPRNG');
      },
    });
    expect(fallback).toMatch(/^[0-9a-f]{64}$/);
    expect(randomHex(0)).toBe('');
  });
});
