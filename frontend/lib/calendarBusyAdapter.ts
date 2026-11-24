/**
 * Faz F7 — E16 (`DEC-OD11`, `I1`, `I3`):
 * `GOOGLE_CALENDAR_INTEGRATION_ENABLED` kapısı arkasında çalışan saf (pure),
 * dar kapsamlı ve salt okunur dış takvim meşguliyet (`busy slot`) bağdaştırıcısı.
 *
 * Sınır kuralları:
 * - Sıfır dış yazma yüzeyi (`canWriteExternalCalendar: false`); dış takvimde
 *   etkinlik oluşturmaz, düzenlemez veya silmez.
 * - OAuth erişim/yenileme belirteçlerini okumaz ve yedek dosyasına sokmaz.
 * - Kapı kapalıyken (`GOOGLE_CALENDAR_INTEGRATION_ENABLED === false`) derhal
 *   `mode: 'internal_only'` döner; uygulama yalnız iç sabit bloklarla çalışır.
 * - Özel başlıkları varsayılan olarak `'Dış takvim meşgul'` etiketiyle maskeler.
 */

import { canonical, checksum } from './backupFormat';
import { isValidTimeZone, parseLocalDate, type Ymd } from './date';
import { formatMinutesToHm, type FixedPlanBlock } from './dayPlanPreview';
import { GOOGLE_CALENDAR_INTEGRATION_ENABLED } from './featureGates';

export const DEFAULT_BUSY_TTL_MINUTES = 30;
export const MASKED_EXTERNAL_BUSY_TITLE = 'Dış takvim meşgul';

export const EXTERNAL_CALENDAR_CAPABILITIES = {
  canReadBusySlots: true,
  canWriteExternalCalendar: false,
  persistsOAuthSecretsInBackup: false,
} as const;

export type ExternalEventStatus = 'confirmed' | 'tentative' | 'cancelled';

export type RawExternalBusyEvent = {
  readonly externalEventId: string;
  readonly accountId: string;
  readonly calendarId: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly status?: ExternalEventStatus;
  readonly recurringMasterId?: string | null;
  readonly title?: string | null;
};

export type BusyCacheSnapshot = {
  readonly userId: string;
  readonly accountId: string;
  readonly syncedAtIso: string;
  readonly ttlMinutes: number;
  readonly blocks: readonly FixedPlanBlock[];
};

export type NormalizeExternalBusySlotsParams = {
  readonly userId: string;
  readonly expectedAccountId: string;
  readonly localDayKey: Ymd;
  readonly ianaZone: string;
  readonly nowIso: string;
  readonly ttlMinutes?: number;
  readonly syncedAtIso: string;
  readonly gateEnabled?: boolean;
  readonly rawEvents: readonly RawExternalBusyEvent[];
  readonly maskTitles?: boolean;
};

export type NormalizeExternalBusySlotsResult = {
  readonly mode: 'internal_only' | 'external_busy_merged';
  readonly canWriteExternalCalendar: false;
  readonly stale: boolean;
  readonly blocks: readonly FixedPlanBlock[];
  readonly droppedCount: number;
};

type ZonedInstantParts = {
  readonly dayKey: Ymd;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

function projectInstantToZone(ms: number, zone: string): ZonedInstantParts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms));

    let year = '';
    let month = '';
    let day = '';
    let hourStr = '';
    let minuteStr = '';
    let secondStr = '';

    for (const part of parts) {
      if (part.type === 'year') year = part.value;
      else if (part.type === 'month') month = part.value.padStart(2, '0');
      else if (part.type === 'day') day = part.value.padStart(2, '0');
      else if (part.type === 'hour') hourStr = part.value;
      else if (part.type === 'minute') minuteStr = part.value;
      else if (part.type === 'second') secondStr = part.value;
    }

    const dayKey = `${year}-${month}-${day}`;
    if (parseLocalDate(dayKey) === null) return null;

    const rawHour = Number(hourStr);
    const minute = Number(minuteStr);
    const second = Number(secondStr);
    if (!Number.isInteger(rawHour) || !Number.isInteger(minute) || !Number.isInteger(second)) {
      return null;
    }

    const hour = rawHour === 24 ? 0 : rawHour;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return null;
    }

    return { dayKey, hour, minute, second };
  } catch {
    return null;
  }
}

function isSnapshotStale(nowIso: string, syncedAtIso: string, ttlMinutes: number): boolean {
  const nowMs = Date.parse(nowIso);
  const syncedMs = Date.parse(syncedAtIso);
  if (!Number.isFinite(nowMs) || !Number.isFinite(syncedMs)) return true;
  const safeTtlMinutes =
    Number.isFinite(ttlMinutes) && ttlMinutes >= 0 ? ttlMinutes : DEFAULT_BUSY_TTL_MINUTES;
  return nowMs > syncedMs + safeTtlMinutes * 60_000;
}

/**
 * Ham dış takvim etkinliklerini tek yerel gün (`localDayKey`) ve IANA saat dilimi
 * (`ianaZone`) içinde DST-güvenli `FixedPlanBlock` meşgul aralıklarına dönüştürür.
 */
