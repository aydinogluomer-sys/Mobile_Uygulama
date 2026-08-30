/**
 * Plan §24 Phase 4, "store assets".
 *
 * WHY THIS TEST EXISTS, and why it is a test rather than a one-off fix.
 *
 * `app.json` shipped pointing its splash screen at
 * `./assets/images/splash-icon.png` — a file that has never existed in this
 * repository (`git log --all -- <path>` returns nothing). The real asset is
 * `splash-image.png`. Nothing caught it, and nothing was ever going to:
 *
 *  - `tsc` does not read `app.json`.
 *  - `expo lint` does not read `app.json`.
 *  - `npx expo config --type prebuild` exits **0** and echoes the broken path
 *    straight back — config resolution does not stat the file.
 *  - Jest never touched `app.json` before this file.
 *
 * So a missing store asset was invisible to every gate the project runs, and
 * would have surfaced for the first time as a build artefact with no splash
 * screen. That is exactly the class of defect a cheap structural guard is
 * for: the cost of the check is a few milliseconds, and the thing it protects
 * (icon, adaptive icon, favicon, splash — the assets a store listing is
 * literally made of) cannot be verified any other way from inside CI.
 *
 * The test walks `app.json` generically rather than asserting four known
 * paths. A hardcoded list would pass forever the day someone adds a fifth
 * asset key — the same "green because it never looked" failure the missing
 * splash already demonstrated.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const frontendRoot = join(__dirname, '..', '..');
const appConfigPath = join(frontendRoot, 'app.json');

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Every string in the config that looks like a relative path to a local
 * asset, paired with the dotted key path that carried it (so a failure names
 * the offending key instead of only the missing file).
 *
 * Matches on the `./`-prefixed shape rather than on key names: the keys that
 * carry assets are not a closed set (`icon`, `image`, `foregroundImage`,
 * `favicon`, and whatever a future config plugin invents), but the value
 * shape is stable.
 */
function collectAssetRefs(node: Json, path: string[] = []): { key: string; ref: string }[] {
  if (typeof node === 'string') {
    return node.startsWith('./') && /\.(png|jpg|jpeg|webp|gif|svg|ttf|otf)$/i.test(node)
      ? [{ key: path.join('.'), ref: node }]
      : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => collectAssetRefs(child, [...path, String(i)]));
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => collectAssetRefs(v, [...path, k]));
  }
  return [];
}

describe('app.json store assets', () => {
  const config = JSON.parse(readFileSync(appConfigPath, 'utf8')) as { expo: Json };
  const refs = collectAssetRefs(config.expo, ['expo']);

  it('references at least the icon and splash assets (guards against the walk silently finding nothing)', () => {
    // Without this, a `collectAssetRefs` that returned `[]` — because the
    // shape check broke, or the config moved to app.config.js — would make
    // every assertion below vacuously true. An empty allowlist is the most
    // common way a structural test rots into a no-op.
    expect(refs.length).toBeGreaterThanOrEqual(4);
  });

  it.each(refs)('$key -> $ref exists on disk', ({ ref }) => {
    expect(existsSync(join(frontendRoot, ref))).toBe(true);
  });

  it('splash screen points at a real image', () => {
    // The specific defect this file was written for, asserted by name so a
    // regression reads as "the splash broke again" and not as an anonymous
    // row in the parameterised block above.
    const splash = refs.find((r) => r.key.includes('expo-splash-screen') || r.key.endsWith('.image'));
    expect(splash).toBeDefined();
    expect(existsSync(join(frontendRoot, splash!.ref))).toBe(true);
  });
});
