import {
  DEFAULT_SCALE,
  NUMERIC_12_2_MAX,
  formatNumberInput,
  isNumberInputPending,
  parseLocaleNumber,
  parseLocaleNumberOrNaN,
  roundToScale,
} from '../../lib/localeNumber';

describe('localeNumber — TR/EN decimal & grouping parser (DOM-03, DOM-11, DOM-19)', () => {
  it('exposes the migration 042 numeric(12,2) constants', () => {
    expect(NUMERIC_12_2_MAX).toBe(9_999_999_999.99);
    expect(DEFAULT_SCALE).toBe(2);
  });

  it('parses comma and dot decimals, thousands separators, zero, leading and trailing separators', () => {
    expect(parseLocaleNumber('2,5')).toBe(2.5);
    expect(parseLocaleNumber('2.5')).toBe(2.5);
    expect(parseLocaleNumber('1.234,5')).toBe(1234.5);
    expect(parseLocaleNumber('1,234.5')).toBe(1234.5);
    expect(parseLocaleNumber('0')).toBe(0);
    expect(parseLocaleNumber(',5')).toBe(0.5);
    expect(parseLocaleNumber('.5')).toBe(0.5);
    expect(parseLocaleNumber('2,')).toBe(2);
    expect(parseLocaleNumber('2.')).toBe(2);
    expect(parseLocaleNumber('1.234')).toBe(1234);
    expect(parseLocaleNumber('1.234', { scale: 3 })).toBe(1.234);
    expect(parseLocaleNumber('0.125')).toBe(0.13);
    expect(parseLocaleNumber('1.234.567')).toBe(1234567);
    expect(parseLocaleNumber('1,234,567')).toBe(1234567);
    expect(parseLocaleNumber('0,005')).toBe(0.01);
    expect(parseLocaleNumber('1\u00A0234')).toBe(1234);
    expect(parseLocaleNumber('1\u202F234,5')).toBe(1234.5);
    expect(parseLocaleNumber('9999999999,99')).toBe(NUMERIC_12_2_MAX);
  });

  it('rounds half up without binary float drift and formats echoed input with comma', () => {
    expect(roundToScale(1.005)).toBe(1.01);
    expect(roundToScale(0.005, 2)).toBe(0.01);
    expect(formatNumberInput(2.5)).toBe('2,5');
    expect(formatNumberInput(0)).toBe('0');
    expect(formatNumberInput(null)).toBe('');
    expect(formatNumberInput(undefined)).toBe('');
    expect(formatNumberInput(Number.NaN)).toBe('');
    expect(formatNumberInput(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('detects mid-typing pending inputs so UI suppresses premature warnings', () => {
    expect(isNumberInputPending('')).toBe(true);
    expect(isNumberInputPending('   ')).toBe(true);
    expect(isNumberInputPending('2,')).toBe(true);
    expect(isNumberInputPending('2.')).toBe(true);
    expect(isNumberInputPending('1.234,')).toBe(true);
    expect(isNumberInputPending('2,5')).toBe(false);
    expect(isNumberInputPending(',')).toBe(false);
    expect(isNumberInputPending('abc')).toBe(false);
  });

  it('rejects empty, non-numeric, negative, scientific, malformed grouping, overflow, and option violations', () => {
    expect(parseLocaleNumber('')).toBeNull();
    expect(parseLocaleNumber('   ')).toBeNull();
    expect(parseLocaleNumber(null)).toBeNull();
    expect(parseLocaleNumber(undefined)).toBeNull();
    expect(parseLocaleNumber('abc')).toBeNull();
    expect(parseLocaleNumber('12abc')).toBeNull();
    expect(parseLocaleNumber('-3')).toBeNull();
    expect(parseLocaleNumber('+3')).toBeNull();
    expect(parseLocaleNumber('1e3')).toBeNull();
    expect(parseLocaleNumber('1,2,3')).toBeNull();
    expect(parseLocaleNumber('1.2.3')).toBeNull();
    expect(parseLocaleNumber(',')).toBeNull();
    expect(parseLocaleNumber('.')).toBeNull();
    expect(parseLocaleNumber('99999999999')).toBeNull();
    expect(parseLocaleNumber('2,5', { integer: true })).toBeNull();
    expect(parseLocaleNumber('2,0', { integer: true })).toBe(2);
    expect(parseLocaleNumber('0', { min: 1 })).toBeNull();
    expect(parseLocaleNumber('100,01', { max: 100 })).toBeNull();
    expect(Number.isNaN(parseLocaleNumberOrNaN('x'))).toBe(true);
    expect(parseLocaleNumberOrNaN('2,5')).toBe(2.5);
  });
});
