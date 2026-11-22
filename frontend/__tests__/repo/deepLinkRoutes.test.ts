import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import * as featureGates from '../../lib/featureGates';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string): string => stripComments(read(rel));

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkFiles(rel));
    else if (/\.(?:ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

export const OAUTH_CALLBACK_ALLOWLIST: Readonly<Record<string, keyof typeof featureGates>> = {
  'notion-callback': 'NOTION_INTEGRATION_ENABLED',
  'google-calendar-callback': 'GOOGLE_CALENDAR_INTEGRATION_ENABLED',
  'spotify-callback': 'SPOTIFY_OAUTH_ENABLED',
};

function routeExistsForSlug(slug: string): boolean {
  const clean = slug.replace(/^\/+/, '');
  return (
    existsSync(join(ROOT, 'app', `${clean}.tsx`)) ||
    existsSync(join(ROOT, 'app', clean, '_layout.tsx')) ||
    existsSync(join(ROOT, 'app', clean, 'index.tsx')) ||
    existsSync(join(ROOT, 'app', '(auth)', `${clean}.tsx`))
  );
}

export function validateCallbackSlug(
  slug: string,
  gates: Record<string, unknown>,
  hasRoute: (s: string) => boolean = routeExistsForSlug,
): string | null {
  if (hasRoute(slug)) return null;
  const gateName = OAUTH_CALLBACK_ALLOWLIST[slug];
  if (!gateName) {
    return `Linking.createURL('${slug}') has no route under app/ and is not in OAUTH_CALLBACK_ALLOWLIST`;
  }
  if (gates[gateName] !== false) {
    return `Gate ${String(gateName)} is enabled; route for '${slug}' must be added under app/ (rota eklenmeli)`;
  }
  return null;
}

describe('F28 (NAV-18, NAV-19) — deepLinkRoutes', () => {
  it('(+) app/+not-found.tsx exists, uses theme tokens, and links back to /tabs/today with >= 48dp hit target', () => {
    expect(existsSync(join(ROOT, 'app', '+not-found.tsx'))).toBe(true);
    const nf = code('app/+not-found.tsx');
    expect(nf).toContain('useThemeColors');
    expect(nf).toContain('Bu sayfa bulunamadı');
    expect(nf).toContain('/tabs/today');
    expect(nf).toMatch(/Bugün(?:&apos;|')e dön/);
    expect(nf).toContain('minHeight: 48');
    expect(nf).toContain('accessibilityRole="link"');
  });

  it('(+) app/tabs/_layout.tsx declares unstable_settings with initialRouteName: "today"', () => {
    const tabsLayout = code('app/tabs/_layout.tsx');
    expect(tabsLayout).toMatch(/export\s+const\s+unstable_settings\s*=\s*\{\s*initialRouteName:\s*['"]today['"]\s*\}/);
  });

  it('(+) every Stack.Screen in root app/_layout.tsx resolves to an app/<name>.tsx file or app/<name>/_layout.tsx directory', () => {
    const rootLayout = code('app/_layout.tsx');
    const names = [...rootLayout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(3);

    const unresolved = names.filter(
      (n) =>
        !existsSync(join(ROOT, 'app', `${n}.tsx`)) &&
        !existsSync(join(ROOT, 'app', n, '_layout.tsx')),
    );
    expect(unresolved).toEqual([]);
  });

  it('(+) every Linking.createURL("<slug>") in store/, services/, app/, components/ has either a route or a disabled OAuth gate', () => {
    const files = [
      ...walkFiles('store'),
      ...walkFiles('services'),
      ...walkFiles('app'),
      ...walkFiles('components'),
    ];
    const slugs: { file: string; slug: string }[] = [];
    for (const rel of files) {
      const src = code(rel);
      for (const m of src.matchAll(/Linking\.createURL\(\s*['"`]([^'"`]+)['"`]/g)) {
        slugs.push({ file: rel, slug: m[1] });
      }
    }
    expect(slugs.length).toBeGreaterThanOrEqual(3);

    const errors = slugs
      .map(({ file, slug }) => {
        const err = validateCallbackSlug(slug, featureGates as Record<string, unknown>);
        return err ? `${file}: ${err}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(errors).toEqual([]);
  });

  it('(-) root layout has no ghost name="habits" screen, and app/ has zero dead "ai=true" query strings', () => {
    const rootLayout = code('app/_layout.tsx');
    expect(rootLayout).not.toMatch(/name=["']habits["']/);

    const appFiles = walkFiles('app');
    const aiTrueHits = appFiles.filter((rel) => code(rel).includes('ai=true'));
    expect(aiTrueHits).toEqual([]);
  });

  it('(-) validator rejects enabled OAuth gate without a route file and rejects unknown createURL slugs', () => {
    expect(
      validateCallbackSlug(
        'notion-callback',
        { NOTION_INTEGRATION_ENABLED: true },
        () => false,
      ),
    ).toContain('rota eklenmeli');

    expect(
      validateCallbackSlug(
        'mystery-callback',
        { NOTION_INTEGRATION_ENABLED: false },
        () => false,
      ),
    ).toContain('not in OAUTH_CALLBACK_ALLOWLIST');
  });
});
