/**
 * R10.03 — "Yeni kodun hassas bilgi loglamadığını kontrol et."
 *
 * The whole app, not a list: a raw `console.*` call writes to the device log
 * (logcat / Xcode), unscrubbed and outside the crash funnel's redaction. The
 * only console writers allowed are the three that exist for it:
 *   lib/crashReporting.ts        the funnel itself, AFTER scrubbing
 *   lib/analytics.ts             the opt-in developer sink (never attached by default)
 *   components/ui/ErrorBoundary  the component stack, only under __DEV__
 * Everything else reports through `reportError`, which scrubs quoted text and
 * stack lines. And no file anywhere builds an error message out of the user
 * text it holds (the journal/coach half of this lives in noContentInLogs).
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const DIRS = ['app', 'components', 'lib', 'services', 'store', 'hooks', 'repositories'];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [rel] : [];
  });
}
const FILES = DIRS.flatMap(walk);
const CONSOLE = /\bconsole\.(log|warn|error|info|debug|trace)\(/;
const ALLOWED = [
  'lib/crashReporting.ts',
  'lib/analytics.ts',
  'components/ui/ErrorBoundary.tsx',
  'components/ConfigErrorScreen.tsx',
];

it('scans the real tree', () => {
  expect(FILES.length).toBeGreaterThan(250);
  for (const f of ALLOWED) expect(FILES).toContain(f);
});

it('no raw console call outside the four that exist for it', () => {
  const offenders = FILES.filter((f) => !ALLOWED.includes(f) && CONSOLE.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  expect(offenders).toEqual([]);
});

it('the allowed ones stay what they claim: the boundary only in __DEV__, the analytics sink opt-in, config screen names-only', () => {
  const eb = strip(fs.readFileSync(path.join(ROOT, 'components/ui/ErrorBoundary.tsx'), 'utf8'));
  expect(eb).toMatch(/if \(__DEV__ && info\?\.componentStack\) \{\s*console\.error\(/);
  expect((eb.match(CONSOLE_G()) ?? []).length).toBe(1);
  const an = strip(fs.readFileSync(path.join(ROOT, 'lib/analytics.ts'), 'utf8'));
  expect((an.match(CONSOLE_G()) ?? []).length).toBe(1);
  expect(an).toMatch(/export const consoleAnalyticsSink: AnalyticsSink = \(event\) => \{\s*console\.log\(/);
  const cfg = strip(fs.readFileSync(path.join(ROOT, 'components/ConfigErrorScreen.tsx'), 'utf8'));
  expect((cfg.match(CONSOLE_G()) ?? []).length).toBe(1);
  expect(cfg).toContain('/^[A-Z0-9_]+$/.test(n)');
  expect(cfg).toContain('console.error(`[config] Eksik ortam değişkeni: ${names}`)');
});

it('no file builds an error message out of the text it holds', () => {
  const TEXTY = /(throw new Error|reportError)\([^)]*\$\{[^}]*(content|text|message|body|note|title|summary|transcript|prompt)\b/;
  const offenders = FILES.filter((f) => f !== 'lib/crashReporting.ts' && TEXTY.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  expect(offenders).toEqual([]);
});

function CONSOLE_G(): RegExp { return /\bconsole\.(log|warn|error|info|debug|trace)\(/g; }
