import { readFileSync } from 'fs';
import { join } from 'path';
import { decimalTR } from '../../lib/chartText';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  TR_MONTHS,
  TR_MONTHS_SHORT,
  TR_WEEKDAYS,
  TR_WEEKDAYS_SHORT,
  createTranslator,
  fmt,
  getLocale,
  hasMessage,
  parseMessage,
  pluralCategory,
  resolveLocale,
} from '../../lib/i18n';
import { rendersKey } from '../helpers/catalog';

describe('F44 — lib/i18n locale & pluralCategory', () => {
  it('(+) resolves every locale tag to tr while SUPPORTED_LOCALES is strictly ["tr"]', () => {
    expect(SUPPORTED_LOCALES).toEqual(['tr']);
    expect(DEFAULT_LOCALE).toBe('tr');
    expect(getLocale()).toBe('tr');
    expect(resolveLocale('tr')).toBe('tr');
    expect(resolveLocale('tr-TR')).toBe('tr');
    expect(resolveLocale('en-US')).toBe('tr');
    expect(resolveLocale(null)).toBe('tr');
    expect(resolveLocale(undefined)).toBe('tr');
    expect(resolveLocale('')).toBe('tr');
  });

  it('(+) matches Node Intl.PluralRules("tr-TR") across integers -3..1500 and decimals', () => {
    const intlRules = new Intl.PluralRules('tr-TR');
    for (let n = -3; n <= 1500; n += 1) {
      expect(pluralCategory('tr', n)).toBe(intlRules.select(n));
    }
    for (const d of [0.5, 1, 1.5, 2.5]) {
      expect(pluralCategory('tr', d)).toBe(intlRules.select(d));
    }
  });
});

describe('F44 — ICU message parser & createTranslator', () => {
  const sampleCatalog = {
    'greet.plain': 'Merhaba {name}!',
    'count.plain': 'Toplam {n} kayıt',
    'count.grouped': 'Sınır: {n, number} satır',
    'tasks.plural': '{n, plural, =0 {Hiç görev yok} one {# görev kaldı} other {# görev kaldı}}',
    'quote.apostrophe': "Aderyth'in {section} bölümü",
    'escaped.braces': 'Küme \\{örnek\\} ve {val}',
    'escaped.pound': '{n, plural, one {# öğe (\\#1)} other {# öğe (\\#1)}}',
    'event.date': 'Tarih: {d, date, dayMonth}',
    'broken.unclosed': 'Kapanmayan {anahtar',
  } as const;

  const tr = createTranslator(sampleCatalog, 'tr');

  it('(+) interpolates plain variables, ungrouped vs grouped numbers, plurals (=0/one/other + #), apostrophes, escapes, and dates', () => {
    expect(tr.has('greet.plain')).toBe(true);
    expect(tr.t('greet.plain', { name: 'Deniz' })).toBe('Merhaba Deniz!');

    // Plain number stays ungrouped; {n, number} groups thousands with '.'
    expect(tr.t('count.plain', { n: 1234 })).toBe('Toplam 1234 kayıt');
    expect(tr.t('count.grouped', { n: 1234 })).toBe('Sınır: 1.234 satır');

    // Exact =0 overrides category 'other'; # formats with fmt.number
    expect(tr.t('tasks.plural', { n: 0 })).toBe('Hiç görev yok');
    expect(tr.t('tasks.plural', { n: 1 })).toBe('1 görev kaldı');
    expect(tr.t('tasks.plural', { n: 1250 })).toBe('1.250 görev kaldı');

    // Turkish apostrophe is ALWAYS literal, never an ICU quote escape
    expect(tr.t('quote.apostrophe', { section: 'Odak' })).toBe("Aderyth'in Odak bölümü");

    // \{ and \} escape braces; \# escapes # inside plural
    expect(tr.t('escaped.braces', { val: 'tamam' })).toBe('Küme {örnek} ve tamam');
    expect(tr.t('escaped.pound', { n: 3 })).toBe('3 öğe (#1)');

    // {d, date, dayMonth}
    expect(tr.t('event.date', { d: new Date(2026, 9, 31, 14, 5) })).toBe('Tarih: 31 Ekim');
    expect(tr.t('event.date', { d: '2026-10-31' })).toBe('Tarih: 31 Ekim');
  });

  it('(-) handles missing keys, missing variables, malformed ICU, and variable-value injection safely without throwing', () => {
    expect(tr.has('unknown.key')).toBe(false);
    expect(tr.t('unknown.key')).toBe('unknown.key');
    expect(hasMessage('__nonexistent_key__')).toBe(false);

    // Missing variable leaves {name} visible rather than crashing
    expect(tr.t('greet.plain')).toBe('Merhaba {name}!');
    expect(tr.t('greet.plain', { name: undefined })).toBe('Merhaba {name}!');
    expect(tr.t('tasks.plural')).toBe('{n}');

    // Variable values containing {x}, ', or # are NEVER re-parsed as ICU
    expect(tr.t('greet.plain', { name: "{injected} 'tırnak' #9" })).toBe(
      "Merhaba {injected} 'tırnak' #9!",
    );

    // Malformed ICU returns { ok: false } in parseMessage and raw message in t()
    const badUnclosed = parseMessage('Açık {ad');
    expect(badUnclosed.ok).toBe(false);
    expect(tr.t('broken.unclosed', { anahtar: 'x' })).toBe('Kapanmayan {anahtar');

    expect(parseMessage('Fazla } parantez').ok).toBe(false);
    expect(parseMessage('{ad, unknownFmt}').ok).toBe(false);
    expect(parseMessage('{ad, date, nope}').ok).toBe(false);
    expect(parseMessage('{n, plural, one {bir}}').ok).toBe(false); // missing 'other'
    expect(parseMessage('{n, plural, one {a} one {b} other {c}}').ok).toBe(false); // duplicate selector
  });
});

