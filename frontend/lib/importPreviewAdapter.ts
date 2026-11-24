/**
 * Faz F7 — E15 (`R08.01`..`R08.06`, `I2`, `I3`):
 * Kuru çalıştırma (dry-run) yedek doğrulama ve dış kaynak (`habitify_json`,
 * `daylio_csv`) içe aktarma önizleme bağdaştırıcısı.
 *
 * Sınır kuralları:
 * - `R08_BACKUP_PROTECTION.md` gereği uygulama içi özel kripto/karıştırma
 *   algoritması içermez; yalnız `backupFormat.ts` bütünlük sağlamasını kullanır.
 * - Sağlık ve biyometrik sensör verilerini (`I2`) reddeder.
 * - Sunucu otoritesi alanlarını (`AUTHORITY_FIELDS`: `xp`, `total_xp`,
 *   `focus_points`, `access_token`, vb.) her kayıttan temizler.
 * - Manifest sağlamasıyla doğrulanmış alanları (`verifiedFields`) harici
 *   doğrulanmamış önizleme satırlarından (`importedUnverifiedFields`) kesin ayırır.
 * - Deterministik `importRowKey` (`imp:<checksum>`) üretir; ikinci içe aktarmada
 *   `0` kopya satır garantisi sağlar.
 */

import {
  AUTHORITY_FIELDS,
  MAX_BACKUP_TEXT_CHARS,
  REGISTRY,
  canonical,
  checksum,
  stripAuthority,
  verifyBackupText,
} from './backupFormat';
import { normalizeDate, parseCsv } from './csvImport';
import { parseLocalDate, type Ymd } from './date';

export const MAX_EXTERNAL_IMPORT_CHARS = 5_000_000;

export type ExternalImportFormat = 'aderyth_v3' | 'habitify_json' | 'daylio_csv';

export type ImportPreviewErrorCode =
  | 'missing_user'
  | 'cross_account'
  | 'empty_input'
  | 'oversized'
  | 'truncated'
  | 'malformed'
  | 'unsupported_biometric';

export type VerifiedPreviewField = {
  readonly importRowKey: string;
  readonly collection: string;
  readonly recordId: string;
  readonly naturalKey: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly trust: 'verified_manifest';
};

export type ImportedUnverifiedField = {
  readonly importRowKey: string;
  readonly sourceFormat: 'habitify_json' | 'daylio_csv';
  readonly kind: 'external_habit_entry' | 'external_mood_journal';
  readonly naturalKey: string;
  readonly habitName: string | null;
  readonly localDate: Ymd;
  readonly completionState: 'done' | 'partial' | 'skip' | 'miss' | null;
  readonly moodLabel: string | null;
  readonly moodScore: number | null;
  readonly activities: readonly string[];
  readonly note: string | null;
  readonly trust: 'imported_unverified';
  readonly requiresManualReview: true;
};

export type SkippedCollectionSummary = {
  readonly collection: string;
  readonly count: number;
  readonly reason: string;
};

export type InvalidImportRow = {
  readonly index: number;
  readonly reason: string;
};

export type PreviewExternalImportParams = {
  readonly signedInUserId: string;
  readonly targetUserId?: string;
  readonly format: ExternalImportFormat;
  readonly rawText: string;
  readonly existingIds?: ReadonlySet<string>;
  readonly existingNaturalKeys?: ReadonlySet<string>;
};

export type PreviewExternalImportResult =
  | {
      readonly ok: true;
      readonly dryRun: true;
      readonly format: ExternalImportFormat;
      readonly trustLevel: 'manifest_verified' | 'external_unverified';
      readonly verifiedFields: readonly VerifiedPreviewField[];
      readonly importedUnverifiedFields: readonly ImportedUnverifiedField[];
      readonly skippedNonRestorableCollections: readonly SkippedCollectionSummary[];
      readonly invalidRows: readonly InvalidImportRow[];
      readonly strippedAuthorityFields: readonly string[];
      readonly importRowKeys: readonly string[];
      readonly naturalKeys: readonly string[];
      readonly newRowCount: number;
      readonly skippedDuplicateCount: number;
    }
  | {
      readonly ok: false;
      readonly dryRun: true;
      readonly format: ExternalImportFormat;
      readonly errorCode: ImportPreviewErrorCode;
      readonly reason: string;
    };

