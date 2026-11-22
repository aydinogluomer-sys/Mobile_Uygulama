import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const FRONTEND = join(__dirname, '..', '..');
const ASSETS_DIR = join(FRONTEND, 'assets', 'images');

export type AssetEntry = {
  path: string;
  bytes: number;
  width: number;
  height: number;
};

export function readWebpSize(buf: Buffer): { width: number; height: number } {
  if (!Buffer.isBuffer(buf) || buf.length < 16) {
    throw new Error('Invalid WebP buffer: too short');
  }
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Invalid WebP buffer: missing RIFF/WEBP signature');
  }

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const p = offset + 8;

    if (chunkId === 'VP8X') {
      if (chunkSize < 10 || p + 10 > buf.length) {
        throw new Error('Invalid VP8X chunk');
      }
      const width = (buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16)) + 1;
      const height = (buf[p + 7] | (buf[p + 8] << 8) | (buf[p + 9] << 16)) + 1;
      return { width, height };
    }

    if (chunkId === 'VP8L') {
      if (chunkSize < 5 || p + 5 > buf.length || buf[p] !== 0x2f) {
        throw new Error('Invalid VP8L chunk');
      }
      const bits = buf.readUInt32LE(p + 1);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >>> 14) & 0x3fff) + 1;
      return { width, height };
    }

    if (chunkId === 'VP8 ') {
      if (chunkSize < 10 || p + 10 > buf.length) {
        throw new Error('Invalid VP8 chunk: truncated');
      }
      if (buf[p + 3] !== 0x9d || buf[p + 4] !== 0x01 || buf[p + 5] !== 0x2a) {
        throw new Error('Invalid VP8 chunk: missing 0x9d012a start code');
      }
      const width = buf.readUInt16LE(p + 6) & 0x3fff;
      const height = buf.readUInt16LE(p + 8) & 0x3fff;
      if (width <= 0 || height <= 0) {
        throw new Error('Invalid VP8 dimensions');
      }
      return { width, height };
    }

    offset = p + chunkSize + (chunkSize & 1);
  }

  throw new Error('Invalid WebP buffer: no VP8/VP8L/VP8X chunk found');
}

export const TOTAL_ASSET_BUDGET_BYTES = 5_000_000;

export function checkAssetBudget(entries: readonly AssetEntry[]): string[] {
  const problems: string[] = [];
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (totalBytes > TOTAL_ASSET_BUDGET_BYTES) {
    problems.push(`total bytes ${totalBytes} exceeds budget ${TOTAL_ASSET_BUDGET_BYTES}`);
  }

  for (const e of entries) {
    const maxEdge = Math.max(e.width, e.height);
    if (maxEdge > 1680) {
      problems.push(`${e.path}: ${e.width}x${e.height} exceeds global max edge 1680px`);
    }

    if (/^(?:badges|ranks|moods)\//.test(e.path) && maxEdge > 256) {
      problems.push(`${e.path}: ${e.width}x${e.height} exceeds icon/emblem max edge 256px`);
    }

    if (e.path.startsWith('months/') && maxEdge > 1336) {
      problems.push(`${e.path}: ${e.width}x${e.height} exceeds months max edge 1336px`);
    }

    if (
      (e.path.startsWith('focus-themes/focus-bg-') || e.path.startsWith('focus-flow/')) &&
      e.width > 720
    ) {
      problems.push(`${e.path}: width ${e.width}px exceeds backdrop max width 720px`);
    }

    if (e.path.startsWith('focus-themes/swatch-')) {
      if (e.width > 288 || e.height > 192) {
        problems.push(`${e.path}: ${e.width}x${e.height} exceeds swatch max 288x192`);
      }
      if (e.bytes > 20 * 1024) {
        problems.push(`${e.path}: ${e.bytes} bytes exceeds swatch max 20KB`);
      }
    }
  }

  return problems;
}

function collectAssets(dir: string, prefix = ''): AssetEntry[] {
  const out: AssetEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectAssets(full, rel));
    } else if (entry.isFile()) {
      const bytes = statSync(full).size;
      if (entry.name.toLowerCase().endsWith('.webp')) {
        const { width, height } = readWebpSize(readFileSync(full));
        out.push({ path: rel, bytes, width, height });
      } else {
        out.push({ path: rel, bytes, width: 0, height: 0 });
      }
    }
  }
  return out;
}

