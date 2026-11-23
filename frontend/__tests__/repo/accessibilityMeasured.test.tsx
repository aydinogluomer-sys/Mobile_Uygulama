/**
 * R06.04 — "Büyük yazı, semantik roller, anlamlı etiketler, odak sırası,
 * kontrast ve azaltılmış hareketi destekle. Dokunma alanları platforma uygun
 * olsun; yalnız accessibilityLabel sayarak tamamlandı deme."
 *
 * Measured, not counted: WCAG contrast of the real token values, the real
 * touch size of the kit's pressables, font scaling left on, and every
 * animation site gated on the system "reduce motion" setting.
 * docs/implementation-v3/R06_ACCESSIBILITY.md
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';

jest.setTimeout(30_000);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import Button, { MIN_TOUCH } from '../../components/ui/Button';
import Chip from '../../components/ui/Chip';
import { ACCENTS, colors, contrastRatio, onColor } from '../../lib/tokens';
import { blankNonCode, scanTouchableSource, scanTouchables } from '../helpers/a11yScan';
import { renderWithProviders } from '../helpers/renderWithProviders';

const BGS = {
  bg: colors.bg,
  surface: colors.surface,
  surfaceAlt: colors.surfaceAlt,
  surfaceHover: colors.surfaceHover,
};

describe('contrast (WCAG 2.1)', () => {
  it('body and secondary text reach AA 4.5:1 on every background', () => {
    for (const fg of ['text', 'textDim', 'textFaint'] as const) {
      for (const [name, bg] of Object.entries(BGS)) {
        expect([fg, name, contrastRatio(colors[fg], bg) >= 4.5]).toEqual([fg, name, true]);
      }
    }
  });
  it('status and accent colours reach 4.5:1 on the page and 3:1 (icons, large text) on cards', () => {
    for (const c of ['accent', 'success', 'warning', 'error', 'info'] as const) {
      expect([c, contrastRatio(colors[c], colors.bg) >= 4.5]).toEqual([c, true]);
      for (const bg of Object.values(BGS)) expect(contrastRatio(colors[c], bg)).toBeGreaterThanOrEqual(3);
    }
  });
  it('a filled button picks a readable label for every accent theme and for danger', () => {
    const fills = [...Object.values(ACCENTS).map((t) => t.primary), colors.error];
    for (const f of fills) expect([f, contrastRatio(onColor(f), f) >= 4.5]).toEqual([f, true]);
    expect(onColor(colors.accent)).toBe('#15140F'); // white on clay is 3.1:1 -- dark ink instead
  });
  it('the ghost grey is never used for text a user must read (placeholders)', () => {
    const offenders = files().filter((f) => /placeholderTextColor=\{colors\.textGhost\}/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('touch targets', () => {
  it('every Button size is at least 44pt to touch; it grows with large text instead of clipping', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const r = renderWithProviders(<Button label="x" size={size} onPress={() => {}} />);
      const t = r.getByRole('button', { name: 'x' });
      const style = Object.assign({}, ...[t.props.style].flat(3).filter(Boolean));
      expect(style.height).toBeUndefined();
      const slop = t.props.hitSlop ?? { top: 0, bottom: 0 };
      expect(style.minHeight + slop.top + slop.bottom).toBeGreaterThanOrEqual(MIN_TOUCH);
      r.unmount();
    }
  });
  it('a pressable Chip extends its touch area', () => {
    const r = renderWithProviders(<Chip label="x" onPress={() => {}} />);
    const t = r.getByRole('button', { name: 'x' });
    expect(t.props.hitSlop.top + t.props.hitSlop.bottom).toBeGreaterThanOrEqual(20);
    r.unmount();
  });
});

const ROOT = path.join(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
function files(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.tsx')) out.push(rel);
    }
  };
  walk('app');
  walk('components');
  return out;
}

describe('large text', () => {
  it('font scaling is never switched off', () => {
    const offenders = files().filter((f) =>
      /allowFontScaling=\{false\}|maxFontSizeMultiplier=\{1(\.0)?\}/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('reduced motion', () => {
  it('every file that animates also honours the system setting', () => {
    const ANIMATES =
      /Animated\.(timing|spring|loop|decay)\(|LayoutAnimation\.configureNext|<Animatable\.\w+[^>]*animation=/;
    const animating = files().filter((f) => ANIMATES.test(read(f)));
    expect(animating.length).toBeGreaterThanOrEqual(8); // scanner sanity
    const ungated = animating.filter((f) => !/useReducedMotion\(\)|reduceMotion: boolean/.test(read(f)));
    expect(ungated).toEqual([]);
  });
});

const FIRST_WAVE_A11Y = [
  'components/focus/FocusSettingsModal.tsx',
  'app/(auth)/reset-password.tsx',
  'app/tabs/focus.tsx',
  'app/tabs/timeline.tsx',
] as const;

export const TOUCHABLE_CEILINGS = {
  noRole: 93,
  noLabel: 113,
  iconOnlyNoLabel: 22,
} as const;

describe('touchable roles and labels ratchet (F26 / DSA-02)', () => {
  const scan = scanTouchables(['app', 'components']);

  it('(+) scanner is live (> 500 touchables across app/ and components/)', () => {
    expect(scan.total).toBeGreaterThan(500);
  });

  it('(+) all four first-wave F26 files have zero missing accessibilityRole and accessibilityLabel', () => {
    for (const rel of FIRST_WAVE_A11Y) {
      const fileScan = scanTouchableSource(rel, read(rel));
      expect({
        rel,
        noRole: fileScan.noRole,
        noLabel: fileScan.noLabel,
        offenders: fileScan.offenders[rel] ?? [],
      }).toEqual({
        rel,
        noRole: 0,
        noLabel: 0,
        offenders: [],
      });
    }
  });

  it('(+) repo-wide missing role, missing label, and icon-only unlabeled counts stay within monotonic ceilings and are not stale (> 5 slack)', () => {
    expect(scan.noRole).toBeLessThanOrEqual(TOUCHABLE_CEILINGS.noRole);
    expect(scan.noLabel).toBeLessThanOrEqual(TOUCHABLE_CEILINGS.noLabel);
    expect(scan.iconOnlyNoLabel).toBeLessThanOrEqual(TOUCHABLE_CEILINGS.iconOnlyNoLabel);

    expect(TOUCHABLE_CEILINGS.noRole - scan.noRole).toBeLessThanOrEqual(5);
    expect(TOUCHABLE_CEILINGS.noLabel - scan.noLabel).toBeLessThanOrEqual(5);
    expect(TOUCHABLE_CEILINGS.iconOnlyNoLabel - scan.iconOnlyNoLabel).toBeLessThanOrEqual(5);
  });

  it('(+) FocusSettingsModal carries semantic tab, switch, checked, and selected accessibility contracts', () => {
    const modalCode = blankNonCode(read('components/focus/FocusSettingsModal.tsx')).blanked;
    const modalRaw = read('components/focus/FocusSettingsModal.tsx');
    expect(modalRaw).toContain('accessibilityRole="tab"');
    expect(modalRaw).toContain('accessibilityRole="switch"');
    expect(modalCode).toMatch(/accessibilityState=\{\{\s*checked:/);
    expect(modalCode).toMatch(/accessibilityState=\{\{\s*selected:/);
  });

  it('(-) synthetic unlabelled / roleless touchables are caught while comments, strings, and accessible={false} are ignored', () => {
    const bad = scanTouchableSource(
      'synthetic.tsx',
      [
        '// accessibilityRole="button" accessibilityLabel="Sahte"',
        '<TouchableOpacity title="accessibilityRole accessibilityLabel" onPress={fn}>',
        '  <Ionicons name="close" size={18} />',
        '</TouchableOpacity>',
        '<TouchableOpacity accessibilityRole="button" accessibilityLabel="" onPress={fn}>',
        '  <Text>Boş</Text>',
        '</TouchableOpacity>',
        '<Pressable accessible={false} onPress={fn} />',
      ].join('\n'),
    );
    expect(bad.total).toBe(2);
    expect(bad.noRole).toBe(1);
    expect(bad.noLabel).toBe(2);
    expect(bad.iconOnlyNoLabel).toBe(1);
  });
});
