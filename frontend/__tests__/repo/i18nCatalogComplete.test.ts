import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { SUPPORTED_LOCALES, parseMessage, type MessageNode } from '../../lib/i18n';

const FRONTEND = join(__dirname, '..', '..');

export type RawText = {
  file: string;
  line: number;
  text: string;
  kind: 'jsxText' | 'prop' | 'alert' | 'template';
};

export const ALLOWED_NAMESPACES: ReadonlySet<string> = new Set([
  'common',
  'today',
  'habits',
  'focus',
  'settings',
  'format',
]);

export const KEY_GRAMMAR = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,4}$/;
export const SUFFIX_AFTER_PLACEHOLDER_RE = /\}[’'][A-Za-zçğıöşüÇĞİÖŞÜ]/;
export const CATALOG_MAX_BYTES = 120_000;

const USER_FACING_PROPS: ReadonlySet<string> = new Set([
  'title',
  'subtitle',
  'label',
  'placeholder',
  'accessibilityLabel',
  'accessibilityHint',
  'description',
  'message',
  'text',
  'hint',
  'caption',
  'eyebrow',
  'ctaLabel',
  'actionLabel',
  'confirmLabel',
  'what',
]);

const DIALOG_CALLEES: ReadonlySet<string> = new Set(['notify', 'confirm']);

function hasLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function isTCacheCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
      (ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 't'))
  );
}

function isDialogCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) {
    return DIALOG_CALLEES.has(node.expression.text);
  }
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Alert' &&
    node.expression.name.text === 'alert'
  ) {
    return true;
  }
  return false;
}

function collectValueStringLiterals(
  expr: ts.Expression,
  sf: ts.SourceFile,
  out: { line: number; text: string }[],
): void {
  if (ts.isParenthesizedExpression(expr)) {
    collectValueStringLiterals(expr.expression, sf, out);
    return;
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    if (hasLetter(expr.text)) {
      out.push({ line: lineOf(sf, expr.getStart(sf)), text: expr.text });
    }
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    collectValueStringLiterals(expr.whenTrue, sf, out);
    collectValueStringLiterals(expr.whenFalse, sf, out);
    return;
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
  ) {
    if (expr.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
      collectValueStringLiterals(expr.left, sf, out);
    }
    collectValueStringLiterals(expr.right, sf, out);
  }
}