describe('F25 (PRF-10) — visual asset byte and dimension budget', () => {
  it('(+) readWebpSize parses synthetic VP8, VP8L, and VP8X headers accurately', () => {
    // 1. VP8 lossy: 720 x 1280
    const vp8 = Buffer.alloc(22);
    vp8.write('RIFF', 0, 'ascii');
    vp8.writeUInt32LE(14, 4);
    vp8.write('WEBP', 8, 'ascii');
    vp8.write('VP8 ', 12, 'ascii');
    vp8.writeUInt32LE(10, 16);
    vp8[23] = 0x9d;
    vp8[24] = 0x01;
    vp8[25] = 0x2a;
    // Wait: allocate 30 bytes so p=20..29 fits!
    const vp8Full = Buffer.alloc(30);
    vp8.copy(vp8Full);
    vp8Full[23] = 0x9d;
    vp8Full[24] = 0x01;
    vp8Full[25] = 0x2a;
    vp8Full.writeUInt16LE(720, 26);
    vp8Full.writeUInt16LE(1280, 28);
    expect(readWebpSize(vp8Full)).toEqual({ width: 720, height: 1280 });

    // 2. VP8L lossless: 256 x 192
    const vp8l = Buffer.alloc(25);
    vp8l.write('RIFF', 0, 'ascii');
    vp8l.writeUInt32LE(17, 4);
    vp8l.write('WEBP', 8, 'ascii');
    vp8l.write('VP8L', 12, 'ascii');
    vp8l.writeUInt32LE(5, 16);
    vp8l[20] = 0x2f;
    const packed = ((256 - 1) & 0x3fff) | (((192 - 1) & 0x3fff) << 14);
    vp8l.writeUInt32LE(packed >>> 0, 21);
    expect(readWebpSize(vp8l)).toEqual({ width: 256, height: 192 });

    // 3. VP8X extended: 750 x 1333
    const vp8x = Buffer.alloc(30);
    vp8x.write('RIFF', 0, 'ascii');
    vp8x.writeUInt32LE(22, 4);
    vp8x.write('WEBP', 8, 'ascii');
    vp8x.write('VP8X', 12, 'ascii');
    vp8x.writeUInt32LE(10, 16);
    const wMinus1 = 750 - 1;
    const hMinus1 = 1333 - 1;
    vp8x[24] = wMinus1 & 0xff;
    vp8x[25] = (wMinus1 >>> 8) & 0xff;
    vp8x[26] = (wMinus1 >>> 16) & 0xff;
    vp8x[27] = hMinus1 & 0xff;
    vp8x[28] = (hMinus1 >>> 8) & 0xff;
    vp8x[29] = (hMinus1 >>> 16) & 0xff;
    expect(readWebpSize(vp8x)).toEqual({ width: 750, height: 1333 });
  });

  it('(-) readWebpSize throws on truncated or corrupt headers', () => {
    expect(() => readWebpSize(Buffer.from('not-webp'))).toThrow();
    const badMagic = Buffer.alloc(30);
    badMagic.write('PNG ', 0, 'ascii');
    expect(() => readWebpSize(badMagic)).toThrow();
    const badVp8 = Buffer.alloc(30);
    badVp8.write('RIFF', 0, 'ascii');
    badVp8.write('WEBP', 8, 'ascii');
    badVp8.write('VP8 ', 12, 'ascii');
    badVp8.writeUInt32LE(10, 16);
    expect(() => readWebpSize(badVp8)).toThrow(/0x9d012a/);
  });

  it('(+) all assets under assets/images fit within the 5.0 MB and per-folder dimension budgets', () => {
    const entries = collectAssets(ASSETS_DIR);
    expect(entries.length).toBeGreaterThanOrEqual(170);
    const swatches = entries.filter((e) => e.path.startsWith('focus-themes/swatch-'));
    expect(swatches).toHaveLength(9);
    expect(checkAssetBudget(entries)).toEqual([]);
  });

  it('(+) every require("../assets/images/...") in lib/visualAssets.ts resolves on disk and FocusThemeModal uses getFocusSwatch', () => {
    const reg = readFileSync(join(FRONTEND, 'lib', 'visualAssets.ts'), 'utf8');
    const refs = [...reg.matchAll(/require\(['"]\.\.\/(assets\/images\/[^'"]+\.webp)['"]\)/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThanOrEqual(150);
    const missing = refs.filter((r) => !existsSync(join(FRONTEND, r)));
    expect(missing).toEqual([]);

    const modal = readFileSync(join(FRONTEND, 'components', 'focus', 'FocusThemeModal.tsx'), 'utf8');
    expect(modal).toContain('getFocusSwatch(');
    expect(modal).not.toContain('getFocusBackdrop(');
  });

  it('(-) checkAssetBudget returns distinct violations for oversized badge (512x512) and > 5.0 MB total', () => {
    const violations = checkAssetBudget([
      { path: 'badges/x.webp', bytes: 5_200_000, width: 512, height: 512 },
    ]);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatch(/5200000/);
    expect(violations[1]).toMatch(/badges\/x\.webp.*512x512/);
  });
});
