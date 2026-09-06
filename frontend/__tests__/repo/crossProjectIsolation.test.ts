/**
 * The unrelated Supabase project must not appear in anything actionable.
 *
 * ## Why this exists, and why the previous guard was not enough
 *
 * This repository has been pointed at a SEPARATE, UNRELATED Supabase project
 * more than once. `supabase/predeploy_guard.sh` was written for it and does
 * its job: it refuses a deploy whose resolved ref is the denied one. But a
 * guard that runs at deploy time only sees the deploy target. It never sees a
 * document.
 *
 * And a document is exactly how it came back. `SUPABASE_PASSWORD_RECOVERY_SETUP.md`
 * — tracked, operator-facing, and the guide you would actually open while
 * configuring auth email — carried a live dashboard link:
 *
 *     https://supabase.com/dashboard/project/<denied>/auth/templates
 *
 * under the heading "open THIS project's email templates". Following it would
 * have taken someone into the other project's Authentication settings and had
 * them edit its templates. Nothing in the build could have noticed, because
 * nothing in the build reads Markdown. A second file asserted the denied ref
 * as the frontend's "proven current" project reference.
 *
 * So this gate reads the whole tracked tree, not just config.
 *
 * ## The distinction it draws
 *
 * Naming the denied project is not the problem — the guard has to name it to
 * deny it, and the incident history has to name it to describe what happened.
 * Being able to ACT on it is the problem. Two separate rules:
 *
 *   A. the bare ref may appear only in the guard or in the declared historical
 *      corpus. Anywhere else — a new doc, a script, a config — is a failure,
 *      which is the rule that would have caught the setup guide.
 *
 *   B. an ACTIONABLE reference — a dashboard URL or an API host pointing at
 *      the denied project — may not appear anywhere at all, history included.
 *      A record of the incident can say what the ref was; it has no reason to
 *      hand anyone a working link to the place they must not touch.
 *
 * Rule B is the stricter one and is deliberately not exempted for history.
 *
 * ## Scope
 *
 * Tracked files only, via `git ls-files`, for two reasons: an untracked file
 * is not something CI can be responsible for, and the working tree on a
 * developer machine legitimately holds things (a local `.env`) this test has
 * no business reading. Untracked contamination is a separate check — see the
 * isolation audit in `docs/`.
 */
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');

/** The one project this repository may target. */
const CANONICAL = 'kbcuolhjjnmhjaarxxmu';

/**
 * The unrelated project. Assembled rather than written out so that this file
 * does not itself become a hit for the very scan it performs — the test would
 * otherwise have to exempt itself, and a scanner with an exemption for its own
 * source is one edit away from exempting something else.
 */
const DENIED = ['zdqiuj', 'peewty', 'htcqhdcj'].join('');

/**
 * Where naming the denied project is legitimate.
 *
 * `predeploy_guard.sh` must name it to deny it. The rest is the recorded
 * history of the incident — audits, plans, progress logs — which exists
 * precisely so the mistake is not repeated, and would be worth less with the
 * ref redacted out of it.
 *
 * This list is deliberately explicit. A new path is not added to it by
 * accident: adding one is a diff a reviewer sees, next to whatever justifies
 * it.
 */
const ALLOWED_TO_NAME_IT: RegExp[] = [
  /^supabase\/predeploy_guard\.sh$/,          // the guard itself
  /^supabase\/config\.toml$/,                  // pins project_id; names it only to disclaim it
  /^tools\/audit\//,                           // checkers that look FOR the ref
  /^docs\/audit\//,                            // the incident record
  /^docs\/plan\//,                             // the plans written around it
  /^docs\/(AUDIT|MIGRATION|REPO_HEALTH|FINAL_GAP_AUDIT)_V2\.md$/,
  /^PROGRESS\.md$/,
  /^todolist\.md$/,
];

/** Anything a person or a tool could follow to reach the denied project. */
const ACTIONABLE = [
  { what: 'dashboard URL', re: new RegExp(`supabase\\.com/dashboard/project/${DENIED}`) },
  { what: 'API host', re: new RegExp(`${DENIED}\\.supabase\\.co`) },
  { what: 'functions host', re: new RegExp(`${DENIED}\\.functions\\.supabase\\.co`) },
];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function read(rel: string): string {
  try {
    return readFileSync(join(REPO, rel), 'utf8');
  } catch {
    return ''; // binary or unreadable: it cannot contain a ref we care about
  }
}

