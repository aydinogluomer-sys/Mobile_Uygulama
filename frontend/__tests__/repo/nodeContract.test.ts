/**
 * F08 (BLD-07) — single Node version contract across `.nvmrc`, `frontend/.npmrc`,
 * `frontend/package.json#engines`, `frontend/eas.json` and GitHub Actions workflows.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FRONTEND = join(__dirname, '..', '..');
const REPO = join(FRONTEND, '..');

type Semver = readonly [number, number, number];

function parseSemver(raw: string): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!m) return null;
  return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10)];
}

function cmpSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function satisfiesComparator(v: Semver, comp: string): boolean {
  const trimmed = comp.trim();
  if (!trimmed) return true;

  if (trimmed.startsWith('^')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return false;
    if (cmpSemver(v, base) < 0) return false;
    if (base[0] > 0) return v[0] === base[0];
    if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
    return v[0] === 0 && v[1] === 0 && v[2] === base[2];
  }

  if (trimmed.startsWith('~')) {
    const base = parseSemver(trimmed.slice(1));
    if (!base) return false;
    return v[0] === base[0] && v[1] === base[1] && v[2] >= base[2];
  }

  const opMatch = /^(>=|<=|>|<|=)\s*(.+)$/.exec(trimmed);
  if (opMatch) {
    const base = parseSemver(opMatch[2]);
    if (!base) return false;
    const c = cmpSemver(v, base);
    switch (opMatch[1]) {
      case '>=':
        return c >= 0;
      case '<=':
        return c <= 0;
      case '>':
        return c > 0;
      case '<':
        return c < 0;
      default:
        return c === 0;
    }
  }

  const exact = parseSemver(trimmed);
  return exact !== null && cmpSemver(v, exact) === 0;
}

/** Evaluates npm-style disjunctive semver ranges (`^20.19.4 || ^22.13.0 || >=25.0.0`). */
export function satisfiesEngines(version: string, range: string): boolean {
  const v = parseSemver(version);
  if (!v || !range.trim()) return false;
  const branches = range.split('||').map((b) => b.trim()).filter(Boolean);
  if (branches.length === 0) return false;
  return branches.some((branch) => {
    const normalized = branch.replace(/([><=!~^])\s+(\d)/g, '$1$2');
    const comparators = normalized.split(/\s+/).filter(Boolean);
    return comparators.every((comp) => satisfiesComparator(v, comp));
  });
}

function isStrictNodeContract(enginesNode: string | undefined): boolean {
  if (!enginesNode) return false;
  // Must reject unpatched / incompatible lines like 20.10.0 and 22.0.0 that `>=20` let through.
  if (satisfiesEngines('20.10.0', enginesNode)) return false;
  if (satisfiesEngines('22.0.0', enginesNode)) return false;
  if (satisfiesEngines('18.20.0', enginesNode)) return false;
  return satisfiesEngines('22.13.0', enginesNode);
}

describe('BLD-07 — Node version contract across .nvmrc, .npmrc, package.json, eas.json and CI', () => {
  const nvmrcPath = join(REPO, '.nvmrc');
  const npmrcPath = join(FRONTEND, '.npmrc');
  const pkg = JSON.parse(readFileSync(join(FRONTEND, 'package.json'), 'utf8')) as {
    engines?: { node?: string };
  };
  const eas = JSON.parse(readFileSync(join(FRONTEND, 'eas.json'), 'utf8')) as {
    build?: Record<string, { node?: string }>;
  };
  const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
  const release = readFileSync(join(REPO, '.github', 'workflows', 'supabase-release-verify.yml'), 'utf8');

  it('(+) .nvmrc exists, pins a concrete semver and satisfies package.json engines.node', () => {
    expect(existsSync(nvmrcPath)).toBe(true);
    const nvmrc = readFileSync(nvmrcPath, 'utf8').trim();
    expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/);
    const enginesNode = pkg.engines?.node ?? '';
    expect(isStrictNodeContract(enginesNode)).toBe(true);
    expect(satisfiesEngines(nvmrc, enginesNode)).toBe(true);
    // Also covers modern Windows dev machines (>=25.0.0) without breaking engine-strict.
    expect(satisfiesEngines('26.3.0', enginesNode)).toBe(true);
  });

  it('(+) frontend/.npmrc enforces engine-strict=true', () => {
    expect(existsSync(npmrcPath)).toBe(true);
    const npmrc = readFileSync(npmrcPath, 'utf8');
    expect(npmrc).toMatch(/^\s*engine-strict\s*=\s*true\s*$/m);
  });

  it('(+) eas.json specifies a valid node version in every build profile', () => {
    const profiles = Object.entries(eas.build ?? {});
    expect(profiles.length).toBeGreaterThanOrEqual(2);
    const nvmrc = readFileSync(nvmrcPath, 'utf8').trim();
    const enginesNode = pkg.engines?.node ?? '';
    for (const [name, profile] of profiles) {
      expect({ name, node: profile.node }).toEqual({ name, node: nvmrc });
      expect(satisfiesEngines(profile.node ?? '', enginesNode)).toBe(true);
    }
  });

  it('(+) CI and release workflows resolve Node from .nvmrc with no floating node-version string', () => {
    expect(ci).toContain('node-version-file: .nvmrc');
    expect(ci).not.toMatch(/^\s*node-version:/m);
    expect(ci).not.toContain('SDK 54');
    expect(release).toContain('node-version-file: .nvmrc');
    expect(release).not.toMatch(/^\s*node-version:/m);
  });

  it('(-) rejects incompatible Node versions (20.10.0, 22.0.0) and rejects a loose >=20 contract', () => {
    const enginesNode = pkg.engines?.node ?? '';
    expect(satisfiesEngines('20.10.0', enginesNode)).toBe(false);
    expect(satisfiesEngines('22.0.0', enginesNode)).toBe(false);
    expect(satisfiesEngines('24.0.0', enginesNode)).toBe(false);
    expect(isStrictNodeContract('>=20')).toBe(false);
  });
});