export function findRawText(source: string, fileName: string): RawText[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const results: RawText[] = [];
  const isTsOnly = !fileName.endsWith('.tsx');

  function visit(node: ts.Node): void {
    // 1. JSX raw text: <Text>Merhaba</Text>
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf).trim();
      if (raw.length > 0 && hasLetter(raw)) {
        results.push({
          file: fileName,
          line: lineOf(sf, node.getStart(sf)),
          text: raw,
          kind: 'jsxText',
        });
      }
    }

    // 1b. JSX child expression yielding raw string literal: <Text>{cond ? 'A' : 'B'}</Text>
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const lits: { line: number; text: string }[] = [];
      collectValueStringLiterals(node.expression, sf, lits);
      for (const lit of lits) {
        results.push({
          file: fileName,
          line: lit.line,
          text: lit.text,
          kind: 'jsxText',
        });
      }
    }

    // 2. User-facing JSX props: title="Kaydet", label={cond ? 'A' : 'B'}, etc.
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const attrName = node.name.text;
      if (USER_FACING_PROPS.has(attrName) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          if (hasLetter(node.initializer.text)) {
            results.push({
              file: fileName,
              line: lineOf(sf, node.initializer.getStart(sf)),
              text: node.initializer.text,
              kind: 'prop',
            });
          }
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const lits: { line: number; text: string }[] = [];
          collectValueStringLiterals(node.initializer.expression, sf, lits);
          for (const lit of lits) {
            results.push({
              file: fileName,
              line: lit.line,
              text: lit.text,
              kind: 'prop',
            });
          }
        }
      }
    }

    // 3. Alert.alert / notify / confirm string arguments
    if (ts.isCallExpression(node) && isDialogCall(node)) {
      for (const arg of node.arguments) {
        const lits: { line: number; text: string }[] = [];
        collectValueStringLiterals(arg, sf, lits);
        for (const lit of lits) {
          results.push({
            file: fileName,
            line: lit.line,
            text: lit.text,
            kind: 'alert',
          });
        }
      }
    }

    // 4. Template literals whose static parts contain letters: `${n} adet`
    if (ts.isTemplateExpression(node)) {
      const staticText =
        node.head.text + node.templateSpans.map((sp) => sp.literal.text).join('');
      if (hasLetter(staticText)) {
        results.push({
          file: fileName,
          line: lineOf(sf, node.getStart(sf)),
          text: node.getText(sf),
          kind: 'template',
        });
      }
    }

    // 5. Plain .ts modules in MIGRATED_FILES (e.g. lib/todayNarrative.ts): string literals outside imports & t('...')
    if (isTsOnly && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      const parent = node.parent;
      const inImportOrExport =
        ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
      const isTKeyArg =
        ts.isCallExpression(parent) && isTCacheCall(parent) && parent.arguments[0] === node;
      const isTypeLiteral = ts.isLiteralTypeNode(parent);
      if (!inImportOrExport && !isTKeyArg && !isTypeLiteral && hasLetter(node.text)) {
        results.push({
          file: fileName,
          line: lineOf(sf, node.getStart(sf)),
          text: node.text,
          kind: 'prop',
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return results;
}

function hasFunctionAncestor(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

export function findModuleLevelT(source: string, fileName: string): number[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: number[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      !hasFunctionAncestor(node)
    ) {
      lines.push(lineOf(sf, node.getStart(sf)));
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return lines;
}

export function findDynamicKeyTCalls(
  source: string,
  fileName: string,
): { line: number; text: string }[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bad: { line: number; text: string }[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't'
    ) {
      const first = node.arguments[0];
      if (
        !first ||
        ts.isTemplateExpression(first) ||
        ts.isBinaryExpression(first)
      ) {
        bad.push({
          line: lineOf(sf, node.getStart(sf)),
          text: node.getText(sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return bad;
}

export function collectTCalls(
  source: string,
  fileName: string,
): { key: string; vars: string[] | null; line: number }[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls: { key: string; vars: string[] | null; line: number }[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 't' &&
      node.arguments.length >= 1
    ) {
      const first = node.arguments[0];
      if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
        let vars: string[] | null = null;
        const second = node.arguments[1];
        if (second && ts.isObjectLiteralExpression(second)) {
          vars = [];
          for (const prop of second.properties) {
            if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
              const propName = ts.isIdentifier(prop.name)
                ? prop.name.text
                : ts.isStringLiteral(prop.name)
                  ? prop.name.text
                  : null;
              if (propName !== null) vars.push(propName);
            }
          }
        }
        calls.push({
          key: first.text,
          vars,
          line: lineOf(sf, node.getStart(sf)),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return calls;
}

export function placeholdersOfNodes(nodes: readonly MessageNode[]): Set<string> {
  const names = new Set<string>();
  const walk = (list: readonly MessageNode[]) => {
    for (const n of list) {
      if (n.kind === 'arg') {
        names.add(n.name);
      } else if (n.kind === 'plural') {
        names.add(n.name);
        for (const branch of Object.values(n.exact)) walk(branch);
        for (const branch of Object.values(n.cases)) {
          if (branch) walk(branch);
        }
        walk(n.other);
      }
    }
  };
  walk(nodes);
  return names;
}

export function validateCatalogJson(rawJson: string): string[] {
  const issues: string[] = [];

  let parsedObj: unknown;
  try {
    parsedObj = JSON.parse(rawJson);
  } catch (err) {
    issues.push(`JSON syntax error: ${err instanceof Error ? err.message : String(err)}`);
    return issues;
  }
  if (typeof parsedObj !== 'object' || parsedObj === null || Array.isArray(parsedObj)) {
    issues.push('catalog root must be a flat JSON object');
    return issues;
  }

  // Detect duplicate keys in raw JSON via TS JSON AST
  const jsonSf = ts.parseJsonText('catalog.json', rawJson);
  const rootStmt = jsonSf.statements[0];
  if (!rootStmt || !ts.isObjectLiteralExpression(rootStmt.expression)) {
    issues.push('catalog root must be a flat JSON object');
    return issues;
  }

  const seenKeys = new Set<string>();
  const orderedKeys: string[] = [];

  for (const prop of rootStmt.expression.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.name)) {
      issues.push('invalid JSON property assignment');
      continue;
    }
    const key = prop.name.text;
    if (seenKeys.has(key)) {
      issues.push(`duplicate key: "${key}"`);
    }
    seenKeys.add(key);
    orderedKeys.push(key);

    if (!ts.isStringLiteral(prop.initializer)) {
      issues.push(`non-string value at "${key}" (catalog must be flat Record<string, string>)`);
      continue;
    }
    const val = prop.initializer.text;
    if (val.trim().length === 0) {
      issues.push(`empty string value at "${key}"`);
    }
    if (!KEY_GRAMMAR.test(key)) {
      issues.push(`invalid key grammar: "${key}"`);
    } else {
      const ns = key.split('.')[0];
      if (!ALLOWED_NAMESPACES.has(ns)) {
        issues.push(`disallowed namespace "${ns}" in key "${key}"`);
      }
    }
    const parsed = parseMessage(val);
    if (!parsed.ok) {
      issues.push(`invalid ICU message at "${key}": ${parsed.error} (at ${parsed.at})`);
    }
    if (SUFFIX_AFTER_PLACEHOLDER_RE.test(val)) {
      issues.push(`forbidden Turkish case suffix after placeholder at "${key}": ${val}`);
    }
    if (key.endsWith('.overline') && val !== val.toLocaleUpperCase('tr-TR')) {
      issues.push(`overline key "${key}" must already be tr-TR uppercase (got "${val}")`);
    }
  }

  for (let i = 1; i < orderedKeys.length; i += 1) {
    if (orderedKeys[i - 1] > orderedKeys[i]) {
      issues.push(`unsorted keys: "${orderedKeys[i - 1]}" comes before "${orderedKeys[i]}"`);
    }
  }

  const byteSize = Buffer.byteLength(JSON.stringify(parsedObj), 'utf8');
  if (byteSize > CATALOG_MAX_BYTES) {
    issues.push(`catalog byte size ${byteSize} exceeds ceiling ${CATALOG_MAX_BYTES}`);
  }

  return issues;
}

export const MIGRATED_FILES: readonly string[] = [
  'lib/todayNarrative.ts',
  'components/today/TodayHero.tsx',
  'components/today/MetricGrid.tsx',
  'components/today/NextUpStrip.tsx',
  'components/today/RecoveryRailCard.tsx',
  'components/today/DayCloseTasks.tsx',
  'app/tabs/timeline.tsx',
  'components/habits/HabitMgmtCard.tsx',
  'components/HabitListView.tsx',
  'app/tabs/focus.tsx',
  'components/focus/FocusReportModal.tsx',
  'components/focus/FocusSessionCompleteModal.tsx',
  'components/focus/FocusSettingsModal.tsx',
  'app/tabs/settings.tsx',
  'components/settings/SettingRow.tsx',
  'components/settings/AccountSection.tsx',
];

/**
 * Deliberately untranslated technical identifiers (brand name, file-format
 * acronyms, and ASCII download filenames). Every entry is checked against the
 * AST so stale entries fail the guard immediately.
 */
export const ALLOWED_RAW: Readonly<Record<string, readonly string[]>> = {
  'components/focus/FocusReportModal.tsx': [
    '`odak-raporu-${todayLocal()}.${ext}`',
    'CSV',
    'Excel',
    'JSON',
  ],
  'components/focus/FocusSettingsModal.tsx': [
    '`odak-verisi-${todayLocal()}.${ext}`',
  ],
  'app/tabs/settings.tsx': [
    '`aderyth-disa-aktarim-${todayLocal()}.${EXPORT_META[format].ext}`',
    'Aderyth',
    'JSON',
    'Excel',
    'CSV',
  ],
};

function walkProductionSources(): { rel: string; text: string }[] {
  const dirs = ['app', 'components', 'lib', 'hooks', 'services', 'store', 'repositories'];
  const out: { rel: string; text: string }[] = [];
  const walk = (absDir: string, relDir: string) => {
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir)) {
      if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
      const abs = join(absDir, entry);
      const rel = `${relDir}/${entry}`;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
        out.push({ rel, text: readFileSync(abs, 'utf8') });
      }
    }
  };
  for (const d of dirs) walk(join(FRONTEND, d), d);
  return out;
}

describe('F44 — i18nCatalogComplete guard & AST scanner', () => {
  const trRaw = readFileSync(join(FRONTEND, 'locales', 'tr.json'), 'utf8');
  const trCatalog = JSON.parse(trRaw) as Record<string, string>;
  const prodSources = walkProductionSources();
  const i18nImporters = prodSources.filter((f) =>
    /from\s+['"][^'"]*lib\/i18n['"]/.test(f.text),
  );

  it('(+) locales/tr.json passes flat-object, grammar, sorted-order, ICU, overline, suffix, and byte-budget validation', () => {
    expect(validateCatalogJson(trRaw)).toEqual([]);
  });

  it('(+) every locale in SUPPORTED_LOCALES matches tr key set and placeholder sets', () => {
    for (const loc of SUPPORTED_LOCALES) {
      const locRaw = readFileSync(join(FRONTEND, 'locales', `${loc}.json`), 'utf8');
      expect(validateCatalogJson(locRaw)).toEqual([]);
      const locCat = JSON.parse(locRaw) as Record<string, string>;
      expect(Object.keys(locCat)).toEqual(Object.keys(trCatalog));
      for (const key of Object.keys(trCatalog)) {
        const trParsed = parseMessage(trCatalog[key]);
        const locParsed = parseMessage(locCat[key]);
        expect(trParsed.ok && locParsed.ok).toBe(true);
        if (trParsed.ok && locParsed.ok) {
          expect([...placeholdersOfNodes(locParsed.nodes)].sort()).toEqual(
            [...placeholdersOfNodes(trParsed.nodes)].sort(),
          );
        }
      }
    }
  });

  it('(+) every t(...) call in i18n-importing production files uses a valid literal key, exact placeholder vars, zero module-level t(), and zero dead keys', () => {
    const problems: string[] = [];
    const referencedKeys = new Set<string>();

    for (const file of prodSources) {
      for (const m of file.text.matchAll(/(['"])([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+){1,4})\1/g)) {
        if (Object.prototype.hasOwnProperty.call(trCatalog, m[2])) {
          referencedKeys.add(m[2]);
        }
      }
    }

    for (const file of i18nImporters) {
      const modLevel = findModuleLevelT(file.text, file.rel);
      for (const ln of modLevel) {
        problems.push(`${file.rel}:${ln}: forbidden module-level t() call`);
      }

      const dynCalls = findDynamicKeyTCalls(file.text, file.rel);
      for (const d of dynCalls) {
        problems.push(`${file.rel}:${d.line}: forbidden dynamic/template t() key: ${d.text}`);
      }

      for (const call of collectTCalls(file.text, file.rel)) {
        if (!Object.prototype.hasOwnProperty.call(trCatalog, call.key)) {
          problems.push(`${file.rel}:${call.line}: missing catalog key "${call.key}"`);
          continue;
        }
        const parsed = parseMessage(trCatalog[call.key]);
        if (!parsed.ok) continue;
        const expected = [...placeholdersOfNodes(parsed.nodes)].sort();
        const provided = (call.vars ?? []).slice().sort();
        if (expected.join(',') !== provided.join(',')) {
          problems.push(
            `${file.rel}:${call.line}: placeholder mismatch on "${call.key}" (expected [${expected.join(', ')}], got [${provided.join(', ')}])`,
          );
        }
      }
    }

    const deadKeys = Object.keys(trCatalog).filter((k) => !referencedKeys.has(k));
    for (const dk of deadKeys) {
      problems.push(`locales/tr.json: unused dead key "${dk}"`);
    }

    expect(problems).toEqual([]);
  });

  it('(+) MIGRATED_FILES exist, contain zero unallowed raw UI strings, and ALLOWED_RAW has zero stale entries', () => {
    const violations: string[] = [];
    for (const rel of MIGRATED_FILES) {
      const abs = join(FRONTEND, rel);
      expect(existsSync(abs)).toBe(true);
      const src = readFileSync(abs, 'utf8');
      const allowed = new Set(ALLOWED_RAW[rel] ?? []);
      const rawHits = findRawText(src, rel);
      for (const hit of rawHits) {
        if (!allowed.has(hit.text)) {
          violations.push(`${rel}:${hit.line} [${hit.kind}] ${JSON.stringify(hit.text)}`);
        }
      }
      for (const allowItem of allowed) {
        if (!rawHits.some((h) => h.text === allowItem)) {
          violations.push(`${rel}: stale ALLOWED_RAW entry ${JSON.stringify(allowItem)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('(-) AST & catalog scanner fixtures catch raw JSX/props/Alert/templates, module-level t(), dynamic t(`...`), apostrophe suffixes, duplicates, unsorted, empty, and unclosed ICU', () => {
    // 1. Catches raw JSX text, user-facing prop, Alert.alert, and lettered template literal
    const dirtyFixture = [
      "import { Alert, Text, View } from 'react-native';",
      'export function Sample({ n }: { n: number }) {',
      "  Alert.alert('Sil');",
      '  return (',
      '    <View accessibilityLabel="Kaydet">',
      '      <Text>Merhaba</Text>',
      '      <Text>{`${n} adet`}</Text>',
      '    </View>',
      '  );',
      '}',
    ].join('\n');
    const found = findRawText(dirtyFixture, 'fixture.tsx');
    expect(found.map((f) => [f.kind, f.text])).toEqual([
      ['alert', 'Sil'],
      ['prop', 'Kaydet'],
      ['jsxText', 'Merhaba'],
      ['template', '`${n} adet`'],
    ]);

    // 2. Ignores translated calls, pure symbols/punctuation, testID, and icon names
    const cleanFixture = [
      "import { Text, View } from 'react-native';",
      "import { t } from '../lib/i18n';",
      'export function Clean({ a, b }: { a: number; b: number }) {',
      '  return (',
      '    <View testID="x" accessibilityRole="button" accessibilityLabel={t(\'today.save.a11y\')}>',
      "      <Text>{t('today.save')}</Text>",
      '      <Text>•</Text>',
      '      <Text>{`${a}/${b}`}</Text>',
      '      <Icon name="moon-outline" />',
      '    </View>',
      '  );',
      '}',
    ].join('\n');
    expect(findRawText(cleanFixture, 'clean.tsx')).toEqual([]);

    // 3. Catches module-level t(...)
    const modFixture = [
      "import { t } from '../lib/i18n';",
      "const BAD = t('today.title');",
      "export function Ok() { return t('today.sub'); }",
    ].join('\n');
    expect(findModuleLevelT(modFixture, 'mod.tsx')).toEqual([2]);

    // 4. Catches dynamic template-literal key t(`a.${x}`)
    const dynFixture = "export function Bad(x: string) { return t(`today.${x}`); }";
    expect(findDynamicKeyTCalls(dynFixture, 'dyn.tsx')).toHaveLength(1);

    // 5. Catalog validator catches apostrophe suffix after placeholder, unsorted, duplicate, empty, unclosed ICU, lowercase overline
    expect(validateCatalogJson('{"today.user.label": "{name}\'in görevi"}')).toEqual(
      expect.arrayContaining([expect.stringMatching(/forbidden Turkish case suffix/)]),
    );
    expect(validateCatalogJson('{"today.z": "Z", "today.a": "A"}')).toEqual(
      expect.arrayContaining([expect.stringMatching(/unsorted keys/)]),
    );
    expect(validateCatalogJson('{"today.a": "Bir", "today.a": "İki"}')).toEqual(
      expect.arrayContaining([expect.stringMatching(/duplicate key/)]),
    );
    expect(validateCatalogJson('{"today.a": "   "}')).toEqual(
      expect.arrayContaining([expect.stringMatching(/empty string value/)]),
    );
    expect(validateCatalogJson('{"today.a": "Açık {kutu"}')).toEqual(
      expect.arrayContaining([expect.stringMatching(/invalid ICU message/)]),
    );
    expect(validateCatalogJson('{"today.head.overline": "Küçük Harf"}')).toEqual(
      expect.arrayContaining([expect.stringMatching(/overline key/)]),
    );
  });
});