const BIOMETRIC_FIELD_NAMES = new Set([
  'heart_rate',
  'hrv',
  'blood_pressure',
  'spo2',
  'blood_oxygen',
  'sleep_stages',
  'electrocardiogram',
  'healthkit_payload',
  'google_fit_token',
  'apple_health_export',
  'biometric_samples',
]);

const DAYLIO_MOOD_SCORES: Readonly<Record<string, number>> = {
  rad: 5,
  harika: 5,
  amazing: 5,
  good: 4,
  iyi: 4,
  meh: 3,
  orta: 3,
  okay: 3,
  bad: 2,
  kötü: 2,
  kotu: 2,
  awful: 1,
  berbat: 1,
};

function hasBiometricKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    const normalized = key.trim().toLowerCase();
    if (BIOMETRIC_FIELD_NAMES.has(normalized)) return true;
  }
  return false;
}

function hasUnclosedCsvQuotes(raw: string): boolean {
  const src = raw.replace(/^\uFEFF/, '');
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      }
    } else if (c === '"') {
      inQuotes = true;
    }
  }
  return inQuotes;
}

function looksTruncatedJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first === '{' && last !== '}') return true;
  if (first === '[' && last !== ']') return true;
  return false;
}

function normalizeExternalDay(raw: unknown): Ymd | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const direct = normalizeDate(trimmed);
  if (direct !== null) return direct;
  if (trimmed.length >= 10) {
    const prefix = trimmed.slice(0, 10);
    if (parseLocalDate(prefix) !== null) return prefix;
  }
  return null;
}

function normalizeHabitifyStatus(
  rawStatus: unknown,
  rawCompleted: unknown,
  rawValue: unknown,
): 'done' | 'partial' | 'skip' | 'miss' {
  if (typeof rawStatus === 'string') {
    const s = rawStatus.trim().toLowerCase();
    if (s === 'done' || s === 'completed' || s === 'complete' || s === 'succeeded') return 'done';
    if (s === 'partial' || s === 'in_progress' || s === 'progress') return 'partial';
    if (s === 'skip' || s === 'skipped' || s === 'excused') return 'skip';
    if (s === 'miss' || s === 'missed' || s === 'failed' || s === 'none') return 'miss';
  }
  if (rawCompleted === true) return 'done';
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) return 'done';
  if (rawCompleted === false) return 'miss';
  return 'done';
}

function parseDaylioMoodScore(rawMood: string): number | null {
  const trimmed = rawMood.trim().toLocaleLowerCase('tr');
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) {
    return numeric;
  }
  return DAYLIO_MOOD_SCORES[trimmed] ?? null;
}

function buildImportRowKey(format: ExternalImportFormat, naturalKey: string, core: unknown): string {
  return `imp:${checksum(canonical({ f: format, k: naturalKey, c: core }))}`;
}

function isAlreadyImported(
  importRowKey: string,
  naturalKey: string,
  recordId: string | null,
  existingIds: ReadonlySet<string> | undefined,
  existingNaturalKeys: ReadonlySet<string> | undefined,
  seenRowKeys: Set<string>,
  seenNaturalKeys: Set<string>,
): boolean {
  if (seenRowKeys.has(importRowKey) || seenNaturalKeys.has(naturalKey)) return true;
  if (existingIds?.has(importRowKey)) return true;
  if (recordId !== null && existingIds?.has(recordId)) return true;
  if (existingNaturalKeys?.has(naturalKey) || existingNaturalKeys?.has(importRowKey)) return true;
  return false;
}

function recordStripped(into: Set<string>, stripped: readonly string[]): void {
  for (const field of stripped) {
    into.add(field);
  }
}

