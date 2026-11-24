import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import {
  DESTINATIONS,
  INTEGRATIONS_VISIBLE,
  destinationById,
  destinationForLegacyRoute,
  hubDestinations,
  routeKeyOf,
  visibleDestinations,
} from '../../lib/destinations';
import { DEFAULT_SHORTCUT_ROUTES } from '../../store/drawerStore';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string): string => stripComments(read(rel));

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkTsx(rel));
    else if (/\.(?:ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const EMBEDDED_SCREEN_PATHS = new Set(
  DESTINATIONS.filter((d) => d.embedded)
    .flatMap((d) => d.legacyRoutes ?? [])
    .filter((r) => r.startsWith('/screens/')),
);

const EMBEDDED_PUSH_ALLOWLIST = new Set<string>([]);

export function findEmbeddedScreenPushes(
  fileRel: string,
  sourceCode: string,
  embeddedPaths: ReadonlySet<string> = EMBEDDED_SCREEN_PATHS,
  allowlist: ReadonlySet<string> = EMBEDDED_PUSH_ALLOWLIST,
): string[] {
  if (allowlist.has(fileRel)) return [];
  const hits: string[] = [];
  const re = /router\.push\(\s*(?:['"`](\/screens\/[a-z0-9-]+)|\{\s*pathname:\s*['"`](\/screens\/[a-z0-9-]+))/g;
  for (const m of sourceCode.matchAll(re)) {
    const target = m[1] ?? m[2];
    if (target && embeddedPaths.has(target)) {
      hits.push(`${fileRel}: ${target}`);
    }
  }
  return hits;
}

describe('F28 (NAV-08..10, NAV-16, NAV-22) — singleDestinationCatalog', () => {
  it('(+) ids, labels, and routeKeyOf(href) pairs are globally unique across DESTINATIONS', () => {
    expect(DESTINATIONS.length).toBeGreaterThanOrEqual(30);

    const ids = DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);

    const labels = DESTINATIONS.map((d) => d.label);
    expect(new Set(labels).size).toBe(labels.length);

    const routeKeys = DESTINATIONS.map((d) => routeKeyOf(d.href));
    expect(new Set(routeKeys).size).toBe(routeKeys.length);

    for (const d of DESTINATIONS) {
      expect(destinationById(d.id).id).toBe(d.id);
    }
  });

  it('(+) every destination pathname resolves to an existing route file under app/tabs/ or app/screens/', () => {
    const missing: string[] = [];
    for (const d of DESTINATIONS) {
      const p = d.href.pathname;
      const candidate = `app${p}.tsx`;
      if (!existsSync(join(ROOT, candidate))) {
        missing.push(`${d.id} -> ${candidate}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('(+) embedded destinations declare tab/sub params that exist in the target tab screen useTabParam allowlist', () => {
    const embedded = DESTINATIONS.filter((d) => d.embedded);
    expect(embedded.length).toBeGreaterThanOrEqual(10);

    for (const d of embedded) {
      const tabFile = `app${d.href.pathname}.tsx`;
      const src = code(tabFile);
      const tabVal = d.href.params?.tab;
      if (tabVal) {
        expect(src).toContain(`'${tabVal}'`);
        expect(src).toContain('useTabParam');
      }
      const subVal = d.href.params?.sub;
      if (subVal) {
        expect(src).toContain(`'${subVal}'`);
      }
    }
  });

  it('(+) legacyRoutes are globally unique, core tier has 6-9 entries, and DEFAULT_SHORTCUT_ROUTES all resolve', () => {
    const allLegacy = DESTINATIONS.flatMap((d) => d.legacyRoutes ?? []);
    expect(allLegacy.length).toBeGreaterThan(10);
    expect(new Set(allLegacy).size).toBe(allLegacy.length);

    const core = DESTINATIONS.filter((d) => d.tier === 'core');
    expect(core.length).toBeGreaterThanOrEqual(6);
    expect(core.length).toBeLessThanOrEqual(9);

    for (const r of DEFAULT_SHORTCUT_ROUTES) {
      expect(destinationForLegacyRoute(r)).toBeDefined();
    }
  });

  it('(+) gate behaves both ways: INTEGRATIONS_VISIBLE=false hides integrations everywhere; mocked true exposes it', () => {
    expect(INTEGRATIONS_VISIBLE).toBe(false);
    expect(visibleDestinations('drawer').some((d) => d.id === 'integrations')).toBe(false);
    expect(visibleDestinations('hub').some((d) => d.id === 'integrations')).toBe(false);
    expect(visibleDestinations('palette').some((d) => d.id === 'integrations')).toBe(false);
    expect(hubDestinations('all').some((d) => d.id === 'integrations')).toBe(false);

    let gatedTrueVisible = false;
    let drawerHasIntegrations = false;
    let hubHasIntegrations = false;
    let paletteHasIntegrations = false;

    jest.isolateModules(() => {
      jest.doMock('../../lib/featureGates', () => ({
        NOTION_INTEGRATION_ENABLED: true,
        GOOGLE_CALENDAR_INTEGRATION_ENABLED: false,
        SPOTIFY_OAUTH_ENABLED: false,
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const isolated = require('../../lib/destinations') as typeof import('../../lib/destinations');
      gatedTrueVisible = isolated.INTEGRATIONS_VISIBLE;
      drawerHasIntegrations = isolated.visibleDestinations('drawer').some((d) => d.id === 'integrations');
      hubHasIntegrations = isolated.hubDestinations('system').some((d) => d.id === 'integrations');
      paletteHasIntegrations = isolated.visibleDestinations('palette').some((d) => d.id === 'integrations');
      jest.dontMock('../../lib/featureGates');
    });

    expect(gatedTrueVisible).toBe(true);
    expect(drawerHasIntegrations).toBe(true);
    expect(hubHasIntegrations).toBe(true);
    expect(paletteHasIntegrations).toBe(true);
  });

  it('(-) Drawer, CommandPalette, HubScreen, and ToolsView hold zero hardcoded route table entries', () => {
    const targets = [
      'components/Drawer.tsx',
      'components/CommandPalette.tsx',
      'app/tabs/hub.tsx',
      'components/hub/ToolsView.tsx',
    ];
    for (const rel of targets) {
      const src = code(rel);
      expect(src).not.toMatch(/\broute:\s*['"]\/(?:screens|tabs)\//);
    }
  });

  it('(-) Keşfet label appears exactly once, and neither dashboard nor Triage exists in DESTINATIONS', () => {
    const kesfetEntries = DESTINATIONS.filter((d) => d.label === 'Keşfet');
    expect(kesfetEntries).toHaveLength(1);
    expect(kesfetEntries[0].id).toBe('explore');

    expect(DESTINATIONS.some((d) => String(d.id) === 'dashboard')).toBe(false);
    expect(DESTINATIONS.some((d) => /triage/i.test(d.label))).toBe(false);
    expect(DESTINATIONS.some((d) => /triage/i.test(d.hub?.blurb ?? ''))).toBe(false);
  });

  it('(-) zero router.push("/screens/<embedded>") calls remain across app/ and components/', () => {
    expect(
      findEmbeddedScreenPushes('app/screens/foo.tsx', "router.push('/screens/okr');"),
    ).toEqual(['app/screens/foo.tsx: /screens/okr']);
    expect(
      findEmbeddedScreenPushes('app/screens/foo.tsx', "router.push('/screens/focus-points');"),
    ).toEqual([]);

    const files = [...walkTsx('app'), ...walkTsx('components')];
    const violations = files.flatMap((f) => findEmbeddedScreenPushes(f, code(f)));
    expect(violations).toEqual([]);
  });
});
