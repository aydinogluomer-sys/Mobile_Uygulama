/**
 * R06.01 — "Mevcut tasarım sistemi ve en tutarlı ekranı tespit et.
 * Token/bileşen kullanımını yay; yeni UI kit ... açma."
 * docs/implementation-v3/R06_DESIGN_SYSTEM.md
 *
 * A ratchet, not a redesign: a raw hex equal to a design token must use the
 * token; the remaining raw palette colours may only go down.
 */
import * as fs from 'fs';
import * as path from 'path';
import { colors } from '../../lib/tokens';

const ROOT = path.join(__dirname, '../..');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`;
    if (e.isDirectory()) walk(rel);
    else if (e.name.endsWith('.tsx')) files.push(rel);
  }
};
walk('app'); walk('components');

const HEX = /["'](#[0-9A-Fa-f]{3,8})["']/g;
const norm = (h: string) => {
  const x = h.slice(1).toUpperCase();
  return x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
};
const tokenValues = new Set(Object.values(colors as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && v.startsWith('#')).map(norm));
const literals = files.flatMap((f) => [...fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(HEX)].map((m) => ({ f, hex: m[1] })));

it('finds the UI (scanner sanity)', () => {
  expect(files.length).toBeGreaterThan(60);
  expect(tokenValues.has(norm(colors.textFaint))).toBe(true); // reads the token (its value changed in R06.04)
});

it('no raw hex equal to a design token: use colors.*', () => {
  const offenders = literals.filter((l) => tokenValues.has(norm(l.hex))).map((l) => `${l.f} ${l.hex}`);
  expect(offenders).toEqual([]);
});

it('the remaining raw palette colours only go down (407 before R06.01)', () => {
  expect(literals.length).toBeLessThanOrEqual(141);
});

it('the reference screens use tokens only', () => {
  for (const f of ['app/tabs/today.tsx', 'app/screens/recovery.tsx', 'app/screens/routine-runner.tsx']) {
    expect(literals.filter((l) => l.f === f)).toEqual([]);
  }
});