function previewAderythBackup(
  params: PreviewExternalImportParams,
): PreviewExternalImportResult {
  const checked = verifyBackupText(params.rawText, params.signedInUserId);
  if (!checked.ok) {
    let errorCode: ImportPreviewErrorCode = 'malformed';
    if (checked.reason.includes('çok büyük')) errorCode = 'oversized';
    else if (checked.reason.includes('başka bir hesaba ait')) errorCode = 'cross_account';
    else if (checked.reason.includes('kesilmiş')) errorCode = 'truncated';
    return {
      ok: false,
      dryRun: true,
      format: 'aderyth_v3',
      errorCode,
      reason: checked.reason,
    };
  }

  const verifiedFields: VerifiedPreviewField[] = [];
  const skippedNonRestorableCollections: SkippedCollectionSummary[] = [];
  const invalidRows: InvalidImportRow[] = [];
  const strippedSet = new Set<string>();
  const seenRowKeys = new Set<string>();
  const seenNaturalKeys = new Set<string>();
  let skippedDuplicateCount = 0;

  const sortedSpecs = [...REGISTRY].sort((a, b) => a.order - b.order);
  for (const spec of sortedSpecs) {
    const rows = checked.collections[spec.name];
    if (!rows) continue;

    if (!spec.restorable) {
      skippedNonRestorableCollections.push({
        collection: spec.name,
        count: rows.length,
        reason: spec.reason ?? 'Sunucu otoritesi koleksiyonu; dosyadan geri yüklenmez.',
      });
      for (const rawRow of rows) {
        if (rawRow && typeof rawRow === 'object' && !Array.isArray(rawRow)) {
          recordStripped(strippedSet, stripAuthority(rawRow).stripped);
        }
      }
      continue;
    }

    rows.forEach((rawRow, index) => {
      if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        invalidRows.push({ index, reason: `${spec.name}: geçersiz satır nesnesi.` });
        return;
      }
      if (hasBiometricKeys(rawRow)) {
        invalidRows.push({ index, reason: `${spec.name}: biyometrik alan desteklenmiyor.` });
        return;
      }
      if (
        rawRow.user_id !== undefined &&
        String(rawRow.user_id) !== params.signedInUserId
      ) {
        invalidRows.push({
          index,
          reason: `${spec.name}: başka hesaba ait satır atlandı.`,
        });
        return;
      }

      const recordId = typeof rawRow.id === 'string' ? rawRow.id.trim() : '';
      if (recordId.length === 0) {
        invalidRows.push({ index, reason: `${spec.name}: satır kimliği (id) eksik.` });
        return;
      }

      const { row: cleanedRow, stripped } = stripAuthority(rawRow);
      recordStripped(strippedSet, stripped);

      const uniqueSuffix =
        spec.uniqueBy && cleanedRow[spec.uniqueBy] !== undefined
          ? String(cleanedRow[spec.uniqueBy])
          : recordId;
      const naturalKey = `aderyth_v3:${spec.name}:${uniqueSuffix}`;
      const importRowKey = buildImportRowKey('aderyth_v3', naturalKey, cleanedRow);

      if (
        isAlreadyImported(
          importRowKey,
          naturalKey,
          recordId,
          params.existingIds,
          params.existingNaturalKeys,
          seenRowKeys,
          seenNaturalKeys,
        )
      ) {
        skippedDuplicateCount += 1;
        return;
      }

      seenRowKeys.add(importRowKey);
      seenNaturalKeys.add(naturalKey);
      verifiedFields.push({
        importRowKey,
        collection: spec.name,
        recordId,
        naturalKey,
        values: cleanedRow,
        trust: 'verified_manifest',
      });
    });
  }

  return {
    ok: true,
    dryRun: true,
    format: 'aderyth_v3',
    trustLevel: 'manifest_verified',
    verifiedFields,
    importedUnverifiedFields: [],
    skippedNonRestorableCollections,
    invalidRows,
    strippedAuthorityFields: [...strippedSet].sort(),
    importRowKeys: verifiedFields.map((r) => r.importRowKey),
    naturalKeys: verifiedFields.map((r) => r.naturalKey),
    newRowCount: verifiedFields.length,
    skippedDuplicateCount,
  };
}

