/**
 * R10.02 — the single-effect table cites real tests. Every "file › name" in
 * docs/implementation-v3/R10_SINGLE_EFFECT.md must be an `it(...)` in that
 * file, so the table cannot keep claiming a guarantee whose test is gone.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const doc = readFileSync(join(ROOT, '..', 'docs', 'implementation-v3', 'R10_SINGLE_EFFECT.md'), 'utf8');

function citations(): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const row of doc.split('\n').filter((l) => l.startsWith('| ') && l.includes(' › '))) {
    const cell = row.split(' | ').slice(-1)[0].replace(/\|\s*$/, '');
    let file = '';
    for (const part of cell.split(' · ')) {
      const m = /^`([^`]+\.test\.tsx?)`\s*›\s*(.+)$/.exec(part.trim());
      if (m) { file = m[1]; out.push({ file, name: m[2].trim() }); continue; }
      const cont = /^›\s*(.+)$/.exec(part.trim());
      if (cont && file) out.push({ file, name: cont[1].trim() });
    }
  }
  return out;
}

it('the table cites at least one test per row, 9 rows', () => {
  const rows = doc.split('\n').filter((l) => /^\| [^-|]/.test(l) && !l.startsWith('| Eylem'));
  expect(rows).toHaveLength(9);
  expect(citations().length).toBeGreaterThanOrEqual(15);
});

it.each(citations().map((c) => [c.file, c.name]))('%s › %s exists', (file, name) => {
  const src = readFileSync(join(ROOT, '__tests__', file), 'utf8');
  const unescaped = name.split('\\`').join('`');
  const quoted = [`'${unescaped.split("'").join("\\'")}'`, `"${unescaped}"`, `\`${unescaped}\``];
  expect(quoted.some((q) => src.includes(`it(${q}`))).toBe(true);
});
