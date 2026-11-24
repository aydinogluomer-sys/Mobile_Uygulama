/**
 * F08 (BLD-03) — the advisory budget is a ceiling, not a wish.
 *
 * `npm audit` needs the network, so the gate itself runs in CI (`npm audit --omit=dev
 * --audit-level=<ciAuditLevel>`). This suite holds the offline half: the lockfile, package.json
 * overrides and frontend/audit-budget.json must agree, the critical count is zero, and the one
 * shipped advisory path (expo-router -> query-string -> decode-uri-component) is either patched
 * through an override or carried as a dated, reasoned triage entry — never silently.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const FRONTEND = join(__dirname, '..', '..');
const REPO = join(FRONTEND, '..');

type Lock = { packages?: Record<string, { version?: string }> };
type Pkg = { overrides?: Record<string, unknown> };
type TriageEntry = { package: string; severity: string; reason: string; expires: string };
type Budget = {
  generatedFor: string;
  prod: { critical: number; high: number };
  all: { critical: number; high: number };
  ciAuditLevel?: string;
  triage: TriageEntry[];
};

function parse(v: string): number[] {
  return v.replace(/^[^\d]*/, '').split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
}

export function semverGt(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

export function readLockVersion(lock: unknown, pkg: string): string | undefined {
  const packages = (lock as Lock)?.packages ?? {};
  return packages[`node_modules/${pkg}`]?.version;
}

/** Every lockfile copy of `pkg` (hoisted and nested). */
function allLockVersions(lock: Lock, pkg: string): string[] {
  return Object.entries(lock.packages ?? {})
    .filter(([k]) => k === `node_modules/${pkg}` || k.endsWith(`/node_modules/${pkg}`))
    .map(([, v]) => v.version ?? '');
}

/** Flattens npm `overrides` ({a: "1"} or {parent: {a: "1"}}) to [name, spec] pairs. */
function overridePairs(overrides: Record<string, unknown> | undefined): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, spec] of Object.entries(overrides ?? {})) {
    if (typeof spec === 'string') out.push([name, spec]);
    else if (spec && typeof spec === 'object') {
      for (const [child, childSpec] of Object.entries(spec as Record<string, unknown>)) {
        if (child === '.' && typeof childSpec === 'string') out.push([name, childSpec]);
        else if (typeof childSpec === 'string') out.push([child, childSpec]);
      }
    }
  }
  return out;
}

const PATCHED_AFTER = '0.5.0';

/** Why the decode-uri-component path is not acceptable; [] when it is patched or triaged in date. */
export function decodeUriComponentViolations(lock: Lock, pkg: Pkg, budget: Budget, today: string): string[] {
  const overridden = overridePairs(pkg.overrides).some(([name]) => name === 'decode-uri-component');
  const versions = allLockVersions(lock, 'decode-uri-component');
  if (versions.length === 0) return [];
  const unpatched = versions.filter((v) => !semverGt(v, PATCHED_AFTER));
  if (unpatched.length === 0) return [];
  if (overridden) return [`override declared but lockfile still has decode-uri-component ${unpatched.join(', ')}`];
  const entry = budget.triage.find((t) => t.package === 'decode-uri-component');
  if (!entry) return [`decode-uri-component ${unpatched.join(', ')} has neither an override nor a triage entry`];
  const problems: string[] = [];
  if (!entry.reason || entry.reason.trim().length < 20) problems.push('triage entry has no real reason');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) problems.push('triage entry has no expiry date');
  else if (entry.expires < today) problems.push(`triage entry expired on ${entry.expires}`);
  return problems;
}

describe('BLD-03 — lockfile advisory budget', () => {
  const lock = JSON.parse(readFileSync(join(FRONTEND, 'package-lock.json'), 'utf8')) as Lock;
  const pkg = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8')) as Pkg & { scripts?: Record<string, string> };
  const budget = JSON.parse(readFileSync(join(FRONTEND, 'audit-budget.json'), 'utf8')) as Budget;
  const today = new Date().toISOString().slice(0, 10);

  it('(+) audit-budget.json is for this lockfile and allows no critical advisory', () => {
    expect(budget.generatedFor).toBe('frontend/package-lock.json');
    expect(budget.prod.critical).toBe(0);
    expect(budget.all.critical).toBe(0);
    expect(budget.prod.high).toBeLessThanOrEqual(budget.all.high);
  });

  it('(+) the decode-uri-component path is patched by an override or triaged with a reason and a live expiry', () => {
    expect(decodeUriComponentViolations(lock, pkg, budget, today)).toEqual([]);
  });

  it('(+) every triage entry is dated, reasoned and not expired; any high allowed in prod is triaged', () => {
    for (const t of budget.triage) {
      expect(t.package).toMatch(/^[@a-z0-9][\w./-]*$/);
      expect(['high', 'critical', 'moderate', 'low']).toContain(t.severity);
      expect(t.reason.length).toBeGreaterThan(20);
      expect(t.expires >= today).toBe(true);
    }
    const highTriaged = budget.triage.filter((t) => t.severity === 'high').length;
    expect(budget.prod.high).toBeLessThanOrEqual(highTriaged);
  });

  it('(+) package.json overrides and the lockfile agree', () => {
    for (const [name, spec] of overridePairs(pkg.overrides)) {
      const exact = spec.replace(/^[=v]/, '');
      if (/^\d+\.\d+\.\d+$/.test(exact)) {
        expect({ name, versions: allLockVersions(lock, name) }).toEqual({
          name,
          versions: expect.arrayContaining([exact]),
        });
      }
    }
  });

  it('(+) the critical shell-quote advisory is gone from the lockfile (>= 1.11.0)', () => {
    for (const v of allLockVersions(lock, 'shell-quote')) {
      expect(semverGt(v, '1.10.99')).toBe(true);
    }
  });

  it('(+) CI runs the prod audit at the level the budget records, and package.json exposes it', () => {
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    const level = budget.ciAuditLevel ?? 'high';
    expect(ci).toContain(`npm audit --omit=dev --audit-level=${level}`);
    expect(pkg.scripts?.['audit:prod']).toBe(`npm audit --omit=dev --audit-level=${level}`);
  });

  it('(-) a synthetic unpatched lock (0.2.2, no override, no triage) is red; semverGt is strict', () => {
    const synthLock: Lock = { packages: { 'node_modules/decode-uri-component': { version: '0.2.2' } } };
    const empty: Budget = { ...budget, triage: [] };
    expect(decodeUriComponentViolations(synthLock, {}, empty, today)).toHaveLength(1);
    const expired: Budget = {
      ...budget,
      triage: [{ package: 'decode-uri-component', severity: 'high', reason: 'x'.repeat(30), expires: '2000-01-01' }],
    };
    expect(decodeUriComponentViolations(synthLock, {}, expired, today)).toEqual(['triage entry expired on 2000-01-01']);
    expect(
      decodeUriComponentViolations(synthLock, { overrides: { 'query-string': { 'decode-uri-component': '0.5.1' } } }, empty, today),
    ).toHaveLength(1);
    expect(semverGt('0.2.2', '0.5.0')).toBe(false);
    expect(semverGt('0.5.0', '0.5.0')).toBe(false);
    expect(semverGt('0.5.1', '0.5.0')).toBe(true);
    expect(readLockVersion(synthLock, 'decode-uri-component')).toBe('0.2.2');
  });
});
