/**
 * The app is Atlas, not the Expo template.
 *
 * ## What shipped
 *
 *     name    "frontend"
 *     slug    "frontend"
 *     scheme  "frontend"
 *     icon    assets/images/icon.png   — Expo's blue "e", byte-identical to
 *                                        favicon.png and adaptive-icon.png
 *
 * So the app installed on a phone under the name "frontend", wearing another
 * framework's logo, and deep-linked as `frontend://`. Every one of those is a
 * template default nobody changed, and none of them is visible from inside the
 * app — you have to build it to find out, which is why they survived a year.
 *
 * Two more that were quieter: the Android adaptive icon and the splash both
 * sat on `#000`, pure black, against an app whose background is `#15140F`, a
 * warm near-black — so the launch would flash a colder black than the first
 * screen; and the notification tint was `#6366f1`, an indigo that appears
 * nowhere else in the palette.
 *
 * ## What this file does not check
 *
 * Whether the icon is GOOD. It is a deliberate placeholder built only from
 * `colors.bg` and `colors.accent` (see `scripts/generate-app-icons.py`), and
 * replacing it with real artwork is a design deliverable listed in
 * `docs/BRANDING.md`. What is checked is that it is not the template's, and
 * that the identity fields are the app's own.
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { inflateSync } from 'zlib';

const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo as Record<string, any>;

/** Anything still spelled this way is template residue. */
const TEMPLATE_DEFAULT = 'frontend';

/**
 * The smallest and largest alpha in an 8-bit RGBA / grey+alpha PNG.
 *
 * Written out rather than pulled in as a dependency: the whole question is
 * "does this file have transparent pixels", and adding a PNG library to the
 * devDependencies to answer it would cost more than the forty lines. The
 * scanline filters are the ones PNG defines (None/Sub/Up/Average/Paeth) and
 * must all be undone, because a filtered byte is a DIFFERENCE, not a value —
 * reading them raw would report alphas that were never in the image.
 */
function alphaExtrema(png: Buffer): { min: number; max: number } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const depth = png[24];
  const colourType = png[25];
  const interlace = png[28];
  if (depth !== 8 || interlace !== 0) throw new Error('alphaExtrema: 8-bit, non-interlaced only');
  const channels = colourType === 6 ? 4 : colourType === 4 ? 2 : 0;
  if (!channels) throw new Error(`alphaExtrema: colour type ${colourType} has no alpha`);

  // Concatenate every IDAT chunk, then inflate.
  const parts: Buffer[] = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(parts));

  const bpp = channels;                 // bytes per pixel at depth 8
  const stride = width * bpp;
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  let min = 255;
  let max = 0;

  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    raw.copy(line, 0, base + 1, base + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;   // left
      const b = prev[i];                         // up
      const c = i >= bpp ? prev[i - bpp] : 0;    // upper-left
      switch (filter) {
        case 0: break;
        case 1: line[i] = (line[i] + a) & 0xff; break;
        case 2: line[i] = (line[i] + b) & 0xff; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[i] = (line[i] + pred) & 0xff;
          break;
        }
        default: throw new Error(`alphaExtrema: unknown filter ${filter}`);
      }
    }
    for (let x = bpp - 1; x < stride; x += bpp) {
      if (line[x] < min) min = line[x];
      if (line[x] > max) max = line[x];
    }
    line.copy(prev);
  }
  return { min, max };
}

describe('identity', () => {
  it.each(['name', 'slug', 'scheme'])('%s is not the template default', (field) => {
    expect(config[field]).not.toBe(TEMPLATE_DEFAULT);
  });

  it('the app is named Atlas, which is what its own UI calls it', () => {
    expect(config.name).toBe('Atlas');
  });

  it('has a description, which the stores require', () => {
    expect(typeof config.description).toBe('string');
    expect(config.description.length).toBeGreaterThan(40);
  });

  it('the deep-link scheme is a single lowercase word', () => {
    // It becomes `atlas://…`; anything with punctuation or a capital is a
    // portability problem across the two platforms' URL handling.
    expect(config.scheme).toMatch(/^[a-z][a-z0-9]*$/);
  });
});

