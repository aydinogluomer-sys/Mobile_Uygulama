import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const code = (rel: string) => stripComments(readFileSync(join(FRONTEND, rel), 'utf8'));

/**
 * Extracts every `<FloatingLabelInput ... />` JSX element from source code,
 * respecting nested `{...}` / `(...)` expressions such as `rightElement={(<PasswordToggle ... />)}`.
 */
export function extractFloatingLabelInputs(src: string): string[] {
  const tags: string[] = [];
  const needle = '<FloatingLabelInput';
  let idx = src.indexOf(needle);
  while (idx !== -1) {
    let i = idx + needle.length;
    let braceDepth = 0;
    let parenDepth = 0;
    let quote: string | null = null;
    while (i < src.length) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') {
        braceDepth += 1;
      } else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (ch === '(') {
        parenDepth += 1;
      } else if (ch === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (braceDepth === 0 && parenDepth === 0 && ch === '/' && src[i + 1] === '>') {
        tags.push(src.slice(idx, i + 2));
        i += 2;
        break;
      }
      i += 1;
    }
    idx = src.indexOf(needle, i);
  }
  return tags;
}

/** Returns secure FloatingLabelInput tags that lack either `autoComplete=` or `textContentType=`. */
export function findSecureInputsMissingHints(src: string): string[] {
  return extractFloatingLabelInputs(src)
    .filter((tag) => /\bsecureTextEntry\b/.test(tag))
    .filter((tag) => !/\bautoComplete=/.test(tag) || !/\btextContentType=/.test(tag));
}

const AUTH_FORMS = [
  'app/(auth)/login.tsx',
  'app/(auth)/register.tsx',
  'app/(auth)/reset-password.tsx',
] as const;

describe('DSA-03 — parola alanları otomatik doldurma ipuçları ve 44x44 PasswordToggle', () => {
  it.each(AUTH_FORMS)('(+) %s içindeki her secureTextEntry alanı autoComplete ve textContentType taşır', (rel) => {
    const src = code(rel);
    const secureTags = extractFloatingLabelInputs(src).filter((t) => /\bsecureTextEntry\b/.test(t));
    expect(secureTags.length).toBeGreaterThanOrEqual(1);
    expect(findSecureInputsMissingHints(src)).toEqual([]);
  });

  it('(+) reset-password.tsx tam iki new-password / newPassword alanı içerir', () => {
    const reset = code('app/(auth)/reset-password.tsx');
    expect(reset.match(/autoComplete="new-password"/g) ?? []).toHaveLength(2);
    expect(reset.match(/textContentType="newPassword"/g) ?? []).toHaveLength(2);
  });

  it('(+) her üç auth formu da PasswordToggle kullanır ve bileşen 44x44 pt, rollü ve etiketlidir', () => {
    for (const rel of AUTH_FORMS) {
      expect(code(rel)).toContain('<PasswordToggle');
    }
    expect(existsSync(join(FRONTEND, 'components/auth/PasswordToggle.tsx'))).toBe(true);
    const toggle = code('components/auth/PasswordToggle.tsx');
    expect(toggle).toContain('minWidth: 44');
    expect(toggle).toContain('minHeight: 44');
    expect(toggle).toContain('accessibilityRole="button"');
    expect(toggle).toContain('accessibilityLabel=');
  });

  it('(-) tarayıcı doğrulaması: textContentType veya autoComplete eksik sentetik secureTextEntry yakalanır', () => {
    const missingContentType = `
      <FloatingLabelInput
        label="Yeni şifre"
        secureTextEntry={!show}
        autoComplete="new-password"
        rightElement={(<PasswordToggle visible={show} onToggle={toggle} />)}
      />
    `;
    const missingAutoComplete = `
      <FloatingLabelInput
        label="Yeni şifre"
        secureTextEntry={!show}
        textContentType="newPassword"
      />
    `;
    const complete = `
      <FloatingLabelInput
        label="Yeni şifre"
        secureTextEntry={!show}
        autoComplete="new-password"
        textContentType="newPassword"
        rightElement={(<PasswordToggle visible={show} onToggle={toggle} />)}
      />
    `;
    expect(findSecureInputsMissingHints(missingContentType)).toHaveLength(1);
    expect(findSecureInputsMissingHints(missingAutoComplete)).toHaveLength(1);
    expect(findSecureInputsMissingHints(complete)).toEqual([]);
  });

  it('(-) üç auth formunda eski size={18} satır içi göster/gizle düğmesi kalmamıştır', () => {
    for (const rel of AUTH_FORMS) {
      const src = code(rel);
      expect(src).not.toMatch(/eye(?:-off)?-outline['"]?\s*\}\s*size=\{18\}/);
      expect(src).not.toContain('eye-off-outline');
    }
  });
});
