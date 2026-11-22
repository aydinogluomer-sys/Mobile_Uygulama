import { addDaysLocal, parseLocalDate, startOfWeekLocal, ymd, type Ymd } from './date';

export type QuickPriority = 'high' | 'medium' | 'low';
export type QuickAddProject = { id: string; name: string };
export type QuickAddContext = { now: Date; projects: readonly QuickAddProject[] };

export type QuickAddTokenKind = 'date' | 'time' | 'duration' | 'priority' | 'project';
export type QuickAddToken = {
  kind: QuickAddTokenKind;
  /** İptal anahtarı: `${kind}:${foldTr(source)}`. Çip dokunuşuyla `dismissed` kümesine girer. */
  key: string;
  /** Metindeki ham parça, ör. "haftaya salı", "15:00", "!yüksek", "#sağlık". */
  source: string;
  /** Çipte gösterilen kısa Türkçe etiket, ör. "Yarın", "Cum 6 Kas", "15:00", "Yüksek", "Sağlık". */
  label: string;
  /** [start, end) girdi dizgesindeki UTF-16 dizinleri. */
  start: number;
  end: number;
};

export type QuickAddFields = {
  dueDate?: Ymd;
  /** "HH:mm". */
  time?: string;
  /** "HH:mm" (zaman aralığı verildiyse bitiş saati). */
  timeEnd?: string;
  /** Dakika cinsinden süre ("25dk", "1 saat"). */
  durationMinutes?: number;
  priority?: QuickPriority;
  projectId?: string;
};

export type QuickAddResult = { title: string; fields: QuickAddFields; tokens: QuickAddToken[] };

const TR_CHAR_MAP: Readonly<Record<string, string>> = {
  İ: 'i',
  I: 'i',
  ı: 'i',
  Ç: 'c',
  ç: 'c',
  Ğ: 'g',
  ğ: 'g',
  Ö: 'o',
  ö: 'o',
  Ş: 's',
  ş: 's',
  Ü: 'u',
  ü: 'u',
};

/** Türkçe katlama: İ I ı -> i, ç ğ ö ş ü -> c g o s u, küçük harf. ICU'ya bağlı değildir (Hermes). */
export function foldTr(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    out += TR_CHAR_MAP[ch] ?? ch;
  }
  return out.toLowerCase();
}

const DOW_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'] as const;
const MONTH_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'] as const;

/** Çip tarih etiketi: bugün -> "Bugün", yarın -> "Yarın", diğer -> "Çar 4 Kas" (Intl'siz sabit diziler). */
export function formatChipDate(day: Ymd, today: Ymd): string {
  if (day === today) return 'Bugün';
  const todayDate = parseLocalDate(today);
  if (todayDate && ymd(addDaysLocal(todayDate, 1)) === day) return 'Yarın';
  const parsed = parseLocalDate(day);
  if (!parsed) return day;
  return `${DOW_SHORT[parsed.getDay()]} ${parsed.getDate()} ${MONTH_SHORT[parsed.getMonth()]}`;
}

/** OD-22: "HH:mm", sıfır dolgulu; geçersiz saat null. */
export function formatTimeBlock(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || minute < 0) return null;
  const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(formatted) ? formatted : null;
}

const WEEKDAY_STEMS: readonly { stem: string; dow: number; allowBare: boolean }[] = [
  { stem: 'pazartesi', dow: 1, allowBare: true },
  { stem: 'sali', dow: 2, allowBare: true },
  { stem: 'carsamba', dow: 3, allowBare: true },
  { stem: 'persembe', dow: 4, allowBare: true },
  { stem: 'cuma', dow: 5, allowBare: true },
  { stem: 'cumartesi', dow: 6, allowBare: true },
  { stem: 'pazar', dow: 0, allowBare: false },
];

const DATIVE_SUFFIXES = new Set(['', 'a', 'e', 'ya', 'ye']);

const MONTH_STEMS: Readonly<Record<string, number>> = {
  ocak: 1,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  eylul: 9,
  ekim: 10,
  kasim: 11,
  aralik: 12,
};

type WordSpan = {
  raw: string;
  core: string;
  folded: string;
  start: number;
  coreEnd: number;
};

function tokenizeWords(input: string): WordSpan[] {
  const out: WordSpan[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const raw = m[0];
    const start = m.index;
    const core = raw.replace(/[,;]+$/, '');
    const used = core.length > 0 ? core : raw;
    out.push({
      raw,
      core: used,
      folded: foldTr(used),
      start,
      coreEnd: start + used.length,
    });
  }
  return out;
}

