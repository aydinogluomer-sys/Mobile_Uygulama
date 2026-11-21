/**
 * F08 (BLD-22) — repository root allowlist and removal of stray screenshots, patches,
 * root Playwright lockfile and `awwwards-loop` directories.
 */
import { execFileSync } from 'child_process';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');

/**
 * Allowed top-level files and directories in `git ls-files` (implementation.md F08 step 45,
 * plus `.agents` from baseline tooling commit 09345427 and `.gitattributes` from F00 / OD-01).
 */
export const ALLOWED_ROOT_ENTRIES: ReadonlySet<string> = new Set([
  '.agents',
  '.claude',
  '.codex',
  '.emergent',
  '.gitattributes',
  '.github',
  '.gitignore',
  '.nvmrc',
  'NOTION_COMPATIBILITY_SUMMARY.md',
  'PROGRESS.md',
  'README.md',
  'SPOTIFY_SETUP.md',
  'TODO.md',
  'docs',
  'frontend',
  'implementation-atlas-redesign.md',
  'implementation-liste.md',
  'implementation-ozet.md',
  'implementation-takvim-arkaplan.md',
  'implementation-telafi.md',
  'implementation-ui.md',
  'implementation.md',
  'obsidian-atlas-plugin',
  'skills-lock.json',
  'supabase',
  'todolist.md',
  'tools',
]);

/** Returns sorted top-level root entries from `tracked` paths that are not in `allowed`. */
export function unexpectedRootEntries(
  tracked: readonly string[],
  allowed: ReadonlySet<string>,
): string[] {
  const unexpected = new Set<string>();
  for (const raw of tracked) {
    const clean = raw.trim().replace(/^"+|"+$/g, '');
    if (!clean) continue;
    const rootEntry = clean.split('/')[0];
    if (rootEntry && !allowed.has(rootEntry)) {
      unexpected.add(rootEntry);
    }
  }
  return [...unexpected].sort();
}

function trackedFiles(): string[] {
  return execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

describe('BLD-22 — repository root allowlist and stray artifact removal', () => {
  const tracked = trackedFiles();

  it('(+) reads the tracked repository file list', () => {
    expect(tracked.length).toBeGreaterThan(200);
  });

  it('(+) every top-level tracked entry belongs to the explicit root allowlist', () => {
    expect(unexpectedRootEntries(tracked, ALLOWED_ROOT_ENTRIES)).toEqual([]);
  });

  it('(+) neither root awwwards-loop/ nor frontend/awwwards-loop/ is tracked', () => {
    const leftovers = tracked.filter(
      (p) => p.startsWith('awwwards-loop/') || p.startsWith('frontend/awwwards-loop/'),
    );
    expect(leftovers).toEqual([]);
  });

  it('(-) unexpectedRootEntries() flags synthetic stray screenshots, scripts and directories', () => {
    const synthetic = [
      'README.md',
      'frontend/package.json',
      'ss_99.png',
      'new_script.py',
      'awwwards-loop/reports/index.json',
    ];
    expect(unexpectedRootEntries(synthetic, ALLOWED_ROOT_ENTRIES)).toEqual([
      'awwwards-loop',
      'new_script.py',
      'ss_99.png',
    ]);
  });
});
