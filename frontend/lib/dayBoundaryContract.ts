/**
 * E04 — Gün anahtarı, UTC olay anı, IANA saat dilimi, `04:00` Gün Kapanışı etkin günü
 * ve Pazartesi başlangıçlı XP haftası için tek saf (pure) sözleşme modülü.
 *
 * Saf modül: I/O, Supabase, Zustand veya AsyncStorage içermez; zaman ve saat dilimi
 * parametreyle verilir, geçersiz IANA adında veya bozuk `Date` girdisinde asla throw etmez.
 */
import {
  addDaysLocal,
  deviceTimeZone,
  isValidTimeZone,
  parseLocalDate,
  startOfWeekLocal,
  ymd,
  type Ymd,
} from './date';

/** `lib/dayClose.ts` (`DAY_ROLLOVER_HOUR = 4`) ile birebir aynı Gün Kapanışı devir saati. */
export const DAY_CLOSE_ROLLOVER_HOUR = 4;

export type ZoneResolutionSource = 'explicit' | 'device_fallback' | 'utc_fallback';

export type DayBoundarySnapshot = {
  /** Çözümlenen saat dilimindeki yerel takvim günü (`YYYY-MM-DD`). */
  readonly localDayKey: Ymd;
  /** Olay anının kanonik UTC ISO gösterimi (`YYYY-MM-DDTHH:mm:ss.sssZ`). */
  readonly utcInstantIso: string;
  /** Kullanılan geçerli IANA saat dilimi; çalışma zamanı dilim bildiremiyorsa `null` (UTC kuralı). */
  readonly ianaZone: string | null;
  /** `04:00` Gün Kapanışı etkin günü (`00:00..03:59` arası önceki takvim gününü kapatır). */
  readonly closingDayKey: Ymd;
  /** `043_profile_time_zone.sql` (`week_start_in_zone`) ile uyumlu Pazartesi başlangıçlı XP haftası. */
  readonly xpWeekMondayKey: Ymd;
  /** Çözümlenen saat dilimindeki yerel saat (`0..23`). */
  readonly localHour: number;
  /** Çözümlenen saat dilimindeki yerel dakika (`0..59`). */
  readonly localMinute: number;
  /** Çözümlenen saat dilimindeki `HH:MM` etiketi. */
  readonly localTimeHm: string;
  /** `localHour < 4` ise `true` (`closingDayKey` bir önceki gündür). */
  readonly isBeforeDayCloseRollover: boolean;
  /** Saat diliminin nasıl çözümlendiği (`explicit`, `device_fallback` veya `utc_fallback`). */
  readonly zoneResolution: ZoneResolutionSource;
  /** Girdi `Date` nesnesi geçerli bir zaman damgası taşıyor muydu? */
  readonly validInstant: boolean;
};

export type DayBoundaryDeps = {
  /** Testlerde cihaz saat dilimini deterministik enjekte etmek için isteğe bağlı okuyucu. */
  readonly deviceZone?: () => string | null;
};