function previewHabitifyJson(
  params: PreviewExternalImportParams,
): PreviewExternalImportResult {
  if (params.rawText.length > MAX_EXTERNAL_IMPORT_CHARS) {
    return {
      ok: false,
      dryRun: true,
      format: 'habitify_json',
      errorCode: 'oversized',
      reason: 'Habitify JSON dosyası çok büyük (5 MB sınırını aşıyor).',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawText);
  } catch {
    const truncated = looksTruncatedJson(params.rawText);
    return {
      ok: false,
      dryRun: true,
      format: 'habitify_json',
      errorCode: truncated ? 'truncated' : 'malformed',
      reason: truncated
        ? 'Habitify JSON dosyası yarıda kesilmiş veya eksik; içe aktarılamaz.'
        : 'Habitify JSON dosyası okunamadı; geçerli bir JSON biçimi değil.',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      dryRun: true,
      format: 'habitify_json',
      errorCode: 'malformed',
      reason: 'Habitify verisi beklenen nesne veya dizi yapısında değil.',
    };
  }

  const strippedSet = new Set<string>();
  let rawItems: unknown[] | null = null;

  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else {
    const rootObj = parsed as Record<string, unknown>;
    if (hasBiometricKeys(rootObj)) {
      return {
        ok: false,
        dryRun: true,
        format: 'habitify_json',
        errorCode: 'unsupported_biometric',
        reason: 'Sağlık ve biyometrik sensör verileri bu uygulamaya içe aktarılmaz.',
      };
    }
    if (rootObj.truncated === true || rootObj.incomplete === true) {
      return {
        ok: false,
        dryRun: true,
        format: 'habitify_json',
        errorCode: 'truncated',
        reason: 'Habitify dışa aktarım dosyası eksik (truncated) olarak işaretlenmiş.',
      };
    }
    const embeddedUser = rootObj.user_id ?? rootObj.account_id;
    if (typeof embeddedUser === 'string' && embeddedUser.trim() !== params.signedInUserId) {
      return {
        ok: false,
        dryRun: true,
        format: 'habitify_json',
        errorCode: 'cross_account',
        reason: 'Bu dosya başka bir hesaba ait. Hesaplar arası içe aktarma desteklenmiyor.',
      };
    }
    recordStripped(strippedSet, stripAuthority(rootObj).stripped);

    if (Array.isArray(rootObj.habits)) rawItems = rootObj.habits;
    else if (Array.isArray(rootObj.entries)) rawItems = rootObj.entries;
    else if (Array.isArray(rootObj.items)) rawItems = rootObj.items;
  }

  if (rawItems === null) {
    return {
      ok: false,
      dryRun: true,
      format: 'habitify_json',
      errorCode: 'malformed',
      reason: 'Habitify JSON içinde "habits" veya "entries" listesi bulunamadı.',
    };
  }

  const importedUnverifiedFields: ImportedUnverifiedField[] = [];
  const invalidRows: InvalidImportRow[] = [];
  const seenRowKeys = new Set<string>();
  const seenNaturalKeys = new Set<string>();
  let skippedDuplicateCount = 0;

  const pushHabitEntry = (
    index: number,
    habitNameRaw: unknown,
    dateRaw: unknown,
    statusRaw: unknown,
    completedRaw: unknown,
    valueRaw: unknown,
    noteRaw: unknown,
    sourceIdRaw: unknown,
  ): void => {
    const habitName = typeof habitNameRaw === 'string' ? habitNameRaw.trim() : '';
    if (habitName.length === 0 || habitName.length > 200) {
      invalidRows.push({ index, reason: 'Alışkanlık adı boş veya çok uzun.' });
      return;
    }
    const localDate = normalizeExternalDay(dateRaw);
    if (localDate === null) {
      invalidRows.push({ index, reason: `Geçersiz tarih: ${String(dateRaw ?? '')}` });
      return;
    }
    const completionState = normalizeHabitifyStatus(statusRaw, completedRaw, valueRaw);
    const note =
      typeof noteRaw === 'string' && noteRaw.trim().length > 0
        ? noteRaw.trim().slice(0, 1000)
        : null;
    const naturalKey = `habitify:${habitName.toLocaleLowerCase('tr')}:${localDate}:${completionState}`;
    const core = {
      habitName,
      localDate,
      completionState,
      note,
    };
    const importRowKey = buildImportRowKey('habitify_json', naturalKey, core);
    const sourceId =
      typeof sourceIdRaw === 'string' && sourceIdRaw.trim().length > 0
        ? sourceIdRaw.trim()
        : null;

    if (
      isAlreadyImported(
        importRowKey,
        naturalKey,
        sourceId,
        params.existingIds,
        params.existingNaturalKeys,
        seenRowKeys,
        seenNaturalKeys,
      )
    ) {
      skippedDuplicateCount += 1;
      return;
    }

    seenRowKeys.add(importRowKey);
    seenNaturalKeys.add(naturalKey);
    importedUnverifiedFields.push({
      importRowKey,
      sourceFormat: 'habitify_json',
      kind: 'external_habit_entry',
      naturalKey,
      habitName,
      localDate,
      completionState,
      moodLabel: null,
      moodScore: null,
      activities: [habitName],
      note,
      trust: 'imported_unverified',
      requiresManualReview: true,
    });
  };

  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalidRows.push({ index, reason: 'Satır nesne biçiminde değil.' });
      continue;
    }
    const rawObj = item as Record<string, unknown>;
    if (hasBiometricKeys(rawObj)) {
      return {
        ok: false,
        dryRun: true,
        format: 'habitify_json',
        errorCode: 'unsupported_biometric',
        reason: 'Sağlık ve biyometrik sensör verileri bu uygulamaya içe aktarılmaz.',
      };
    }

    const { row: cleanedObj, stripped } = stripAuthority(rawObj);
    recordStripped(strippedSet, stripped);

    const habitNameCandidate =
      cleanedObj.name ?? cleanedObj.habit_name ?? cleanedObj.habitName ?? cleanedObj.title;

    const nestedLogs = Array.isArray(cleanedObj.logs)
      ? cleanedObj.logs
      : Array.isArray(cleanedObj.checkins)
        ? cleanedObj.checkins
        : null;

    if (nestedLogs && nestedLogs.length > 0) {
      for (const logEntry of nestedLogs) {
        if (!logEntry || typeof logEntry !== 'object' || Array.isArray(logEntry)) {
          invalidRows.push({ index, reason: 'İç alışkanlık kaydı bozuk.' });
          continue;
        }
        const rawLog = logEntry as Record<string, unknown>;
        if (hasBiometricKeys(rawLog)) {
          return {
            ok: false,
            dryRun: true,
            format: 'habitify_json',
            errorCode: 'unsupported_biometric',
            reason: 'Sağlık ve biyometrik sensör verileri bu uygulamaya içe aktarılmaz.',
          };
        }
        const { row: cleanedLog, stripped: logStripped } = stripAuthority(rawLog);
        recordStripped(strippedSet, logStripped);
        pushHabitEntry(
          index,
          habitNameCandidate,
          cleanedLog.date ?? cleanedLog.local_date ?? cleanedLog.completed_at,
          cleanedLog.status ?? cleanedLog.state,
          cleanedLog.completed,
          cleanedLog.value,
          cleanedLog.note ?? cleanedLog.notes,
          cleanedLog.id,
        );
      }
      continue;
    }

    pushHabitEntry(
      index,
      habitNameCandidate,
      cleanedObj.date ??
        cleanedObj.local_date ??
        cleanedObj.completed_at ??
        cleanedObj.created_date ??
        cleanedObj.created_at,
      cleanedObj.status ?? cleanedObj.state,
      cleanedObj.completed,
      cleanedObj.value,
      cleanedObj.note ?? cleanedObj.notes,
      cleanedObj.id,
    );
  }

  return {
    ok: true,
    dryRun: true,
    format: 'habitify_json',
    trustLevel: 'external_unverified',
    verifiedFields: [],
    importedUnverifiedFields,
    skippedNonRestorableCollections: [],
    invalidRows,
    strippedAuthorityFields: [...strippedSet].sort(),
    importRowKeys: importedUnverifiedFields.map((r) => r.importRowKey),
    naturalKeys: importedUnverifiedFields.map((r) => r.naturalKey),
    newRowCount: importedUnverifiedFields.length,
    skippedDuplicateCount,
  };
}

