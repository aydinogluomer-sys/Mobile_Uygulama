/**
 * F08 (BLD-12, BLD-23) — no tracked script may create accounts or attempt password sign-in against
 * the canonical Supabase project, carry published test credentials, or wipe app source directories.
 */
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FRONTEND = join(__dirname, '..', '..');
const REPO = join(FRONTEND, '..');
const CANONICAL_HOST = 'kbcuolhjjnmhjaarxxmu.supabase.co';

const SCRIPT_FILE_RE = /\.(?:c|m)?[jt]s$|\.py$|\.ps1$|\.sh$/i;

function isExempt(relPath: string): boolean {
  return (
    relPath.startsWith('supabase/functions/') ||
    relPath.startsWith('frontend/__tests__/') ||
    relPath.startsWith('docs/')
  );
}

/**
 * Returns descriptions of live-auth write / credential-stuffing / throwaway-signup patterns found
 * in a script's text; `[]` when clean.
 */
export function liveWriters(text: string): string[] {
  const hits: string[] = [];

  if (/TestHabit123/.test(text)) {
    hits.push('hardcoded TestHabit123 credential');
  }

  if (/`[^`]*\$\{\s*Date\.now\(\)\s*\}[^`]*@[\w.-]+`/.test(text)) {
    hits.push('Date.now() throwaway signup email');
  }

  const mentionsCanonical = text.includes(CANONICAL_HOST);
  const hitsLiveAuthEndpoint =
    /\/auth\/v1\/(?:signup|token)\b/.test(text) ||
    /\bauth\.(?:signUp|signInWithPassword)\s*\(/.test(text);
  if (mentionsCanonical && hitsLiveAuthEndpoint) {
    hits.push('canonical Supabase URL paired with auth signup/login call');
  }

  return hits;
}

function trackedScriptFiles(): string[] {
  return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((l) => l.trim())
    .filter((f) => Boolean(f) && SCRIPT_FILE_RE.test(f) && !isExempt(f));
}

describe('BLD-12 / BLD-23 — no tracked live-writing or destructive starter scripts', () => {
  const scripts = trackedScriptFiles();

  it('(+) scans a non-trivial set of tracked scripts', () => {
    expect(scripts.length).toBeGreaterThan(20);
  });

  it('(+) retired live-auth and starter wipe scripts are absent from disk', () => {
    for (const rel of [
      'tools/test_supabase_login.mjs',
      'test_ai_routine.mjs',
      'backend_test.py',
      'frontend/scripts/reset-project.js',
    ]) {
      expect({ rel, exists: existsSync(join(REPO, rel)) }).toEqual({ rel, exists: false });
    }
  });

  it('(+) no tracked non-exempt script writes test accounts or credentials to the live project', () => {
    const offenders: Record<string, string[]> = {};
    for (const rel of scripts) {
      let body = '';
      try {
        body = readFileSync(join(REPO, rel), 'utf8');
      } catch {
        continue;
      }
      const reasons = liveWriters(body);
      if (reasons.length > 0) offenders[rel] = reasons;
    }
    expect(offenders).toEqual({});
  });

  it('(-) liveWriters() flags synthetic canonical signup, Date.now() email and TestHabit123 patterns', () => {
    const synthetic = [
      `const url = 'https://${CANONICAL_HOST}/auth/v1/signup';`,
      'const email = `dev_${Date.now()}@aderyth.app`;',
      "const pass = 'TestHabit123!';",
    ].join('\n');
    expect(liveWriters(synthetic)).toEqual([
      'hardcoded TestHabit123 credential',
      'Date.now() throwaway signup email',
      'canonical Supabase URL paired with auth signup/login call',
    ]);
    expect(liveWriters('const ok = "https://localhost:54321";')).toEqual([]);
  });
});
