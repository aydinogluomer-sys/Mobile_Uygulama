/**
 * Found in R07.03: `'Ekim'.toUpperCase()` is "EKIM", not "EKİM" -- the
 * calendar header and the archive's month headings were wrong. UI text is
 * uppercased with the Turkish locale; plain `toUpperCase()` is allowed only
 * on known-ASCII values (file format names).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = `${d}/${e.name}`;
    if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.tsx')) files.push(rel);
  }
};
walk('app'); walk('components');

it('the locale matters', () => {
  expect('Ekim'.toUpperCase()).toBe('EKIM');
  expect('Ekim'.toLocaleUpperCase('tr-TR')).toBe('EKİM');
});

it('UI code uppercases Turkish text with the tr-TR locale', () => {
  const offenders = files.flatMap((f) => [...fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/([\w.$]+)\.toUpperCase\(\)/g)]
    .filter((m) => !/^(fmt|format)$/.test(m[1]))
    .map((m) => `${f}: ${m[0]}`));
  expect(offenders).toEqual([]);
});