function previewDaylioCsv(
  params: PreviewExternalImportParams,
): PreviewExternalImportResult {
  if (params.rawText.length > MAX_EXTERNAL_IMPORT_CHARS) {
    return {
      ok: false,
      dryRun: true,
      format: 'daylio_csv',
      errorCode: 'oversized',
      reason: 'Daylio CSV dosyası çok büyük (5 MB sınırını aşıyor).',
    };
  }

  if (hasUnclosedCsvQuotes(params.rawText)) {
    return {
      ok: false,
      dryRun: true,
      format: 'daylio_csv',
      errorCode: 'truncated',
      reason: 'Daylio CSV dosyası yarıda kesilmiş (kapanmamış tırnak alanı bulundu).',
    };
  }

  const rows = parseCsv(params.rawText);
  if (rows.length < 2) {
    return {
      ok: false,
      dryRun: true,
      format: 'daylio_csv',
      errorCode: 'malformed',
      reason: 'Daylio CSV dosyasında başlık ve en az bir veri satırı bulunmalıdır.',
    };
  }

  const header = rows[0].map((col) => col.trim().toLowerCase());
  for (const col of header) {
    if (BIOMETRIC_FIELD_NAMES.has(col)) {
      return {
        ok: false,
        dryRun: true,
        format: 'daylio_csv',
        errorCode: 'unsupported_biometric',
        reason: 'Sağlık ve biyometrik sensör verileri bu uygulamaya içe aktarılmaz.',
      };
    }
  }

  const fullDateIdx = header.indexOf('full_date');
  const dateIdx = fullDateIdx >= 0 ? fullDateIdx : header.indexOf('date');
  const moodIdx = header.indexOf('mood');
  const activitiesIdx = header.indexOf('activities');
  const noteTitleIdx = header.indexOf('note_title');
  const noteIdx = header.indexOf('note');
  const idIdx = header.indexOf('id');

  if (dateIdx < 0 || moodIdx < 0) {
    return {
      ok: false,
      dryRun: true,
      format: 'daylio_csv',
      errorCode: 'malformed',
      reason: 'Daylio CSV başlık satırı tanınmadı ("full_date"/"date" ve "mood" sütunları gerekli).',
    };
  }

  const authoritySet = new Set<string>(AUTHORITY_FIELDS);
  const strippedSet = new Set<string>();
  for (const col of header) {
    if (authoritySet.has(col)) {
      strippedSet.add(col);
    }
  }

  const importedUnverifiedFields: ImportedUnverifiedField[] = [];
  const invalidRows: InvalidImportRow[] = [];
  const seenRowKeys = new Set<string>();
  const seenNaturalKeys = new Set<string>();
  let skippedDuplicateCount = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.length < Math.min(header.length, 2)) {
      invalidRows.push({ index: i, reason: 'Eksik sütunlu CSV satırı.' });
      continue;
    }

    const rawDate = (r[dateIdx] ?? '').trim();
    const localDate = normalizeExternalDay(rawDate);
    if (localDate === null) {
      invalidRows.push({ index: i, reason: `Geçersiz tarih: ${rawDate}` });
      continue;
    }

    const moodLabel = (r[moodIdx] ?? '').trim();
    if (moodLabel.length === 0) {
      invalidRows.push({ index: i, reason: 'Ruh hali (mood) alanı boş.' });
      continue;
    }
    const moodScore = parseDaylioMoodScore(moodLabel);

    const rawActivities = activitiesIdx >= 0 ? (r[activitiesIdx] ?? '').trim() : '';
    const activities = rawActivities
      ? rawActivities
          .split(/\||;/)
          .map((x) => x.trim())
          .filter((x) => x.length > 0)
      : [];

    const noteTitle = noteTitleIdx >= 0 ? (r[noteTitleIdx] ?? '').trim() : '';
    const noteBody = noteIdx >= 0 ? (r[noteIdx] ?? '').trim() : '';
    const combinedNote =
      noteTitle && noteBody
        ? `${noteTitle}: ${noteBody}`
        : noteTitle || noteBody || '';
    const note = combinedNote.length > 0 ? combinedNote.slice(0, 2000) : null;

    const normalizedActivitiesKey = activities
      .map((a) => a.toLocaleLowerCase('tr'))
      .join('|');
    const naturalKey = `daylio:${localDate}:${moodLabel.toLocaleLowerCase('tr')}:${normalizedActivitiesKey}:${note ?? ''}`;
    const core = {
      localDate,
      moodLabel,
      moodScore,
      activities,
      note,
    };
    const importRowKey = buildImportRowKey('daylio_csv', naturalKey, core);
    const sourceId =
      idIdx >= 0 && (r[idIdx] ?? '').trim().length > 0 ? (r[idIdx] ?? '').trim() : null;

    if (
      isAlreadyImported(
        importRowKey,
        naturalKey,
        sourceId,
        params.existingIds,
        params.existingNaturalKeys,
        seenRowKeys,
        seenNaturalKeys,
      )
    ) {
      skippedDuplicateCount += 1;
      continue;
    }

    seenRowKeys.add(importRowKey);
    seenNaturalKeys.add(naturalKey);
    importedUnverifiedFields.push({
      importRowKey,
      sourceFormat: 'daylio_csv',
      kind: 'external_mood_journal',
      naturalKey,
      habitName: activities[0] ?? null,
      localDate,
      completionState: activities.length > 0 ? 'done' : null,
      moodLabel,
      moodScore,
      activities,
      note,
      trust: 'imported_unverified',
      requiresManualReview: true,
    });
  }

  return {
    ok: true,
    dryRun: true,
    format: 'daylio_csv',
    trustLevel: 'external_unverified',
    verifiedFields: [],
    importedUnverifiedFields,
    skippedNonRestorableCollections: [],
    invalidRows,
    strippedAuthorityFields: [...strippedSet].sort(),
    importRowKeys: importedUnverifiedFields.map((r) => r.importRowKey),
    naturalKeys: importedUnverifiedFields.map((r) => r.naturalKey),
    newRowCount: importedUnverifiedFields.length,
    skippedDuplicateCount,
  };
}