type ZonedWallClock = {
  readonly dayKey: Ymd;
  readonly hour: number;
  readonly minute: number;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function utcWallClock(instant: Date): ZonedWallClock {
  const year = instant.getUTCFullYear();
  const month = pad2(instant.getUTCMonth() + 1);
  const day = pad2(instant.getUTCDate());
  return {
    dayKey: `${year}-${month}-${day}`,
    hour: instant.getUTCHours(),
    minute: instant.getUTCMinutes(),
  };
}

function formatWallClockInZone(instant: Date, zone: string): ZonedWallClock | null {
  try {
    const parts = new Intl.DateTimeFormat('tr-TR', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant);

    let year = '';
    let month = '';
    let day = '';
    let hourRaw = '';
    let minuteRaw = '';

    for (const part of parts) {
      if (part.type === 'year') year = part.value;
      else if (part.type === 'month') month = part.value.padStart(2, '0');
      else if (part.type === 'day') day = part.value.padStart(2, '0');
      else if (part.type === 'hour') hourRaw = part.value;
      else if (part.type === 'minute') minuteRaw = part.value;
    }

    const dayKey = `${year}-${month}-${day}`;
    if (parseLocalDate(dayKey) === null) return null;

    const parsedHour = Number(hourRaw);
    const parsedMinute = Number(minuteRaw);
    if (!Number.isInteger(parsedHour) || !Number.isInteger(parsedMinute)) return null;

    const hour = parsedHour === 24 ? 0 : parsedHour;
    if (hour < 0 || hour > 23 || parsedMinute < 0 || parsedMinute > 59) return null;

    return { dayKey, hour, minute: parsedMinute };
  } catch {
    return null;
  }
}

function safeResolveDeviceZone(reader: () => string | null): string | null {
  try {
    const candidate = reader();
    return isValidTimeZone(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Verilen olay anı ve isteğe bağlı IANA saat diliminden yerel gün anahtarını,
 * UTC anını, `04:00` Gün Kapanışı gününü ve Pazartesi XP haftasını tek yapıda üretir.
 *
 * Geçersiz IANA adında önce cihazın geçerli IANA dilimine, o da yoksa UTC kuralına
 * (`043_profile_time_zone.sql` ile aynı) güvenli biçimde düşer; asla throw etmez.
 */
export function buildDayBoundarySnapshot(
  instant: Date,
  ianaZone?: string | null,
  deps?: DayBoundaryDeps,
): DayBoundarySnapshot {
  const validInstant = instant instanceof Date && !Number.isNaN(instant.getTime());
  const safeInstant = validInstant ? instant : new Date(0);
  const utcInstantIso = safeInstant.toISOString();

  let resolvedZone: string | null = null;
  let zoneResolution: ZoneResolutionSource = 'utc_fallback';
  let wallClock: ZonedWallClock | null = null;

  if (isValidTimeZone(ianaZone)) {
    wallClock = formatWallClockInZone(safeInstant, ianaZone);
    if (wallClock !== null) {
      resolvedZone = ianaZone;
      zoneResolution = 'explicit';
    }
  }

  if (wallClock === null) {
    const devZone = safeResolveDeviceZone(deps?.deviceZone ?? deviceTimeZone);
    if (devZone !== null) {
      wallClock = formatWallClockInZone(safeInstant, devZone);
      if (wallClock !== null) {
        resolvedZone = devZone;
        zoneResolution = 'device_fallback';
      }
    }
  }

  if (wallClock === null) {
    wallClock = utcWallClock(safeInstant);
    resolvedZone = null;
    zoneResolution = 'utc_fallback';
  }

  const localDayKey = wallClock.dayKey;
  const parsedDay = parseLocalDate(localDayKey) ?? new Date(1970, 0, 1);
  const isBeforeDayCloseRollover = wallClock.hour < DAY_CLOSE_ROLLOVER_HOUR;
  const closingDayKey = isBeforeDayCloseRollover
    ? ymd(addDaysLocal(parsedDay, -1))
    : localDayKey;
  const xpWeekMondayKey = ymd(startOfWeekLocal(parsedDay));

  return {
    localDayKey,
    utcInstantIso,
    ianaZone: resolvedZone,
    closingDayKey,
    xpWeekMondayKey,
    localHour: wallClock.hour,
    localMinute: wallClock.minute,
    localTimeHm: `${pad2(wallClock.hour)}:${pad2(wallClock.minute)}`,
    isBeforeDayCloseRollover,
    zoneResolution,
    validInstant,
  };
}

/**
 * E04 / R01.06 — Geçmişte kaydedilmiş bir alışkanlık kaydının (`completed_at: 'YYYY-MM-DD'`)
 * kullanıcı başka bir saat dilimine seyahat ettiğinde veya çevrimdışı kuyruk sonradan
 * eşitlendiğinde ASLA başka bir güne kaymamasını garanti eder.
 *
 * `habit_logs.completed_at` zaten kayıt anındaki yerel takvim günüdür (`038` / `043`
 * `habit_log_key_immutable`); `currentZone` üzerinden yeniden yorumlanmaz.
 */
export function preserveHistoricalLogDay(
  log: { readonly completed_at: string; readonly tz?: string | null },
  currentZone: string,
): Ymd {
  void currentZone;
  if (typeof log.completed_at !== 'string') return '';
  const trimmed = log.completed_at.trim();
  if (trimmed.length < 10) return '';
  const candidate = trimmed.slice(0, 10);
  return parseLocalDate(candidate) !== null ? candidate : '';
}

export type HistoricalLogAnchor = {
  readonly dayKey: Ymd;
  readonly recordedZone: string | null;
  readonly viewingZone: string | null;
  readonly zoneChangedSinceLog: boolean;
};

/**
 * Kaydın yazıldığı IANA bölgesi (`log.tz`) ile şu anki bölgeyi karşılaştırırken
 * `dayKey` değerini sabit tutar.
 */
export function inspectHistoricalLogAnchor(
  log: { readonly completed_at: string; readonly tz?: string | null },
  currentZone: string,
): HistoricalLogAnchor {
  const dayKey = preserveHistoricalLogDay(log, currentZone);
  const recordedZone = isValidTimeZone(log.tz) ? log.tz : null;
  const viewingZone = isValidTimeZone(currentZone) ? currentZone : null;
  const zoneChangedSinceLog =
    recordedZone !== null && viewingZone !== null && recordedZone !== viewingZone;

  return {
    dayKey,
    recordedZone,
    viewingZone,
    zoneChangedSinceLog,
  };
}
