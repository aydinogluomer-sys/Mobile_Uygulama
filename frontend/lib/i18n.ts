import tr from '../locales/tr.json';
import { parseLocalDate, type Ymd } from './date';

export type Locale = 'tr';
export const SUPPORTED_LOCALES: readonly Locale[] = ['tr'];
export const DEFAULT_LOCALE: Locale = 'tr';

export type Catalog = Readonly<Record<string, string>>;
export type StringKey = keyof typeof tr extends never ? string : keyof typeof tr & string;
export type MessageValue = string | number | Date | null | undefined;
export type MessageVars = Readonly<Record<string, MessageValue>>;
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export type DatePreset =
  | 'weekdayShort'
  | 'weekdayLong'
  | 'monthLong'
  | 'monthShort'
  | 'dayMonth'
  | 'dayMonthShort'
  | 'dayMonthNumeric'
  | 'dayMonthYear'
  | 'fullDate'
  | 'time24'
  | 'time12';

export type MessageNode =
  | { kind: 'text'; value: string }
  | { kind: 'arg'; name: string; format: 'plain' | 'number' | { date: DatePreset } }
  | {
      kind: 'plural';
      name: string;
      exact: Readonly<Record<number, MessageNode[]>>;
      cases: Partial<Record<PluralCategory, MessageNode[]>>;
      other: MessageNode[];
    };

export type ParseResult =
  | { ok: true; nodes: MessageNode[] }
  | { ok: false; error: string; at: number };

export const TR_MONTHS: readonly string[] = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

export const TR_MONTHS_SHORT: readonly string[] = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

export const TR_WEEKDAYS: readonly string[] = [
  'Pazar',
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
];

export const TR_WEEKDAYS_SHORT: readonly string[] = [
  'Paz',
  'Pzt',
  'Sal',
  'Çar',
  'Per',
  'Cum',
  'Cmt',
];

const DATE_PRESETS: ReadonlySet<string> = new Set<DatePreset>([
  'weekdayShort',
  'weekdayLong',
  'monthLong',
  'monthShort',
  'dayMonth',
  'dayMonthShort',
  'dayMonthNumeric',
  'dayMonthYear',
  'fullDate',
  'time24',
  'time12',
]);

const PLURAL_CATEGORIES: ReadonlySet<string> = new Set<PluralCategory>([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]);

function isDatePreset(value: string): value is DatePreset {
  return DATE_PRESETS.has(value);
}

function isPluralCategory(value: string): value is PluralCategory {
  return PLURAL_CATEGORIES.has(value);
}

export function resolveLocale(tag: string | null | undefined): Locale {
  void tag;
  return DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return DEFAULT_LOCALE;
}

export function pluralCategory(locale: Locale, n: number): PluralCategory {
  void locale;
  return Number.isFinite(n) && Math.abs(n) === 1 ? 'one' : 'other';
}

const ESCAPED_POUND_SENTINEL = '\uE000';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clampDigits(digits: number | undefined, fallback: number): number {
  if (digits === undefined || !Number.isFinite(digits)) return fallback;
  return Math.min(6, Math.max(0, Math.trunc(digits)));
}

function groupThousandsTR(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatDecimalFallback(n: number, digits: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) {
    return n === 0 ? '0' : String(n);
  }
  const d = clampDigits(digits, 1);
  if (d === 0) {
    const rounded = Math.round(Math.abs(n) + Number.EPSILON);
    if (rounded === 0) return '0';
    return `${n < 0 ? '-' : ''}${rounded}`;
  }
  const scaled = Math.round(Number(`${Math.abs(n)}e${d}`));
  if (scaled === 0) {
    return `0,${'0'.repeat(d)}`;
  }
  const factor = 10 ** d;
  const intPart = Math.trunc(scaled / factor);
  const fracPart = String(scaled % factor).padStart(d, '0');
  return `${n < 0 ? '-' : ''}${intPart},${fracPart}`;
}