/**
 * Yedek (`aderyth_v3`) veya harici (`habitify_json`, `daylio_csv`) metin girdisini
 * hiçbir yere yazmadan doğrular, yetki alanlarını temizler ve kopyasız önizleme üretir.
 */
export function previewExternalHabitCsvOrJson(
  params: PreviewExternalImportParams,
): PreviewExternalImportResult {
  const signedInUserId =
    typeof params.signedInUserId === 'string' ? params.signedInUserId.trim() : '';
  if (signedInUserId.length === 0) {
    return {
      ok: false,
      dryRun: true,
      format: params.format,
      errorCode: 'missing_user',
      reason: 'İçe aktarma önizlemesi için oturum açmış kullanıcı gerekli.',
    };
  }

  if (
    params.targetUserId !== undefined &&
    params.targetUserId.trim() !== signedInUserId
  ) {
    return {
      ok: false,
      dryRun: true,
      format: params.format,
      errorCode: 'cross_account',
      reason: 'Bu dosya başka bir hesaba ait. Hesaplar arası içe aktarma desteklenmiyor.',
    };
  }

  if (typeof params.rawText !== 'string' || params.rawText.trim().length === 0) {
    return {
      ok: false,
      dryRun: true,
      format: params.format,
      errorCode: 'empty_input',
      reason: 'İçe aktarılacak dosya metni boş.',
    };
  }

  if (params.rawText.length > MAX_BACKUP_TEXT_CHARS) {
    return {
      ok: false,
      dryRun: true,
      format: params.format,
      errorCode: 'oversized',
      reason: 'Dosya çok büyük (25 MB üstü); önizleme oluşturulamaz.',
    };
  }

  const normalizedParams: PreviewExternalImportParams = {
    ...params,
    signedInUserId,
  };

  if (params.format === 'aderyth_v3') {
    return previewAderythBackup(normalizedParams);
  }
  if (params.format === 'habitify_json') {
    return previewHabitifyJson(normalizedParams);
  }
  return previewDaylioCsv(normalizedParams);
}