describe('colour agrees with the palette', () => {
  // Read from tokens rather than hard-coded here, so a palette change cannot
  // leave these three quietly pointing at the old colour.
  const tokens = readFileSync(join(ROOT, 'lib', 'tokens.ts'), 'utf8');
  const valueOf = (name: string) => {
    const m = tokens.match(new RegExp(`^\\s*${name}\\s*:\\s*'(#[0-9a-fA-F]{6})'`, 'm'));
    if (!m) throw new Error(`lib/tokens.ts has no ${name}`);
    return m[1].toUpperCase();
  };

  it('the launch surfaces use the app background, not pure black', () => {
    const bg = valueOf('bg');
    expect(config.android.adaptiveIcon.backgroundColor.toUpperCase()).toBe(bg);
    const splash = config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen');
    expect(splash[1].backgroundColor.toUpperCase()).toBe(bg);
  });

  it('the accent is the accent, everywhere it appears', () => {
    const accent = valueOf('accent');
    expect(config.primaryColor.toUpperCase()).toBe(accent);
    const notif = config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-notifications');
    expect(notif[1].color.toUpperCase()).toBe(accent);
  });
});

describe('assets', () => {
  it('the icon is not the Expo template icon', () => {
    // The template icon is a 255 KB 1024px PNG. The generated mark is flat
    // colour and an order of magnitude smaller, so size alone separates them
    // without checking in a hash of someone else's artwork.
    const size = statSync(join(ROOT, 'assets', 'images', 'icon.png')).size;
    expect(size).toBeLessThan(60_000);
  });

  it('the three icons are no longer the same file', () => {
    // They were byte-identical. A favicon and an Android adaptive foreground
    // have different framing requirements; one file cannot satisfy both.
    const read = (n: string) => readFileSync(join(ROOT, 'assets', 'images', n));
    const icon = read('icon.png');
    const favicon = read('favicon.png');
    const adaptive = read('adaptive-icon.png');
    expect(icon.equals(favicon)).toBe(false);
    expect(icon.equals(adaptive)).toBe(false);
  });

  it('the notification icon is a silhouette, not a filled square', () => {
    // Android does not RENDER this image. From API 21 it reads the alpha
    // channel only and paints the result in the notification colour, so an
    // opaque icon arrives as a solid block in the status bar.
    //
    // `app.json` pointed at `icon.png`, whose alpha is 255 at every pixel, so
    // every Atlas notification would have shown a white rounded rectangle.
    // This checks the property that matters — the file has transparency —
    // rather than which filename is configured, because the next person to
    // point it at a different opaque PNG reintroduces exactly the same bug.
    const config = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
    const notif = config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-notifications');
    const rel = (notif as [string, { icon: string }])[1].icon.replace('./', '');
    const png = readFileSync(join(ROOT, rel));

    // PNG colour type lives at byte 25 of the IHDR chunk: 6 = RGBA, 4 =
    // grey+alpha. Anything else has no alpha channel to read.
    expect([4, 6]).toContain(png[25]);

    // Having an alpha channel is not the same as using one — `icon.png` is
    // RGBA and opaque at every pixel. So the alpha is actually decoded.
    const alpha = alphaExtrema(png);
    expect(alpha.min).toBe(0);    // there is transparent space around the mark
    expect(alpha.max).toBe(255);  // and the mark itself is solid
  });

  it('the icons can be regenerated from a committed source', () => {
    // A binary checked in with no source cannot be adjusted -- the next
    // person has to redraw it.
    expect(existsSync(join(ROOT, 'scripts', 'generate-app-icons.py'))).toBe(true);
  });

  it('no unreferenced template artwork is left in the bundle', () => {
    for (const dead of ['react-logo.png', 'react-logo@2x.png', 'react-logo@3x.png',
                        'partial-react-logo.png', 'app-image.png', 'splash-image.png']) {
      expect({ dead, present: existsSync(join(ROOT, 'assets', 'images', dead)) })
        .toEqual({ dead, present: false });
    }
  });
});