const FILES = trackedFiles();
const WITH_REF = FILES.filter((f) => read(f).includes(DENIED));

describe('the scan is looking at something', () => {
  it('sees the tracked tree', () => {
    // A `git ls-files` that returned nothing would make every assertion below
    // pass for the worst possible reason.
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('still finds the guard, which must name the denied project', () => {
    // The positive control. If this stops matching, either the guard is gone
    // or the scanner has stopped reading files, and both are failures wearing
    // a green tick.
    expect(WITH_REF).toContain('supabase/predeploy_guard.sh');
  });
});

describe('rule A — only the guard and the incident record may name it', () => {
  it('no other tracked file mentions the denied project', () => {
    const rogue = WITH_REF.filter((f) => !ALLOWED_TO_NAME_IT.some((re) => re.test(f)));
    expect(rogue).toEqual([]);
  });
});

describe('rule B — nothing may be actionable, not even history', () => {
  it('no tracked file contains a link or host for the denied project', () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const body = read(f);
      if (!body.includes(DENIED)) continue;
      for (const { what, re } of ACTIONABLE) {
        if (re.test(body)) hits.push(`${f}: ${what}`);
      }
    }
    // History may record WHAT the ref was. It has no reason to ship a working
    // link to it, and the one file that did was an operator setup guide.
    expect(hits).toEqual([]);
  });
});

describe('the active target is the canonical project', () => {
  it('supabase/config.toml pins project_id to it', () => {
    const toml = read('supabase/config.toml');
    const m = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(toml);
    expect(m?.[1]).toBe(CANONICAL);
  });

  it('the deploy guard names it as canonical and the other as denied', () => {
    const guard = read('supabase/predeploy_guard.sh');
    expect(new RegExp(`^CANONICAL="${CANONICAL}"`, 'm').test(guard)).toBe(true);
    expect(new RegExp(`^DENIED="${DENIED}"`, 'm').test(guard)).toBe(true);
  });

  it('the Expo config is Aderyth and names no foreign project', () => {
    const raw = read('frontend/app.json');
    expect(raw).not.toContain(DENIED);
    const expo = JSON.parse(raw).expo;
    expect(expo.name).toBe('Aderyth');
    expect(expo.slug).toBe('aderyth');
    // The scheme is deliberately NOT the product name: it is registered in the
    // Notion and Google consoles and in the edge allowlist. See brandResidue.
    expect(expo.scheme).toBe('atlas');

    // The identifiers are no longer absent. The owner controls aderyth.com,
    // which is what makes `com.aderyth` a namespace we may claim rather than a
    // guess that could collide with a real listing.
    expect(expo.ios?.bundleIdentifier).toBe('com.aderyth.app');
    expect(expo.android?.package).toBe('com.aderyth.app');

    // The isolation invariant this file exists for, unchanged and now applied
    // to values that actually exist: neither may name the other project, and
    // neither may carry a placeholder into a store submission.
    for (const id of [expo.ios?.bundleIdentifier, expo.android?.package]) {
      expect(String(id)).not.toContain(DENIED);
      expect(String(id)).not.toContain('placeholder');
      expect(String(id)).not.toContain('sandbox');
      expect(String(id)).not.toContain('example');
    }
  });

  it('no alternate Expo config has appeared to disagree with app.json', () => {
    // `app.config.js/ts` would take precedence over `app.json` if it existed,
    // so a check that only reads `app.json` could be looking at the wrong file.
    for (const alt of ['frontend/app.config.js', 'frontend/app.config.ts', 'frontend/app.config.json']) {
      expect({ alt, exists: existsSync(join(REPO, alt)) }).toEqual({ alt, exists: false });
    }
  });

  it('CI defines no Supabase deploy step that could target anything', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toContain(DENIED);
    expect(/supabase\s+(link|db\s+push|functions\s+deploy)/.test(ci)).toBe(false);
  });
});
