/**
 * Locale-tolerant numeric input parser for measurable goals, logs, and durations.
 * (F14; DOM-03, DOM-11, DOM-19)
 */

/** numeric(12,2) upper bound (migration 042). */
export const NUMERIC_12_2_MAX = 9_999_999_999.99;

/** Column scale: extra fractional digits are rounded half-up rather than rejected. */
export const DEFAULT_SCALE = 2;

const MAX_INTEGER_DIGITS = 10;

export type ParseLocaleNumberOptions = {
  /** Minimum accepted value (inclusive). Defaults to 0: measurable values are non-negative. */
  min?: number;
  /** Maximum accepted value (inclusive). Defaults to NUMERIC_12_2_MAX. */
  max?: number;
  /** When true, fractional values are rejected ("2,5" -> null; "2,0" -> 2). Defaults to false. */
  integer?: boolean;
  /** Rounding scale. Defaults to DEFAULT_SCALE. At >= 3, "1.234" is read as decimal. */
  scale?: number;
};

/** Rounds half-up; Number.EPSILON absorbs binary float representation noise such as 1.005. */
export function roundToScale(value: number, scale = DEFAULT_SCALE): number {
  if (!Number.isFinite(value)) return value;
  const s = Math.max(0, Math.trunc(scale));
  const factor = 10 ** s;
  const sign = value < 0 ? -1 : 1;
  return sign * (Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor);
}

function stripGrouping(part: string, sep: ',' | '.'): string | null {
  const groups = part.split(sep);
  if (groups.length < 2) return part;
  if (!/^[1-9]\d{0,2}$/.test(groups[0])) return null;
  for (let i = 1; i < groups.length; i += 1) {
    if (!/^\d{3}$/.test(groups[i])) return null;
  }
  return groups.join('');
}

function splitParts(
  cleaned: string,
  scale: number,
): { intDigits: string; fracDigits: string } | null {
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    // When both separators appear, the LAST one is the decimal separator and the other is thousands.
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    const decSep: ',' | '.' = lastComma > lastDot ? ',' : '.';
    const thouSep: ',' | '.' = decSep === ',' ? '.' : ',';
    const decParts = cleaned.split(decSep);
    if (decParts.length !== 2) return null;
    if (decParts[1].includes(thouSep)) return null;
    const ungrouped = decParts[0].includes(thouSep)
      ? stripGrouping(decParts[0], thouSep)
      : decParts[0];
    if (ungrouped === null) return null;
    return { intDigits: ungrouped || '0', fracDigits: decParts[1] };
  }

  if (hasComma || hasDot) {
    const sep: ',' | '.' = hasComma ? ',' : '.';
    const pieces = cleaned.split(sep);
    if (pieces.length > 2) {
      const ungrouped = stripGrouping(cleaned, sep);
      if (ungrouped === null) return null;
      return { intDigits: ungrouped, fracDigits: '' };
    }
    // Exactly one separator
    if (sep === '.' && scale < 3 && /^[1-9]\d{0,2}\.\d{3}$/.test(cleaned)) {
      return { intDigits: pieces[0] + pieces[1], fracDigits: '' };
    }
    return { intDigits: pieces[0] || '0', fracDigits: pieces[1] };
  }

  return { intDigits: cleaned, fracDigits: '' };
}

/** Returns null on invalid, empty, or out-of-range input. Mid-typing "2," returns 2. */
export function parseLocaleNumber(
  raw: string | null | undefined,
  options?: ParseLocaleNumberOptions,
): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/[\s\u00A0\u202F]+/g, '');
  if (!cleaned) return null;
  if (!/^[0-9.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;

  const scale = options?.scale ?? DEFAULT_SCALE;
  const parts = splitParts(cleaned, scale);
  if (!parts) return null;

  const sigInt = parts.intDigits.replace(/^0+/, '') || '0';
  if (sigInt.length > MAX_INTEGER_DIGITS) return null;

  if (options?.integer && /[1-9]/.test(parts.fracDigits)) {
    return null;
  }

  const numeric = Number(`${sigInt}.${parts.fracDigits || '0'}`);
  if (!Number.isFinite(numeric)) return null;

  const result = options?.integer ? Math.trunc(numeric) : roundToScale(numeric, scale);
  const min = options?.min ?? 0;
  const max = options?.max ?? NUMERIC_12_2_MAX;
  if (result < min || result > max) return null;

  return Object.is(result, -0) ? 0 : result;
}

/** Same rules as parseLocaleNumber; returns NaN on invalid input (for legacy !isNaN callers). */
export function parseLocaleNumberOrNaN(
  raw: string | null | undefined,
  options?: ParseLocaleNumberOptions,
): number {
  const parsed = parseLocaleNumber(raw, options);
  return parsed === null ? Number.NaN : parsed;
}

/** 2.5 -> "2,5"; null, undefined, and non-finite -> "". For controlled input display. */
export function formatNumberInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}

/** True for "" or valid mid-typing trailing separator ("2,", "2."): UI suppresses error hints. */
export function isNumberInputPending(raw: string): boolean {
  const cleaned = raw.trim().replace(/[\s\u00A0\u202F]+/g, '');
  if (!cleaned) return true;
  if ((cleaned.endsWith(',') || cleaned.endsWith('.')) && parseLocaleNumber(cleaned) !== null) {
    return true;
  }
  return false;
}