function formatNumberFallback(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const scaled = Math.round(Number(`${Math.abs(n)}e3`));
  if (scaled === 0) return '0';
  const intPart = Math.trunc(scaled / 1000);
  const rem = scaled % 1000;
  const grouped = groupThousandsTR(String(intPart));
  if (rem === 0) return `${sign}${grouped}`;
  const frac = String(rem).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${grouped},${frac}`;
}

function formatDateFallback(d: Date, preset: DatePreset): string {
  const day = d.getDate();
  const monthIdx = d.getMonth();
  const year = d.getFullYear();
  const dow = d.getDay();
  switch (preset) {
    case 'weekdayShort':
      return TR_WEEKDAYS_SHORT[dow];
    case 'weekdayLong':
      return TR_WEEKDAYS[dow];
    case 'monthLong':
      return TR_MONTHS[monthIdx];
    case 'monthShort':
      return TR_MONTHS_SHORT[monthIdx];
    case 'dayMonth':
      return `${day} ${TR_MONTHS[monthIdx]}`;
    case 'dayMonthShort':
      return `${day} ${TR_MONTHS_SHORT[monthIdx]}`;
    case 'dayMonthNumeric':
      return `${pad2(day)}/${pad2(monthIdx + 1)}`;
    case 'dayMonthYear':
      return `${day} ${TR_MONTHS[monthIdx]} ${year}`;
    case 'fullDate':
      return `${day} ${TR_MONTHS[monthIdx]} ${year} ${TR_WEEKDAYS[dow]}`;
    case 'time24':
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    case 'time12': {
      const h = d.getHours();
      const period = h >= 12 ? 'ÖS' : 'ÖÖ';
      const h12 = h % 12 || 12;
      return `${period} ${pad2(h12)}:${pad2(d.getMinutes())}`;
    }
  }
}

const PRESET_OPTIONS: Readonly<Record<DatePreset, Intl.DateTimeFormatOptions>> = {
  weekdayShort: { weekday: 'short' },
  weekdayLong: { weekday: 'long' },
  monthLong: { month: 'long' },
  monthShort: { month: 'short' },
  dayMonth: { day: 'numeric', month: 'long' },
  dayMonthShort: { day: 'numeric', month: 'short' },
  dayMonthNumeric: { day: '2-digit', month: '2-digit' },
  dayMonthYear: { day: 'numeric', month: 'long', year: 'numeric' },
  fullDate: { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' },
  time24: { hour: '2-digit', minute: '2-digit', hour12: false },
  time12: { hour: '2-digit', minute: '2-digit', hour12: true },
};

const dtfCache = new Map<DatePreset, Intl.DateTimeFormat>();
const decimalNfCache = new Map<string, Intl.NumberFormat>();
const percentNfCache = new Map<number, Intl.NumberFormat>();
let groupedNumberNf: Intl.NumberFormat | null = null;

function getDateFormatter(preset: DatePreset): Intl.DateTimeFormat | null {
  if (typeof globalThis.Intl === 'undefined' || typeof globalThis.Intl.DateTimeFormat !== 'function') {
    return null;
  }
  const cached = dtfCache.get(preset);
  if (cached) return cached;
  try {
    const created = new Intl.DateTimeFormat('tr-TR', PRESET_OPTIONS[preset]);
    dtfCache.set(preset, created);
    return created;
  } catch {
    return null;
  }
}

function getDecimalFormatter(minFrac: number, maxFrac: number): Intl.NumberFormat | null {
  if (typeof globalThis.Intl === 'undefined' || typeof globalThis.Intl.NumberFormat !== 'function') {
    return null;
  }
  const key = `${minFrac}:${maxFrac}`;
  const cached = decimalNfCache.get(key);
  if (cached) return cached;
  try {
    const created = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
      useGrouping: false,
    });
    decimalNfCache.set(key, created);
    return created;
  } catch {
    return null;
  }
}

function getGroupedFormatter(): Intl.NumberFormat | null {
  if (typeof globalThis.Intl === 'undefined' || typeof globalThis.Intl.NumberFormat !== 'function') {
    return null;
  }
  if (groupedNumberNf) return groupedNumberNf;
  try {
    groupedNumberNf = new Intl.NumberFormat('tr-TR');
    return groupedNumberNf;
  } catch {
    return null;
  }
}

function getPercentFormatter(digits: number): Intl.NumberFormat | null {
  if (typeof globalThis.Intl === 'undefined' || typeof globalThis.Intl.NumberFormat !== 'function') {
    return null;
  }
  const cached = percentNfCache.get(digits);
  if (cached) return cached;
  try {
    const created = new Intl.NumberFormat('tr-TR', {
      style: 'percent',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    percentNfCache.set(digits, created);
    return created;
  } catch {
    return null;
  }
}

export const fmt = {
  decimal(n: number, digits = 1): string {
    if (!Number.isFinite(n)) return '—';
    const d = clampDigits(digits, 1);
    const normalized = n === 0 ? 0 : n;
    const minFrac = Number.isInteger(normalized) ? 0 : d;
    const nf = getDecimalFormatter(minFrac, d);
    if (nf) {
      try {
        const out = nf.format(normalized);
        return out === '-0' || out === `-0,${'0'.repeat(d)}` ? out.slice(1) : out;
      } catch {
        return formatDecimalFallback(normalized, d);
      }
    }
    return formatDecimalFallback(normalized, d);
  },

  number(n: number): string {
    if (!Number.isFinite(n)) return '—';
    const normalized = n === 0 ? 0 : n;
    const nf = getGroupedFormatter();
    if (nf) {
      try {
        const out = nf.format(normalized);
        return out === '-0' ? '0' : out;
      } catch {
        return formatNumberFallback(normalized);
      }
    }
    return formatNumberFallback(normalized);
  },

  percent(ratio: number, digits = 0): string {
    if (!Number.isFinite(ratio)) return '—';
    const d = clampDigits(digits, 0);
    const normalized = ratio === 0 ? 0 : ratio;
    const nf = getPercentFormatter(d);
    if (nf) {
      try {
        return nf.format(normalized);
      } catch {
        return `%${formatDecimalFallback(normalized * 100, d)}`;
      }
    }
    if (d === 0) {
      const pct = Math.round(normalized * 100);
      return pct < 0 ? `-%${Math.abs(pct)}` : `%${pct}`;
    }
    const absText = formatDecimalFallback(Math.abs(normalized) * 100, d);
    return normalized < 0 ? `-%${absText}` : `%${absText}`;
  },

  date(d: Date, preset: DatePreset): string {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    const dtf = getDateFormatter(preset);
    if (dtf) {
      try {
        return dtf.format(d);
      } catch {
        return formatDateFallback(d, preset);
      }
    }
    return formatDateFallback(d, preset);
  },

  ymd(s: Ymd, preset: DatePreset): string {
    const parsed = parseLocalDate(s);
    if (!parsed) return '';
    return fmt.date(parsed, preset);
  },

  upper(text: string): string {
    try {
      return text.toLocaleUpperCase('tr-TR');
    } catch {
      return text.replace(/i/g, 'İ').replace(/ı/g, 'I').toLocaleUpperCase('tr-TR');
    }
  },

  lower(text: string): string {
    try {
      return text.toLocaleLowerCase('tr-TR');
    } catch {
      return text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr-TR');
    }
  },
};

function skipWs(s: string, pos: number): number {
  let i = pos;
  while (i < s.length && /\s/.test(s[i])) i += 1;
  return i;
}

function readIdent(s: string, pos: number): { ident: string; next: number } | null {
  const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s.slice(pos));
  if (!m) return null;
  return { ident: m[0], next: pos + m[0].length };
}

type InternalParseResult =
  | { ok: true; nodes: MessageNode[]; next: number }
  | { ok: false; error: string; at: number };

function parseSequence(
  message: string,
  start: number,
  stopOnCloseBrace: boolean,
  insidePlural: boolean,
): InternalParseResult {
  const nodes: MessageNode[] = [];
  let textBuf = '';
  let i = start;

  const flushText = () => {
    if (textBuf.length > 0) {
      nodes.push({ kind: 'text', value: textBuf });
      textBuf = '';
    }
  };

  while (i < message.length) {
    const ch = message[i];

    if (ch === '\\') {
      if (i + 1 >= message.length) {
        return { ok: false, error: 'trailing backslash escape', at: i };
      }
      const nextCh = message[i + 1];
      if (nextCh === '{' || nextCh === '}' || nextCh === '\\') {
        textBuf += nextCh;
        i += 2;
        continue;
      }
      if (nextCh === '#' && insidePlural) {
        textBuf += ESCAPED_POUND_SENTINEL;
        i += 2;
        continue;
      }
      textBuf += nextCh;
      i += 2;
      continue;
    }

    if (ch === '}') {
      if (stopOnCloseBrace) {
        flushText();
        return { ok: true, nodes, next: i + 1 };
      }
      return { ok: false, error: 'unexpected closing brace', at: i };
    }

    if (ch === '{') {
      flushText();
      const exprRes = parseExpression(message, i);
      if (!exprRes.ok) return exprRes;
      nodes.push(exprRes.node);
      i = exprRes.next;
      continue;
    }

    textBuf += ch;
    i += 1;
  }

  if (stopOnCloseBrace) {
    return { ok: false, error: 'unclosed brace block', at: start - 1 };
  }

  flushText();
  return { ok: true, nodes, next: i };
}

function parseExpression(
  message: string,
  openBraceAt: number,
): { ok: true; node: MessageNode; next: number } | { ok: false; error: string; at: number } {
  let i = skipWs(message, openBraceAt + 1);
  if (i >= message.length) {
    return { ok: false, error: 'unclosed placeholder', at: openBraceAt };
  }

  const nameTok = readIdent(message, i);
  if (!nameTok) {
    return { ok: false, error: 'expected placeholder identifier', at: i };
  }
  const name = nameTok.ident;
  i = skipWs(message, nameTok.next);

  if (i >= message.length) {
    return { ok: false, error: 'unclosed placeholder', at: openBraceAt };
  }

  if (message[i] === '}') {
    return {
      ok: true,
      node: { kind: 'arg', name, format: 'plain' },
      next: i + 1,
    };
  }

  if (message[i] !== ',') {
    return { ok: false, error: 'expected "," or "}" after placeholder name', at: i };
  }

  i = skipWs(message, i + 1);
  const kindTok = readIdent(message, i);
  if (!kindTok) {
    return { ok: false, error: 'expected format type after ","', at: i };
  }
  const fmtType = kindTok.ident;
  i = skipWs(message, kindTok.next);

  if (fmtType === 'number') {
    if (i >= message.length) {
      return { ok: false, error: 'unclosed number placeholder', at: openBraceAt };
    }
    if (message[i] !== '}') {
      return { ok: false, error: 'unexpected token in number placeholder', at: i };
    }
    return {
      ok: true,
      node: { kind: 'arg', name, format: 'number' },
      next: i + 1,
    };
  }

  if (fmtType === 'date') {
    if (i >= message.length || message[i] !== ',') {
      return { ok: false, error: 'date placeholder requires a preset', at: i };
    }
    i = skipWs(message, i + 1);
    const presetTok = readIdent(message, i);
    if (!presetTok || !isDatePreset(presetTok.ident)) {
      return { ok: false, error: 'unknown date preset', at: i };
    }
    const preset = presetTok.ident;
    i = skipWs(message, presetTok.next);
    if (i >= message.length || message[i] !== '}') {
      return { ok: false, error: 'unclosed date placeholder', at: openBraceAt };
    }
    return {
      ok: true,
      node: { kind: 'arg', name, format: { date: preset } },
      next: i + 1,
    };
  }

  if (fmtType === 'plural') {
    if (i >= message.length || message[i] !== ',') {
      return { ok: false, error: 'plural placeholder requires clauses after ","', at: i };
    }
    i = skipWs(message, i + 1);

    const exact: Record<number, MessageNode[]> = {};
    const cases: Partial<Record<PluralCategory, MessageNode[]>> = {};
    let otherNodes: MessageNode[] | null = null;

    while (i < message.length && message[i] !== '}') {
      const clauseAt = i;
      if (message[i] === '=') {
        const exactMatch = /^=(-?\d+)/.exec(message.slice(i));
        if (!exactMatch) {
          return { ok: false, error: 'invalid exact plural selector', at: i };
        }
        const exactNum = Number(exactMatch[1]);
        if (Object.prototype.hasOwnProperty.call(exact, exactNum)) {
          return { ok: false, error: `duplicate plural selector =${exactNum}`, at: clauseAt };
        }
        i = skipWs(message, i + exactMatch[0].length);
        if (i >= message.length || message[i] !== '{') {
          return { ok: false, error: 'expected "{" after plural selector', at: i };
        }
        const sub = parseSequence(message, i + 1, true, true);
        if (!sub.ok) return sub;
        exact[exactNum] = sub.nodes;
        i = skipWs(message, sub.next);
      } else {
        const catTok = readIdent(message, i);
        if (!catTok || !isPluralCategory(catTok.ident)) {
          return { ok: false, error: 'invalid plural category selector', at: i };
        }
        const cat = catTok.ident;
        if (cat === 'other' ? otherNodes !== null : cases[cat] !== undefined) {
          return { ok: false, error: `duplicate plural category "${cat}"`, at: clauseAt };
        }
        i = skipWs(message, catTok.next);
        if (i >= message.length || message[i] !== '{') {
          return { ok: false, error: 'expected "{" after plural category', at: i };
        }
        const sub = parseSequence(message, i + 1, true, true);
        if (!sub.ok) return sub;
        if (cat === 'other') {
          otherNodes = sub.nodes;
        } else {
          cases[cat] = sub.nodes;
        }
        i = skipWs(message, sub.next);
      }
    }

    if (i >= message.length || message[i] !== '}') {
      return { ok: false, error: 'unclosed plural placeholder', at: openBraceAt };
    }
    if (otherNodes === null) {
      return { ok: false, error: 'plural placeholder missing required "other" clause', at: openBraceAt };
    }

    return {
      ok: true,
      node: {
        kind: 'plural',
        name,
        exact,
        cases,
        other: otherNodes,
      },
      next: i + 1,
    };
  }

  return { ok: false, error: `unsupported placeholder format "${fmtType}"`, at: kindTok.next - fmtType.length };
}

export function parseMessage(message: string): ParseResult {
  const res = parseSequence(message, 0, false, false);
  if (!res.ok) return res;
  return { ok: true, nodes: res.nodes };
}

function renderNodes(
  nodes: readonly MessageNode[],
  locale: Locale,
  vars: MessageVars | undefined,
  pluralNum: number | undefined,
): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      if (pluralNum !== undefined) {
        const formattedPound = fmt.number(pluralNum);
        out += node.value
          .split('#')
          .join(formattedPound)
          .split(ESCAPED_POUND_SENTINEL)
          .join('#');
      } else {
        out += node.value;
      }
      continue;
    }

    if (node.kind === 'arg') {
      const hasVar = vars !== undefined && Object.prototype.hasOwnProperty.call(vars, node.name);
      const val = hasVar ? vars[node.name] : undefined;
      if (val === undefined || val === null) {
        out += `{${node.name}}`;
        continue;
      }
      if (node.format === 'plain') {
        if (typeof val === 'number') {
          out += Number.isFinite(val) ? String(val) : '—';
        } else if (val instanceof Date) {
          out += fmt.date(val, 'dayMonthYear');
        } else {
          out += String(val);
        }
      } else if (node.format === 'number') {
        out += typeof val === 'number' ? fmt.number(val) : fmt.number(Number(val));
      } else {
        const preset = node.format.date;
        if (val instanceof Date) {
          out += fmt.date(val, preset);
        } else if (typeof val === 'string') {
          const local = parseLocalDate(val);
          out += local ? fmt.date(local, preset) : fmt.date(new Date(val), preset);
        } else {
          out += fmt.date(new Date(val), preset);
        }
      }
      continue;
    }

    // plural
    const hasVar = vars !== undefined && Object.prototype.hasOwnProperty.call(vars, node.name);
    const val = hasVar ? vars[node.name] : undefined;
    if (val === undefined || val === null || typeof val !== 'number') {
      out += `{${node.name}}`;
      continue;
    }
    if (!Number.isFinite(val)) {
      out += renderNodes(node.other, locale, vars, val);
      continue;
    }
    let branch: readonly MessageNode[];
    if (Object.prototype.hasOwnProperty.call(node.exact, val)) {
      branch = node.exact[val];
    } else {
      const cat = pluralCategory(locale, val);
      branch = node.cases[cat] ?? node.other;
    }
    out += renderNodes(branch, locale, vars, val);
  }
  return out;
}

export function createTranslator(
  catalog: Catalog,
  locale: Locale,
): {
  t(key: string, vars?: MessageVars): string;
  has(key: string): boolean;
} {
  const cache = new Map<string, ParseResult>();

  function has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(catalog, key);
  }

  function translate(key: string, vars?: MessageVars): string {
    if (!has(key)) {
      return key;
    }
    const raw = catalog[key];
    let parsed = cache.get(key);
    if (!parsed) {
      parsed = parseMessage(raw);
      cache.set(key, parsed);
    }
    if (!parsed.ok) {
      return raw;
    }
    return renderNodes(parsed.nodes, locale, vars, undefined);
  }

  return { t: translate, has };
}

const defaultCatalog: Catalog = tr;
const prodTranslator = createTranslator(defaultCatalog, DEFAULT_LOCALE);

export function t(key: StringKey, vars?: MessageVars): string {
  return prodTranslator.t(key, vars);
}

export function hasMessage(key: string): key is StringKey {
  return prodTranslator.has(key);
}