describe('F44 — fmt (tr-TR numbers, percentages, local dates, upper/lower, Intl fallback)', () => {
  const FIXED_DATE = new Date(2026, 9, 31, 14, 5); // Saturday 31 Oct 2026, 14:05 local

  it('(+) preserves exact decimalTR parity across the numeric x digits grid and formats numbers & percentages in tr-TR', () => {
    const gridValues = [0, -0, 0.04, 0.05, 0.5, 1, 1.005, 2.25, 2.5, 10, 1234.5, -0.5, 1e6];
    for (const digits of [0, 1, 2]) {
      for (const v of gridValues) {
        expect(fmt.decimal(v, digits)).toBe(decimalTR(v, digits));
      }
    }
    expect(fmt.decimal(2.25)).toBe('2,3');
    expect(fmt.decimal(1.005, 2)).toBe('1,01');
    expect(fmt.decimal(3)).toBe('3');
    expect(fmt.decimal(0.5, 2)).toBe('0,50');
    expect(fmt.decimal(1234.5, 1)).toBe('1234,5'); // no grouping in fmt.decimal

    // Clamps digits to 0..6
    expect(fmt.decimal(0.5, 99)).toBe('0,500000');
    expect(fmt.decimal(0.6, -4)).toBe('1');

    expect(fmt.number(1234567.891)).toBe('1.234.567,891');
    expect(fmt.number(20000)).toBe('20.000');
    expect(fmt.percent(0.857, 0)).toBe('%86');
  });

  it('(+) formats Date and local Ymd presets identically in tr-TR across timezones and upper/lowercases dotted İ/ı', () => {
    expect(fmt.date(FIXED_DATE, 'weekdayShort')).toBe('Cmt');
    expect(fmt.date(FIXED_DATE, 'weekdayLong')).toBe('Cumartesi');
    expect(fmt.date(FIXED_DATE, 'monthLong')).toBe('Ekim');
    expect(fmt.date(FIXED_DATE, 'monthShort')).toBe('Eki');
    expect(fmt.date(FIXED_DATE, 'dayMonth')).toBe('31 Ekim');
    expect(fmt.date(FIXED_DATE, 'dayMonthShort')).toBe('31 Eki');
    expect(fmt.date(FIXED_DATE, 'dayMonthNumeric')).toBe('31/10');
    expect(fmt.date(FIXED_DATE, 'dayMonthYear')).toBe('31 Ekim 2026');
    expect(fmt.date(FIXED_DATE, 'fullDate')).toBe('31 Ekim 2026 Cumartesi');
    expect(fmt.date(FIXED_DATE, 'time24')).toBe('14:05');
    expect(fmt.date(FIXED_DATE, 'time12')).toMatch(/02:05/);

    // fmt.ymd parses as LOCAL midnight via parseLocalDate (never UTC midnight!)
    expect(fmt.ymd('2026-10-31', 'dayMonth')).toBe(fmt.date(new Date(2026, 9, 31), 'dayMonth'));
    expect(fmt.ymd('2026-08-04', 'weekdayLong')).toBe('Salı');

    // Static fallback tables match Intl('tr-TR') across all 12 months and 7 weekdays
    for (let m = 0; m < 12; m += 1) {
      const probe = new Date(2026, m, 15, 12, 0);
      expect(TR_MONTHS[m]).toBe(new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(probe));
      expect(TR_MONTHS_SHORT[m]).toBe(
        new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(probe),
      );
    }
    for (let dow = 0; dow < 7; dow += 1) {
      const probe = new Date(2026, 7, 2 + dow, 12, 0); // 2026-08-02 is Sunday
      expect(TR_WEEKDAYS[dow]).toBe(
        new Intl.DateTimeFormat('tr-TR', { weekday: 'long' }).format(probe),
      );
      expect(TR_WEEKDAYS_SHORT[dow]).toBe(
        new Intl.DateTimeFormat('tr-TR', { weekday: 'short' }).format(probe),
      );
    }

    expect(fmt.upper('ışık')).toBe('IŞIK');
    expect(fmt.upper('iğne')).toBe('İĞNE');
    expect(fmt.lower('IŞIK')).toBe('ışık');
    expect(fmt.lower('İĞNE')).toBe('iğne');
  });

  it('(+) falls back deterministically when globalThis.Intl is undefined', () => {
    const savedIntl = globalThis.Intl;
    Object.defineProperty(globalThis, 'Intl', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(fmt.date(FIXED_DATE, 'monthLong')).toBe('Ekim');
      expect(fmt.date(FIXED_DATE, 'weekdayShort')).toBe('Cmt');
      expect(fmt.date(FIXED_DATE, 'dayMonthYear')).toBe('31 Ekim 2026');
      expect(fmt.date(FIXED_DATE, 'time24')).toBe('14:05');
      expect(fmt.ymd('2026-10-31', 'weekdayLong')).toBe('Cumartesi');
      expect(fmt.decimal(2.25)).toBe('2,3');
      expect(fmt.decimal(1.005, 2)).toBe('1,01');
      expect(fmt.number(1234567.891)).toBe('1.234.567,891');
      expect(fmt.percent(0.857, 0)).toBe('%86');
    } finally {
      Object.defineProperty(globalThis, 'Intl', {
        value: savedIntl,
        configurable: true,
        writable: true,
      });
    }
  });

  it('(-) returns safe sentinels on NaN, Infinity, invalid Date/Ymd, and never uses toFixed in lib/i18n.ts', () => {
    expect(fmt.decimal(Number.NaN)).toBe('—');
    expect(fmt.decimal(Number.POSITIVE_INFINITY)).toBe('—');
    expect(fmt.decimal(Number.NEGATIVE_INFINITY)).toBe('—');
    expect(fmt.number(Number.NaN)).toBe('—');
    expect(fmt.number(Number.POSITIVE_INFINITY)).toBe('—');
    expect(fmt.percent(Number.NaN)).toBe('—');
    expect(fmt.date(new Date('invalid'), 'dayMonth')).toBe('');
    expect(fmt.ymd('2026-02-30', 'dayMonth')).toBe('');
    expect(fmt.ymd('not-a-date', 'dayMonth')).toBe('');

    const i18nSrc = readFileSync(join(__dirname, '..', '..', 'lib', 'i18n.ts'), 'utf8');
    expect(i18nSrc).not.toMatch(/\.toFixed\s*\(/);
  });

  it('(+/-) rendersKey helper proves BOTH t(key) call presence AND exact catalog value', () => {
    const fakeCat = { 'a.b': 'Doğru Metin' };
    expect(rendersKey("return <Text>{t('a.b')}</Text>;", 'a.b', 'Doğru Metin', fakeCat)).toBe(true);
    expect(rendersKey('return <Text>Doğru Metin</Text>;', 'a.b', 'Doğru Metin', fakeCat)).toBe(false);
    expect(rendersKey("return <Text>{t('a.b')}</Text>;", 'a.b', 'Yanlış Metin', fakeCat)).toBe(false);
  });
});