export function normalizeExternalBusySlots(
  params: NormalizeExternalBusySlotsParams,
): NormalizeExternalBusySlotsResult {
  const enabled = params.gateEnabled ?? GOOGLE_CALENDAR_INTEGRATION_ENABLED;
  if (!enabled) {
    return {
      mode: 'internal_only',
      canWriteExternalCalendar: false,
      stale: false,
      blocks: [],
      droppedCount: params.rawEvents.length,
    };
  }

  const ttlMinutes = params.ttlMinutes ?? DEFAULT_BUSY_TTL_MINUTES;
  const stale = isSnapshotStale(params.nowIso, params.syncedAtIso, ttlMinutes);
  const userId = params.userId.trim();
  const expectedAccountId = params.expectedAccountId.trim();

  if (
    userId.length === 0 ||
    expectedAccountId.length === 0 ||
    parseLocalDate(params.localDayKey) === null ||
    !isValidTimeZone(params.ianaZone)
  ) {
    return {
      mode: 'external_busy_merged',
      canWriteExternalCalendar: false,
      stale,
      blocks: [],
      droppedCount: params.rawEvents.length,
    };
  }

  const shouldMaskTitles = params.maskTitles ?? true;
  const blocks: FixedPlanBlock[] = [];
  const seenOccurrenceKeys = new Set<string>();
  let droppedCount = 0;

  for (const raw of params.rawEvents) {
    if (raw.status === 'cancelled') {
      droppedCount += 1;
      continue;
    }
    if (
      typeof raw.accountId !== 'string' ||
      raw.accountId !== expectedAccountId ||
      typeof raw.externalEventId !== 'string' ||
      raw.externalEventId.trim().length === 0 ||
      typeof raw.calendarId !== 'string' ||
      raw.calendarId.trim().length === 0
    ) {
      droppedCount += 1;
      continue;
    }

    const startMs = Date.parse(raw.startIso);
    const endMs = Date.parse(raw.endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      droppedCount += 1;
      continue;
    }

    const startZoned = projectInstantToZone(startMs, params.ianaZone);
    const endZoned = projectInstantToZone(endMs, params.ianaZone);
    if (startZoned === null || endZoned === null) {
      droppedCount += 1;
      continue;
    }

    // Etkinlik bu yerel takvim günüyle kesişmiyorsa düşür.
    if (startZoned.dayKey > params.localDayKey || endZoned.dayKey < params.localDayKey) {
      droppedCount += 1;
      continue;
    }

    // Bir önceki günden taşan ancak tam 00:00:00'da biten etkinlik bu günden dakika almaz.
    if (
      endZoned.dayKey === params.localDayKey &&
      startZoned.dayKey < params.localDayKey &&
      endZoned.hour === 0 &&
      endZoned.minute === 0 &&
      endZoned.second === 0
    ) {
      droppedCount += 1;
      continue;
    }

    const clippedStartMin =
      startZoned.dayKey < params.localDayKey ? 0 : startZoned.hour * 60 + startZoned.minute;

    let clippedEndMin: number;
    if (endZoned.dayKey > params.localDayKey) {
      clippedEndMin = 1439;
    } else {
      const rawEndMin =
        endZoned.hour * 60 + endZoned.minute + (endZoned.second > 0 ? 1 : 0);
      clippedEndMin = Math.min(1439, rawEndMin);
    }

    // Kış saati geri dönüşünde (DST fall-back) gerçek süre pozitifken duvar saati geriye sarabilir.
    if (
      clippedEndMin <= clippedStartMin &&
      startZoned.dayKey === params.localDayKey &&
      endZoned.dayKey === params.localDayKey
    ) {
      const elapsedMinutes = Math.max(1, Math.ceil((endMs - startMs) / 60_000));
      clippedEndMin = Math.min(1439, clippedStartMin + elapsedMinutes);
    }

    if (clippedEndMin <= clippedStartMin) {
      droppedCount += 1;
      continue;
    }

    const startHm = formatMinutesToHm(clippedStartMin);
    const endHm = formatMinutesToHm(clippedEndMin);
    const dedupeFingerprint = canonical({
      u: userId,
      a: raw.accountId,
      c: raw.calendarId.trim(),
      e: raw.externalEventId.trim(),
      r: raw.recurringMasterId ?? null,
      d: params.localDayKey,
      s: startHm,
      f: endHm,
    });

    if (seenOccurrenceKeys.has(dedupeFingerprint)) {
      droppedCount += 1;
      continue;
    }
    seenOccurrenceKeys.add(dedupeFingerprint);

    const resolvedTitle = shouldMaskTitles
      ? MASKED_EXTERNAL_BUSY_TITLE
      : raw.title && raw.title.trim().length > 0
        ? raw.title.trim()
        : MASKED_EXTERNAL_BUSY_TITLE;

    blocks.push({
      id: `extbusy:${checksum(dedupeFingerprint)}`,
      user_id: userId,
      title: resolvedTitle,
      local_day: params.localDayKey,
      start_time: startHm,
      end_time: endHm,
      locked: true,
      source: 'external_busy',
    });
  }

  blocks.sort((a, b) => {
    if (a.start_time !== b.start_time) return a.start_time.localeCompare(b.start_time);
    if (a.end_time !== b.end_time) return a.end_time.localeCompare(b.end_time);
    return a.id.localeCompare(b.id);
  });

  return {
    mode: 'external_busy_merged',
    canWriteExternalCalendar: false,
    stale,
    blocks,
    droppedCount,
  };
}

/**
 * İzin geri çekildiğinde veya hesap değiştiğinde önbellekteki tüm dış takvim
 * meşgul aralıklarını anında temizler (`E16`).
 */
export function revokeExternalCalendarAccess(
  cache: BusyCacheSnapshot | null,
): {
  readonly cleared: true;
  readonly nextCache: null;
} {
  void cache;
  return {
    cleared: true,
    nextCache: null,
  };
}
