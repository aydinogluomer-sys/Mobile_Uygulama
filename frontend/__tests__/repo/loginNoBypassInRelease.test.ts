/**
 * F06 (NAV-01, PRF-03) — no demo bypass and no demo seeder in a release build.
 *
 * The release login screen rendered "🚀 Girişi Geç (Demo Modu)": it wrote a fake Notion session and
 * opened Today with no Supabase session, and `lib/demoSeed.ts` (fabricated projects, tasks, habits,
 * logs, journal entries) was imported statically by the login screen and Settings, so it shipped
 * in every bundle.
 *
 * The fix rests on one mechanism, the one `store/subscriptionStore.ts` already uses
 * (`freeMvpReleaseShape.test.ts`, "mock activation is still compiled out of release builds"):
 * code behind `__DEV__` is folded away by Metro's production transform before dependencies are
 * collected. These gates keep every path to the seeder and the bypass behind it. The release
 * bundles themselves are grepped in docs/implementation-v3/STATE.md (F06).
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => { throw new Error('no database in this test'); },
  },
}));

import { loadDemoSeed } from '../../lib/demoSeedGate';

const FRONTEND = join(__dirname, '..', '..');
const raw = (p: string): string => readFileSync(join(FRONTEND, p), 'utf8').replace(/\r\n?/g, '\n');
const code = (p: string): string => stripComments(raw(p));

function sourceFiles(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(FRONTEND, rel), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '__tests__') continue;
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) walk(d);
  return out.sort();
}
const PRODUCTION = sourceFiles(['app', 'components', 'store', 'services', 'lib', 'repositories', 'hooks'].filter((d) => {
  try { readdirSync(join(FRONTEND, d)); return true; } catch { return false; }
}));

/** `import ... from '<path>'`, `import('<path>')` or `require('<path>')` naming exactly this module. */
const importsModule = (src: string, module: string): boolean =>
  new RegExp(`(?:from\\s+|import\\(\\s*|require\\(\\s*)['"][^'"]*\\/${module}['"]`).test(src);

declare const global: { __DEV__: boolean };
const REAL_DEV = global.__DEV__;
afterEach(() => { global.__DEV__ = REAL_DEV; });

describe('the login screen carries no bypass', () => {
  const login = code('app/(auth)/login.tsx');

  it('none of the bypass strings or the seeder are in it', () => {
    for (const s of ['Demo Modu', 'Girişi Geç', 'handleBypassLogin', 'demo-local', 'Aderyth Demo', 'seedDemoData']) {
      expect({ s, present: login.includes(s) }).toEqual({ s, present: false });
    }
  });

  it('the dev-only button is loaded behind __DEV__, by require, so a release build drops it', () => {
    expect(login).toMatch(/=\s*__DEV__\s*\?\s*require\('\.\.\/\.\.\/components\/auth\/DevDemoLoginButton'\)\.default\s*:\s*null/);
    expect(login).not.toMatch(/import\s+[^;]*DevDemoLoginButton[^;]*from/);
  });

  it('DevDemoLoginButton is referenced by the login screen and nothing else', () => {
    const refs = PRODUCTION
      .filter((p) => p !== 'components/auth/DevDemoLoginButton.tsx')
      .filter((p) => code(p).includes('DevDemoLoginButton'));
    expect(refs).toEqual(['app/(auth)/login.tsx']);
  });

  it('the Notion sign-in stays behind its own gate (scope addendum)', () => {
    expect(login).toContain('NOTION_INTEGRATION_ENABLED');
  });
});

describe('the seeder has one way in', () => {
  it('scanner sanity: the production sources were read', () => {
    expect(PRODUCTION.length).toBeGreaterThan(150);
    expect(importsModule("import { x } from '../../lib/demoSeed';", 'demoSeed')).toBe(true);
    expect(importsModule("import { x } from '../../lib/demoSeedGate';", 'demoSeed')).toBe(false);
  });

  it('only lib/demoSeedGate.ts loads lib/demoSeed', () => {
    expect(PRODUCTION.filter((p) => importsModule(code(p), 'demoSeed'))).toEqual(['lib/demoSeedGate.ts']);
  });

  it('the gate is used by the dev login button and Settings, nothing else', () => {
    expect(PRODUCTION.filter((p) => importsModule(code(p), 'demoSeedGate')))
      .toEqual(['app/tabs/settings.tsx', 'components/auth/DevDemoLoginButton.tsx']);
  });

  it('Settings no longer imports the seeder and asks the gate instead', () => {
    const settings = code('app/tabs/settings.tsx');
    expect(settings).not.toMatch(/from '\.\.\/\.\.\/lib\/demoSeed'/);
    expect(settings).toContain('loadDemoSeed');
    // the row is behind __DEV__ itself, so Metro folds it out of a release bundle as well
    expect(settings).toMatch(/\{__DEV__ && /);
  });

  it('in the gate, `if (!__DEV__) return null;` comes before the require', () => {
    const gate = code('lib/demoSeedGate.ts');
    const guard = gate.indexOf('if (!__DEV__) return null;');
    const load = gate.indexOf("require('./demoSeed')");
    expect(guard).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(guard);
  });

  it('... and the require itself sits in a `__DEV__ ?` branch (Metro folds a branch before collecting dependencies; it does not drop statements after a return)', () => {
    const gate = code('lib/demoSeedGate.ts');
    expect(gate).toMatch(/__DEV__\s*\?\s*\(?\s*require\('\.\/demoSeed'\)/);
    // every require of the seeder or the dev button, anywhere in production code, is in such a branch
    for (const p of PRODUCTION) {
      const src = code(p);
      for (const m of src.matchAll(/require\('[^']*\/(demoSeed|DevDemoLoginButton)'\)/g)) {
        const before = src.slice(Math.max(0, m.index! - 80), m.index!);
        expect({ p, module: m[1], inDevBranch: /__DEV__\s*\?\s*\(?\s*$/.test(before) }).toEqual({ p, module: m[1], inDevBranch: true });
      }
    }
  });

  it('the seeder documents its single loading path', () => {
    expect(raw('lib/demoSeed.ts')).toContain('lib/demoSeedGate.ts');
  });
});

describe('behaviour', () => {
  it('a release build gets null', () => {
    global.__DEV__ = false;
    expect(loadDemoSeed()).toBeNull();
  });

  it('a development build gets the module, whose own guard follows __DEV__', () => {
    global.__DEV__ = true;
    const mod = loadDemoSeed();
    expect(mod).not.toBeNull();
    expect(typeof mod!.seedDemoData).toBe('function');
    expect(mod!.isSeedingAllowed()).toBe(true);
    global.__DEV__ = false;
    expect(mod!.isSeedingAllowed()).toBe(false);
  });
});
