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

const ROOT = join(__dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo as Record<string, any>;

/** Anything still spelled this way is template residue. */
const TEMPLATE_DEFAULT = 'frontend';

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
