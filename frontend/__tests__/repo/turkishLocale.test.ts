/**
 * R10.05 — "Türkçe/İngilizce metin, tarih, birim, hafta başlangıcı, boş durum
 * ve erişilebilir etkileşimleri çekirdek akışta kontrol et. Mevcut dil
 * desteğini veri göçü gerektiren key değişimiyle bozma."
 *
 * The app is Turkish-only (there is no English catalogue to break, and none is
 * added here). What Turkish requires, checked across the source:
 *  - a decimal shown to the user is written with a comma ("1,5"), through the
 *    one formatter (`decimalTR`); found in this card: stats daily average,
 *    onboarding cost breakdown, focus hours, report lines and the R09.04/05
 *    numbers all printed "1.5";
 *  - every date/time formatting call names the Turkish locale; no English one;
 *  - the week starts on Monday everywhere a week is computed;
 *  - upper-casing is Turkish-aware (turkishCase.test.ts), empty and error
 *    states are covered by R06 (screenStates), accessible names by R06.03.
 */
import * as fs from 'fs';
import * as path from 'path';
import { decimalTR } from '../../lib/chartText';
import { DOW_TR, fmtHours } from '../../lib/focusReport';
import { startOfWeekLocal, weekStartYmd, ymd } from '../../lib/date';
import { periodWindow } from '../../lib/journalStats';
import { weekLightenPlan } from '../../lib/weekLighten';

const ROOT = path.join(__dirname, '../..');
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
const SRC = ['app', 'components', 'lib', 'services', 'store', 'hooks', 'repositories'].flatMap(walk);
const read = (f: string) => strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));

describe('decimals', () => {
  it('the formatter writes the Turkish comma', () => {
    expect(decimalTR(2.25)).toBe('2,3');
    expect(decimalTR(3)).toBe('3');
    expect(decimalTR(0.5, 2)).toBe('0,50');
    expect(fmtHours(5400)).toBe('1,5');
    expect(fmtHours(7200)).toBe('2');
  });

  // Each remaining `toFixed` is not UI text, or already converts.
  const ALLOWED: Record<string, string> = {
    'lib/chartText.ts': 'the formatter itself',
    'lib/moodHabitRelation.ts': 'replaces "." with "," on the same line',
    'lib/capacity.ts': 'mastery diagnostic strings (English, never rendered)',
    'lib/subscription.ts': 'USD price label of the switched-off paywall (PAID_SUBSCRIPTIONS_ENABLED=false)',
  };
  it('no other source formats a decimal with a dot', () => {
    const offenders = SRC.filter((f) => !(f in ALLOWED) && /\.toFixed\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
  it('only lib/i18n.ts constructs Intl.NumberFormat (single formatter rule)', () => {
    const offenders = SRC.filter((f) => f !== 'lib/i18n.ts' && /\bnew\s+Intl\.NumberFormat\s*\(/.test(read(f)));
    expect(offenders).toEqual([]);
    expect(read('lib/i18n.ts')).toContain("new Intl.NumberFormat('tr-TR'");
  });
  it('the allowed ones are as described', () => {
    expect(read('lib/moodHabitRelation.ts')).toMatch(/toFixed\(1\)\.replace\('\.', ','\)/);
    expect(read('lib/subscription.ts')).toMatch(/\$\$\{p\.toFixed\(2\)\}/);
    for (const f of SRC.filter((x) => x.startsWith('app/') || x.startsWith('components/'))) {
      expect([f, /\bpriceLabel\(|\bmasteryStatus\(/.test(read(f))]).toEqual([f, false]);
    }
  });
});

describe('dates', () => {
  it('every date/time formatting call names the Turkish locale; none names another', () => {
    const bad: string[] = [];
    for (const f of SRC) {
      const s = read(f);
      for (const m of s.matchAll(/toLocale(?:Date|Time)?String\(([^)]*)\)/g)) if (!/^'tr-TR'/.test(m[1].trim())) bad.push(`${f}: ${m[0]}`);
      for (const m of s.matchAll(/Intl\.(?:DateTimeFormat|NumberFormat)\(([^)]*)\)/g)) if (m[1].trim() && !/^'tr-TR'/.test(m[1].trim())) bad.push(`${f}: ${m[0]}`);
      if (/['"]en(-[A-Z]{2})?['"]/.test(s) && /toLocale|Intl\./.test(s)) bad.push(`${f}: english locale`);
    }
    expect(bad).toEqual([]);
  });
});

describe('the week starts on Monday, everywhere a week is computed', () => {
  const SUN = new Date(2026, 9, 11, 21);
  const MON = new Date(2026, 9, 5, 7);
  it('date helpers, the journal\'s week, the coach\'s week plan and the weekday names agree', () => {
    expect(ymd(startOfWeekLocal(SUN))).toBe('2026-10-05');
    expect(weekStartYmd(SUN)).toBe('2026-10-05');
    expect(weekStartYmd(MON)).toBe('2026-10-05');
    expect(periodWindow('weekly', SUN).key).toBe('2026-10-05');
    expect(weekLightenPlan([], SUN).until).toBe('2026-10-11');
    expect(DOW_TR[0]).toBe('Pzt');
    expect(DOW_TR[6]).toBe('Paz');
  });
});
