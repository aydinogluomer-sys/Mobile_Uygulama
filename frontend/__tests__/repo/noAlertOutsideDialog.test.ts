import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'store', 'repositories'] as const;

// Canonical owner: lib/dialog.ts is the ONLY file allowed to touch Alert / ActionSheetIOS / window dialogs.
const CANONICAL_DIALOG_MODULE = 'lib/dialog.ts';

const FORBIDDEN_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'Alert.alert/prompt', re: /\bAlert\s*\.\s*(alert|prompt)\s*\(/ },
  {
    name: 'react-native Alert/ActionSheetIOS import',
    re: /import\s*\{[^}]*\b(Alert|ActionSheetIOS)\b[^}]*\}\s*from\s*['"]react-native['"]/,
  },
  { name: 'window.alert/confirm/prompt', re: /\bwindow\s*\.\s*(alert|confirm|prompt)\s*\(/ },
  { name: 'ActionSheetIOS', re: /\bActionSheetIOS\b/ },
];

function walkFiles(relDir: string): string[] {
  const abs = join(ROOT, relDir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

function findViolationsInCode(rawSource: string): string[] {
  const stripped = stripComments(rawSource);
  return FORBIDDEN_PATTERNS.filter((p) => p.re.test(stripped)).map((p) => p.name);
}

describe('F24 repo guard — no raw Alert / ActionSheetIOS / window dialog outside lib/dialog.ts', () => {
  const allFiles = DIRS.flatMap(walkFiles);

  it('scans > 250 production TypeScript files', () => {
    expect(allFiles.length).toBeGreaterThan(250);
  });

  it('zero forbidden dialog calls or imports outside lib/dialog.ts', () => {
    const allowed = new Set<string>([CANONICAL_DIALOG_MODULE]);
    const offenders: string[] = [];
    for (const rel of allFiles) {
      if (allowed.has(rel)) continue;
      const raw = readFileSync(join(ROOT, rel), 'utf8');
      const hits = findViolationsInCode(raw);
      if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('positive control: lib/dialog.ts exists and matches Alert.alert and ActionSheetIOS', () => {
    expect(allFiles).toContain(CANONICAL_DIALOG_MODULE);
    const dialogSrc = stripComments(readFileSync(join(ROOT, CANONICAL_DIALOG_MODULE), 'utf8'));
    expect(FORBIDDEN_PATTERNS[0].re.test(dialogSrc)).toBe(true);
    expect(FORBIDDEN_PATTERNS[3].re.test(dialogSrc)).toBe(true);
  });

  it('positive control: app/_layout.tsx mounts <DialogHost /> and eslint.config.js enforces no-restricted-syntax', () => {
    const layoutSrc = stripComments(readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8'));
    expect(layoutSrc).toContain('<DialogHost />');

    const eslintSrc = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');
    expect(eslintSrc).toContain('no-restricted-syntax');
    expect(eslintSrc).toContain("'lib/dialog.ts'");
  });

  it('scanner self-test: catches synthetic violations (including multiline imports) and ignores comments / safe names', () => {
    expect(findViolationsInCode("Alert.alert('Sil');")).toContain('Alert.alert/prompt');
    expect(findViolationsInCode("import {\n  View,\n  Alert,\n} from 'react-native';")).toContain(
      'react-native Alert/ActionSheetIOS import',
    );
    expect(findViolationsInCode("window.confirm('Emin misin?');")).toContain('window.alert/confirm/prompt');
    expect(findViolationsInCode('ActionSheetIOS.showActionSheetWithOptions({}, () => {});')).toContain('ActionSheetIOS');

    expect(findViolationsInCode("await notify('Kaydedildi');")).toEqual([]);
    expect(findViolationsInCode('const Alert2 = 1;')).toEqual([]);
    expect(findViolationsInCode("// Alert.alert('x');\n/* window.confirm('y') */")).toEqual([]);
  });
});