function matchWeekday(foldedWord: string, allowSunday: boolean): number | null {
  for (const w of WEEKDAY_STEMS) {
    if (!allowSunday && !w.allowBare) continue;
    if (!foldedWord.startsWith(w.stem)) continue;
    const suffix = foldedWord.slice(w.stem.length);
    if (DATIVE_SUFFIXES.has(suffix)) return w.dow;
  }
  return null;
}

function nextOccurrenceYmd(now: Date, targetDow: number): Ymd {
  const diff = (targetDow - now.getDay() + 7) % 7;
  const k = diff === 0 ? 7 : diff;
  return ymd(addDaysLocal(now, k));
}

function nextCalendarWeekYmd(now: Date, targetDow: number): Ymd {
  const nextMonday = addDaysLocal(startOfWeekLocal(now), 7);
  const offset = (targetDow + 6) % 7;
  return ymd(addDaysLocal(nextMonday, offset));
}

function matchMonthNumber(foldedWord: string): number | null {
  const stripped = foldedWord.replace(/'?(?:da|de|ta|te|a|e|ya|ye)$/, '');
  for (const cand of [foldedWord, stripped]) {
    const m = MONTH_STEMS[cand];
    if (m !== undefined) return m;
  }
  return null;
}

function resolveDayMonth(now: Date, dayNum: number, monthNum: number): Ymd | null {
  if (dayNum < 1 || dayNum > 31) return null;
  const today = ymd(now);
  const mm = String(monthNum).padStart(2, '0');
  const dd = String(dayNum).padStart(2, '0');
  const thisYear = `${now.getFullYear()}-${mm}-${dd}`;
  if (parseLocalDate(thisYear) && thisYear >= today) return thisYear;
  const nextYear = `${now.getFullYear() + 1}-${mm}-${dd}`;
  if (parseLocalDate(nextYear)) return nextYear;
  return null;
}

function matchDateAt(words: readonly WordSpan[], i: number, now: Date): { count: number; dueDate: Ymd } | null {
  const w0 = words[i];
  const w1 = words[i + 1];
  const w2 = words[i + 2];

  // 3-word patterns
  if (w1 && w2) {
    if (/^\d{1,3}$/.test(w0.folded) && w1.folded === 'gun' && w2.folded === 'sonra') {
      const n = Number(w0.folded);
      if (n >= 1 && n <= 365) {
        return { count: 3, dueDate: ymd(addDaysLocal(now, n)) };
      }
    }
    if (w0.folded === 'haftaya' && (w2.folded === 'gunu' || w2.folded === 'gunune')) {
      const dow = matchWeekday(w1.folded, true);
      if (dow !== null) return { count: 3, dueDate: nextCalendarWeekYmd(now, dow) };
    }
  }

  // 2-word patterns
  if (w1) {
    if (w0.folded === 'obur' && (w1.folded === 'gun' || w1.folded === 'gune')) {
      return { count: 2, dueDate: ymd(addDaysLocal(now, 2)) };
    }
    if (w0.folded === 'haftaya') {
      const dow = matchWeekday(w1.folded, true);
      if (dow !== null) return { count: 2, dueDate: nextCalendarWeekYmd(now, dow) };
    }
    if (w1.folded === 'gunu' || w1.folded === 'gunune') {
      const dow = matchWeekday(w0.folded, true);
      if (dow !== null) return { count: 2, dueDate: nextOccurrenceYmd(now, dow) };
    }
    if (/^\d{1,2}$/.test(w0.folded)) {
      const monthNum = matchMonthNumber(w1.folded);
      if (monthNum !== null) {
        const resolved = resolveDayMonth(now, Number(w0.folded), monthNum);
        if (resolved) return { count: 2, dueDate: resolved };
      }
    }
  }

  // 1-word patterns
  if (w0.folded === 'bugun') return { count: 1, dueDate: ymd(now) };
  if (w0.folded === 'yarin' || w0.folded === 'yarina') return { count: 1, dueDate: ymd(addDaysLocal(now, 1)) };
  if (w0.folded === 'haftaya') return { count: 1, dueDate: ymd(addDaysLocal(now, 7)) };

  const bareDow = matchWeekday(w0.folded, false);
  if (bareDow !== null) {
    return { count: 1, dueDate: nextOccurrenceYmd(now, bareDow) };
  }

  return null;
}

function matchTimeAt(
  words: readonly WordSpan[],
  i: number,
): { count: number; time: string; timeEnd?: string; label: string } | null {
  const w0 = words[i];
  const w1 = words[i + 1];

  // "saat 15", "saat 9.30", "saat 14:00-15:00"
  if (w0.folded === 'saat' && w1) {
    const rangeM = /^(\d{1,2})(?:[:.](\d{2}))?[-–](\d{1,2})(?:[:.](\d{2}))?(?:'?(?:te|ta|de|da))?$/.exec(w1.folded);
    if (rangeM) {
      const start = formatTimeBlock(Number(rangeM[1]), rangeM[2] ? Number(rangeM[2]) : 0);
      const end = formatTimeBlock(Number(rangeM[3]), rangeM[4] ? Number(rangeM[4]) : 0);
      if (start && end && end > start) {
        return { count: 2, time: start, timeEnd: end, label: `${start}–${end}` };
      }
      return null;
    }
    const singleM = /^(\d{1,2})(?:[:.](\d{2}))?(?:'?(?:te|ta|de|da))?$/.exec(w1.folded);
    if (singleM) {
      const formatted = formatTimeBlock(Number(singleM[1]), singleM[2] ? Number(singleM[2]) : 0);
      if (formatted) return { count: 2, time: formatted, label: formatted };
    }
  }

  // "14:00-15:00"
  const colonRange = /^(\d{1,2}):(\d{2})[-–](\d{1,2}):(\d{2})(?:'?(?:te|ta|de|da))?$/.exec(w0.folded);
  if (colonRange) {
    const start = formatTimeBlock(Number(colonRange[1]), Number(colonRange[2]));
    const end = formatTimeBlock(Number(colonRange[3]), Number(colonRange[4]));
    if (start && end && end > start) {
      return { count: 1, time: start, timeEnd: end, label: `${start}–${end}` };
    }
    return null;
  }

  // "15:00", "9:05", "15:00'te" (must have ':' so decimals like 3.50 are never treated as time)
  const colonSingle = /^(\d{1,2}):(\d{2})(?:'?(?:te|ta|de|da))?$/.exec(w0.folded);
  if (colonSingle) {
    const formatted = formatTimeBlock(Number(colonSingle[1]), Number(colonSingle[2]));
    if (formatted) return { count: 1, time: formatted, label: formatted };
  }

  return null;
}

const MINUTE_UNITS = new Set(['dk', 'dak', 'dakika', 'dakikalik']);
const HOUR_UNITS = new Set(['saat', 'sa', 'saatlik']);

function matchDurationAt(
  words: readonly WordSpan[],
  i: number,
): { count: number; durationMinutes: number; label: string } | null {
  const w0 = words[i];
  const w1 = words[i + 1];

  if (w1 && /^[1-9]\d{0,2}$/.test(w0.folded)) {
    const n = Number(w0.folded);
    if (MINUTE_UNITS.has(w1.folded) && n <= 480) {
      return { count: 2, durationMinutes: n, label: `${n} dk` };
    }
    if (HOUR_UNITS.has(w1.folded) && n <= 12) {
      return { count: 2, durationMinutes: n * 60, label: `${n} saat` };
    }
  }

  const minCompact = /^([1-9]\d{0,2})(dk|dak|dakika|dakikalik)$/.exec(w0.folded);
  if (minCompact) {
    const n = Number(minCompact[1]);
    if (n <= 480) return { count: 1, durationMinutes: n, label: `${n} dk` };
  }

  const hourCompact = /^([1-9]|1[0-2])(saat|sa|saatlik)$/.exec(w0.folded);
  if (hourCompact) {
    const n = Number(hourCompact[1]);
    return { count: 1, durationMinutes: n * 60, label: `${n} saat` };
  }

  return null;
}

function matchPriorityWord(folded: string): { priority: QuickPriority; label: string } | null {
  if (folded === '!yuksek' || folded === '!acil' || folded === '!1') {
    return { priority: 'high', label: 'Yüksek' };
  }
  if (folded === '!orta' || folded === '!2') {
    return { priority: 'medium', label: 'Orta' };
  }
  if (folded === '!dusuk' || folded === '!3') {
    return { priority: 'low', label: 'Düşük' };
  }
  return null;
}

function matchProjectWord(
  coreWord: string,
  projects: readonly QuickAddProject[],
): QuickAddProject | null {
  if (!coreWord.startsWith('#')) return null;
  const query = foldTr(coreWord.slice(1)).replace(/\s+/g, '');
  if (!query) return null;

  const candidates = projects
    .map((project) => ({ project, slug: foldTr(project.name).replace(/\s+/g, '') }))
    .filter((entry) => entry.slug.length > 0);

  const exact = candidates.filter((entry) => entry.slug === query);
  if (exact.length === 1) return exact[0].project;
  if (exact.length > 1) return null;

  if (query.length >= 2) {
    const pref = candidates.filter((entry) => entry.slug.startsWith(query));
    if (pref.length === 1) return pref[0].project;
  }

  return null;
}

export function parseQuickAdd(
  input: string,
  ctx: QuickAddContext,
  dismissed?: ReadonlySet<string>,
): QuickAddResult {
  const trimmedInput = input.trim();
  if (!trimmedInput) return { title: '', fields: {}, tokens: [] };

  const today = ymd(ctx.now);
  const words = tokenizeWords(input);
  const consumed = new Array<boolean>(words.length).fill(false);
  const seenKinds = new Set<QuickAddTokenKind>();
  const fields: QuickAddFields = {};
  const tokens: QuickAddToken[] = [];

  const tryAccept = (
    kind: QuickAddTokenKind,
    startIdx: number,
    count: number,
    label: string,
    applyField: () => void,
  ): boolean => {
    seenKinds.add(kind);
    const start = words[startIdx].start;
    const end = words[startIdx + count - 1].coreEnd;
    const source = input.slice(start, end);
    const key = `${kind}:${foldTr(source)}`;
    if (dismissed?.has(key)) {
      return false;
    }
    for (let k = startIdx; k < startIdx + count; k += 1) {
      consumed[k] = true;
    }
    applyField();
    tokens.push({ kind, key, source, label, start, end });
    return true;
  };

  let i = 0;
  while (i < words.length) {
    if (!seenKinds.has('date')) {
      const dm = matchDateAt(words, i, ctx.now);
      if (dm) {
        const accepted = tryAccept('date', i, dm.count, formatChipDate(dm.dueDate, today), () => {
          fields.dueDate = dm.dueDate;
        });
        if (accepted) {
          i += dm.count;
          continue;
        }
      }
    }

    if (!seenKinds.has('time')) {
      const tm = matchTimeAt(words, i);
      if (tm) {
        const accepted = tryAccept('time', i, tm.count, tm.label, () => {
          fields.time = tm.time;
          if (tm.timeEnd) fields.timeEnd = tm.timeEnd;
        });
        if (accepted) {
          i += tm.count;
          continue;
        }
      }
    }

    if (!seenKinds.has('duration')) {
      const dur = matchDurationAt(words, i);
      if (dur) {
        const accepted = tryAccept('duration', i, dur.count, dur.label, () => {
          fields.durationMinutes = dur.durationMinutes;
        });
        if (accepted) {
          i += dur.count;
          continue;
        }
      }
    }

    if (!seenKinds.has('priority')) {
      const pm = matchPriorityWord(words[i].folded);
      if (pm) {
        const accepted = tryAccept('priority', i, 1, pm.label, () => {
          fields.priority = pm.priority;
        });
        if (accepted) {
          i += 1;
          continue;
        }
      }
    }

    if (!seenKinds.has('project')) {
      const proj = matchProjectWord(words[i].core, ctx.projects);
      if (proj) {
        const accepted = tryAccept('project', i, 1, proj.name, () => {
          fields.projectId = proj.id;
        });
        if (accepted) {
          i += 1;
          continue;
        }
      }
    }

    i += 1;
  }

  if (tokens.length === 0) {
    return { title: trimmedInput, fields: {}, tokens: [] };
  }

  const remainingWords = words.filter((_, idx) => !consumed[idx]).map((w) => w.raw);
  const cleanTitle = remainingWords.join(' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim();

  if (cleanTitle.length === 0) {
    return { title: trimmedInput, fields: {}, tokens: [] };
  }

  return { title: cleanTitle, fields, tokens };
}

export type QuickAddDefaults = {
  priority: 'high' | 'medium' | 'low' | 'none';
  list_type: 'inbox' | 'this_week' | 'someday';
  due_date: Ymd | null;
  project_id: string | null;
};

export type QuickAddTaskInput = {
  title: string;
  priority: 'high' | 'medium' | 'low' | 'none';
  list_type: 'inbox' | 'this_week' | 'someday';
  due_date: Ymd | null;
  project_id: string | null;
  time_block_start: string | null;
  time_block_end?: string | null;
  estimated_minutes?: number | null;
};

/** Alan önceliği: çip > çağıranın varsayılanı. Saat var, tarih yoksa due_date = today. */
export function quickAddToTaskInput(
  title: string,
  fields: QuickAddFields | undefined,
  defaults: QuickAddDefaults,
  today: Ymd,
): QuickAddTaskInput {
  return {
    title,
    priority: fields?.priority ?? defaults.priority,
    list_type: defaults.list_type,
    due_date: fields?.dueDate ?? (fields?.time ? today : defaults.due_date),
    project_id: fields?.projectId ?? defaults.project_id,
    time_block_start: fields?.time ?? null,
    ...(fields?.timeEnd ? { time_block_end: fields.timeEnd } : {}),
    ...(fields?.durationMinutes !== undefined ? { estimated_minutes: fields.durationMinutes } : {}),
  };
}
