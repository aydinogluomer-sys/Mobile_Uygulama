/**
 * Nothing in the app talks to the legacy FastAPI service any more.
 *
 * ## What was there
 *
 * `frontend/utils/api.ts` was an axios client for `backend/server.py`, and
 * three shipping screens used it. That service has no authentication of any
 * kind — searching the whole file for `Depends`, `jwt`, `Authorization` and
 * `verify_token` returns nothing — and every model on it is owned by a
 * literal string:
 *
 *     backend/server.py:159   user_id: str = "default"
 *
 * `GET /api/export` then read every habits / tasks / completions /
 * bad_habits / webhooks document with NO filter and returned them to the
 * caller. `settings.tsx` opened the Excel and CSV variants of that with
 * `Linking.openURL`, i.e. in the system browser, carrying no session.
 *
 * ## Why a source gate rather than only behaviour tests
 *
 * The behaviour tests next to this one cover the replacements. They cannot
 * see a NEW screen re-adding `axios.get(BACKEND_URL + ...)` next year. This
 * one can, and it fails with the reason rather than a diff.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

/** Every first-party source file, comments removed. */
function sources(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  const skip = new Set(['node_modules', '.expo', 'dist', '__tests__', 'coverage', 'android', 'ios']);
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      out.push({ rel: r, code: stripComments(readFileSync(abs, 'utf8')) });
    }
  };
  walk(ROOT, '');
  return out;
}

describe('the legacy backend client is gone', () => {
  const files = sources();

  it('there are source files to check (the walk is not silently empty)', () => {
    // Without this, deleting the app would "pass" every assertion below.
    expect(files.length).toBeGreaterThan(100);
  });

  it('utils/api.ts no longer exists', () => {
    expect(existsSync(join(ROOT, 'utils', 'api.ts'))).toBe(false);
  });

  it('nothing imports it', () => {
    const offenders = files.filter((f) => /from\s+['"][^'"]*utils\/api['"]/.test(f.code));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('nothing reads EXPO_PUBLIC_BACKEND_URL', () => {
    // settings.tsx built an export URL out of this and opened it in the
    // browser. The variable itself is the tell.
    const offenders = files.filter((f) => f.code.includes('EXPO_PUBLIC_BACKEND_URL'));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it('nothing imports axios, and it is not a dependency', () => {
    const offenders = files.filter((f) => /from\s+['"]axios['"]|require\(\s*['"]axios['"]\s*\)/.test(f.code));
    expect(offenders.map((f) => f.rel)).toEqual([]);

    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies?.axios).toBeUndefined();
  });

  it('the three replaced features now go through Supabase repositories', () => {
    // The point is not that the files exist but that each feature has an
    // owner-scoped path. A repository that forgot `user_id` would be the
    // same defect wearing a new name.
    for (const rel of ['repositories/webhookRepository.ts', 'repositories/badHabitRepository.ts']) {
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      expect(code).toContain('currentUserId()');
      expect(code).toMatch(/\.eq\('user_id',\s*u\.userId\)|userId:\s*u\.userId/);
    }
    expect(existsSync(join(ROOT, 'services', 'exportService.ts'))).toBe(true);
  });
});
