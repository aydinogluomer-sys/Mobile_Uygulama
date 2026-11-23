/**
 * Found in R07.03: `'Ekim'.toUpperCase()` is "EKIM", not "EKİM" -- the
 * calendar header and the archive's month headings were wrong. UI text is
 * uppercased with the Turkish locale; plain `toUpperCase()` is allowed only
 * on known-ASCII values (file format names).
 */
import * as fs from 'fs';
import * as path from 'path';
import { catalog } from '../helpers/catalog';

const ROOT = path.join(__dirname, '../..');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`;
    if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.tsx')) files.push(rel);
  }
};
walk('app'); walk('components');

export function findPlainToUpperCaseOffenders(src: string, label: string): string[] {
  return [...src.matchAll(/([\w.$]+|\))\s*\.toUpperCase\(\)/g)]
    .filter((m) => !/^(fmt|format)$/.test(m[1]))
    .map((m) => `${label}: ${m[0]}`);
}

it('the locale matters', () => {
  expect('Ekim'.toUpperCase()).toBe('EKIM');
  expect('Ekim'.toLocaleUpperCase('tr-TR')).toBe('EKİM');
});

it('UI code uppercases Turkish text with the tr-TR locale (including call receivers like t(...).toUpperCase())', () => {
  const offenders = files.flatMap((f) =>
    findPlainToUpperCaseOffenders(fs.readFileSync(path.join(ROOT, f), 'utf8'), f),
  );
  expect(offenders).toEqual([]);

  // Negative check: t('x').toUpperCase() is caught while format.toUpperCase() stays allowed
  expect(findPlainToUpperCaseOffenders("t('today.rituals.overline').toUpperCase()", 'synthetic.tsx')).toEqual([
    'synthetic.tsx: ).toUpperCase()',
  ]);
  expect(findPlainToUpperCaseOffenders('format.toUpperCase()', 'synthetic.tsx')).toEqual([]);
});

it('every *.overline value in locales/tr.json is already tr-TR uppercase', () => {
  const overlineEntries = Object.entries(catalog).filter(([k]) => k.endsWith('.overline'));
  expect(overlineEntries.length).toBeGreaterThan(0);
  const bad = overlineEntries
    .filter(([, v]) => v !== v.toLocaleUpperCase('tr-TR'))
    .map(([k, v]) => `${k}: ${v}`);
  expect(bad).toEqual([]);
});
