/**
 * Faz F7 — E15, E16, U13, U15, P05:
 * Dar kapsamlı salt okunur takvim meşguliyet bağdaştırıcısı (`calendarBusyAdapter`),
 * kuru çalıştırma yedek/dış kaynak içe aktarma önizlemesi (`importPreviewAdapter`),
 * yargılamayan kümülatif çaba özeti, tek adımlı sakin dönüş ipucu, örneklem eşikli
 * kişisel süre kalibrasyonu (`calmProgress`) ve `AchievementsScreen` entegrasyon testleri.
 */

import React from 'react';

const mockReact = React;

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => mockReact.createElement('ExpoImage', props),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/haptics', () => ({
  haptic: { select: jest.fn(), light: jest.fn(), success: jest.fn() },
}));
jest.mock('../../components/spatial', () => ({
  AtmosphericScreenCanvas: () => null,
  ChapterDivider: (props: { label?: string }) =>
    mockReact.createElement('ChapterDivider', props),
  EmbeddedFiligree: () => null,
}));

const mockStoreData = {
  profile: {
    id: 'u-1',
    email: 'user@example.com',
    username: 'sakin_yolcu',
    level: 4,
    total_xp: 420,
    current_level_xp: 20,
    next_level_xp: 100,
    willpower_rank: 'Odaklı',
    streak_record: 9,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  badges: [
    {
      id: 'first_step',
      user_id: 'u-1',
      badge_name: 'İlk Adım',
      icon: null,
      description: null,
      earned_at: '2026-02-01T10:00:00.000Z',
    },
  ],
  habits: [
    {
      id: 'h-1',
      user_id: 'u-1',
      name: 'Kitap Okuma',
      status: 'active',
      streak_current: 3,
    },
  ],
  logs: [
    {
      id: 'l-1',
      habit_id: 'h-1',
      user_id: 'u-1',
      completed_at: '2026-05-01',
      value: null,
      is_completed: true,
      state: 'done' as const,
      xp: 10,
      created_at: '2026-05-01T09:00:00.000Z',
    },
    {
      id: 'l-2',
      habit_id: 'h-1',
      user_id: 'u-1',
      completed_at: '2026-05-02',
      value: null,
      is_completed: false,
      state: 'miss' as const,
      xp: 0,
      created_at: '2026-05-02T09:00:00.000Z',
    },
    {
      id: 'l-3',
      habit_id: 'h-1',
      user_id: 'u-1',
      completed_at: '2026-05-03',
      value: null,
      is_completed: true,
      state: 'done' as const,
      xp: 10,
      created_at: '2026-05-03T09:00:00.000Z',
    },
    {
      id: 'l-4',
      habit_id: 'h-1',
      user_id: 'u-1',
      completed_at: '2026-05-04',
      value: 0.5,
      is_completed: false,
      state: 'partial' as const,
      xp: 5,
      created_at: '2026-05-04T09:00:00.000Z',
    },
  ],
  tasks: [
    { id: 't-1', title: 'Rapor özeti', completed: true },
    { id: 't-2', title: 'Açık görev', completed: false },
  ],
  sessions: [{ id: 's-1', duration_minutes: 25 }],
  entries: [{ id: 'j-1', date: '2026-05-03', content: 'Sakin bir gün.' }],
};

jest.mock('../../store/profileStore', () => ({
  useProfileStore: (selector: (st: Record<string, unknown>) => unknown) =>
    selector({
      profile: mockStoreData.profile,
      badges: mockStoreData.badges,
      fetchProfile: jest.fn(),
      fetchBadges: jest.fn(),
    }),
}));
jest.mock('../../store/habitStore', () => ({
  useHabitStore: (selector: (st: Record<string, unknown>) => unknown) =>
    selector({ habits: mockStoreData.habits }),
}));
jest.mock('../../store/logStore', () => ({
  useLogStore: (selector: (st: Record<string, unknown>) => unknown) =>
    selector({ logs: mockStoreData.logs }),
}));
jest.mock('../../store/taskStore', () => ({
  useTaskStore: (selector: (st: Record<string, unknown>) => unknown) =>
    selector({ tasks: mockStoreData.tasks }),
}));
jest.mock('../../store/deepWorkStore', () => ({
  useDeepWorkStore: (selector: (st: Record<string, unknown>) => unknown) =>
    selector({ sessions: mockStoreData.sessions }),
}));
jest.mock('../../store/journalStore', () => ({
  useJournalStore: (selector: (st: Record<string, unknown>) => unknown) =>
    selector({ entries: mockStoreData.entries }),
}));

import AchievementsScreen from '../../app/screens/achievements';
import { buildManifest } from '../../lib/backupFormat';
import * as calendarBusyModule from '../../lib/calendarBusyAdapter';
import {
  EXTERNAL_CALENDAR_CAPABILITIES,
  MASKED_EXTERNAL_BUSY_TITLE,
  normalizeExternalBusySlots,
  revokeExternalCalendarAccess,
  type BusyCacheSnapshot,
  type RawExternalBusyEvent,
} from '../../lib/calendarBusyAdapter';
import {
  CALIBRATION_MULTIPLIER_MAX,
  CALIBRATION_MULTIPLIER_MIN,
  MIN_CALIBRATION_SAMPLES,
  buildCalmEffortSummary,
  evaluateCalmReturnHint,
  evaluateDurationCalibration,
  resetCalibration,
} from '../../lib/calmProgress';
import { deriveRemainingCapacityMinutes } from '../../lib/dayPlanPreview';
import { GOOGLE_CALENDAR_INTEGRATION_ENABLED } from '../../lib/featureGates';
import {
  MAX_EXTERNAL_IMPORT_CHARS,
  previewExternalHabitCsvOrJson,
} from '../../lib/importPreviewAdapter';
import { renderWithProviders, within } from '../helpers/renderWithProviders';

describe('E16 — calendarBusyAdapter (read-only gated external busy adapter)', () => {
  const sampleEvents: readonly RawExternalBusyEvent[] = Object.freeze([
    Object.freeze({
      externalEventId: 'evt-1',
      accountId: 'gcal-acc-1',
      calendarId: 'primary',
      startIso: '2026-06-15T07:00:00.000Z', // 10:00 Europe/Istanbul
      endIso: '2026-06-15T08:30:00.000Z', // 11:30 Europe/Istanbul
      status: 'confirmed',
      title: 'Özel Terapi Randevusu',
    }),
    Object.freeze({
      externalEventId: 'evt-cancelled',
      accountId: 'gcal-acc-1',
      calendarId: 'primary',
      startIso: '2026-06-15T09:00:00.000Z',
      endIso: '2026-06-15T10:00:00.000Z',
      status: 'cancelled',
      title: 'İptal Edilen Toplantı',
    }),
    Object.freeze({
      externalEventId: 'evt-foreign',
      accountId: 'other-google-account',
      calendarId: 'primary',
      startIso: '2026-06-15T11:00:00.000Z',
      endIso: '2026-06-15T12:00:00.000Z',
      status: 'confirmed',
      title: 'Başka Hesap Etkinliği',
    }),
    Object.freeze({
      externalEventId: 'evt-invalid-range',
      accountId: 'gcal-acc-1',
      calendarId: 'primary',
      startIso: '2026-06-15T14:00:00.000Z',
      endIso: '2026-06-15T13:00:00.000Z',
      status: 'confirmed',
      title: 'Bozuk Aralık',
    }),
    Object.freeze({
      externalEventId: 'evt-other-day',
      accountId: 'gcal-acc-1',
      calendarId: 'primary',
      startIso: '2026-06-16T08:00:00.000Z',
      endIso: '2026-06-16T09:00:00.000Z',
      status: 'confirmed',
      title: 'Yarınki Toplantı',
    }),
  ]);

  it('(+) keeps GOOGLE_CALENDAR_INTEGRATION_ENABLED false and returns internal_only when gate is off', () => {
    expect(GOOGLE_CALENDAR_INTEGRATION_ENABLED).toBe(false);
    const res = normalizeExternalBusySlots({
      userId: 'u-1',
      expectedAccountId: 'gcal-acc-1',
      localDayKey: '2026-06-15',
      ianaZone: 'Europe/Istanbul',
      nowIso: '2026-06-15T06:10:00.000Z',
      syncedAtIso: '2026-06-15T06:00:00.000Z',
      rawEvents: sampleEvents,
    });

    expect(res).toEqual({
      mode: 'internal_only',
      canWriteExternalCalendar: false,
      stale: false,
      blocks: [],
      droppedCount: sampleEvents.length,
    });
  });

  it('(+) enforces strict read-only boundary with zero external write surface', () => {
    expect(EXTERNAL_CALENDAR_CAPABILITIES).toEqual({
      canReadBusySlots: true,
      canWriteExternalCalendar: false,
      persistsOAuthSecretsInBackup: false,
    });

    const exportedNames = Object.keys(calendarBusyModule);
    const mutationLike = exportedNames.filter((name) =>
      /^(?:create|update|delete|patch|push|write|insert|mutate|syncOut)/i.test(name),
    );
    expect(mutationLike).toEqual([]);
  });

  it('(+) filters cancelled/cross-account/invalid/off-day events and masks private titles by default', () => {
    const res = normalizeExternalBusySlots({
      userId: 'u-1',
      expectedAccountId: 'gcal-acc-1',
      localDayKey: '2026-06-15',
      ianaZone: 'Europe/Istanbul',
      nowIso: '2026-06-15T06:15:00.000Z',
      syncedAtIso: '2026-06-15T06:00:00.000Z',
      ttlMinutes: 30,
      gateEnabled: true,
      rawEvents: sampleEvents,
    });

    expect(res.mode).toBe('external_busy_merged');
    expect(res.canWriteExternalCalendar).toBe(false);
    expect(res.stale).toBe(false);
    expect(res.droppedCount).toBe(4);
    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]).toMatchObject({
      user_id: 'u-1',
      title: MASKED_EXTERNAL_BUSY_TITLE,
      local_day: '2026-06-15',
      start_time: '10:00',
      end_time: '11:30',
      locked: true,
      source: 'external_busy',
    });
    expect(res.blocks[0].id.startsWith('extbusy:')).toBe(true);
    expect(res.blocks[0].title).not.toContain('Terapi');

    // Explicit opt-in unmasked preview keeps title when non-empty
    const unmasked = normalizeExternalBusySlots({
      userId: 'u-1',
      expectedAccountId: 'gcal-acc-1',
      localDayKey: '2026-06-15',
      ianaZone: 'Europe/Istanbul',
      nowIso: '2026-06-15T06:15:00.000Z',
      syncedAtIso: '2026-06-15T06:00:00.000Z',
      gateEnabled: true,
      maskTitles: false,
      rawEvents: sampleEvents,
    });
    expect(unmasked.blocks[0].title).toBe('Özel Terapi Randevusu');
  });

  it('(+) normalizes DST spring-forward intervals and integrates cleanly with deriveRemainingCapacityMinutes', () => {
    // America/New_York springs forward on 2026-03-08: 01:30 EST (06:30Z) -> 03:30 EDT (07:30Z)
    const dstEvents: RawExternalBusyEvent[] = [
      {
        externalEventId: 'dst-1',
        accountId: 'gcal-acc-1',
        calendarId: 'work',
        startIso: '2026-03-08T06:30:00.000Z',
        endIso: '2026-03-08T07:30:00.000Z',
        status: 'tentative',
        recurringMasterId: 'series-weekly',
        title: 'Gece Nöbeti',
      },
      {
        externalEventId: ' afternoon-busy ',
        accountId: 'gcal-acc-1',
        calendarId: 'work',
        startIso: '2026-03-08T18:00:00.000Z', // 14:00 EDT
        endIso: '2026-03-08T20:00:00.000Z', // 16:00 EDT
        status: 'confirmed',
      },
    ];

    const normalized = normalizeExternalBusySlots({
      userId: 'u-1',
      expectedAccountId: 'gcal-acc-1',
      localDayKey: '2026-03-08',
      ianaZone: 'America/New_York',
      nowIso: '2026-03-08T16:40:00.000Z',
      syncedAtIso: '2026-03-08T16:00:00.000Z',
      ttlMinutes: 30,
      gateEnabled: true,
      rawEvents: dstEvents,
    });

    expect(normalized.stale).toBe(true); // 40 min > 30 min TTL
    expect(normalized.blocks).toHaveLength(2);
    expect(normalized.blocks[0]).toMatchObject({
      start_time: '01:30',
      end_time: '03:30',
    });
    expect(normalized.blocks[1]).toMatchObject({
      start_time: '14:00',
      end_time: '16:00',
    });

    const cap = deriveRemainingCapacityMinutes({
      localDayKey: '2026-03-08',
      nowLocalMinutes: 13 * 60, // 13:00..21:00 = 480m raw window, 120m blocked (14:00..16:00)
      fixedBlocks: normalized.blocks,
    });
    expect(cap.externalCalendarConnected).toBe(true);
    expect(cap.fixedBlockedMinutes).toBe(120);
    expect(cap.unblockedWindowMinutes).toBe(360);
  });

  it('(+) revokeExternalCalendarAccess immediately clears cached busy blocks', () => {
    const existingCache: BusyCacheSnapshot = {
      userId: 'u-1',
      accountId: 'gcal-acc-1',
      syncedAtIso: '2026-06-15T06:00:00.000Z',
      ttlMinutes: 30,
      blocks: [
        {
          id: 'extbusy:abc',
          user_id: 'u-1',
          title: MASKED_EXTERNAL_BUSY_TITLE,
          local_day: '2026-06-15',
          start_time: '10:00',
          end_time: '11:00',
          locked: true,
          source: 'external_busy',
        },
      ],
    };

    expect(revokeExternalCalendarAccess(existingCache)).toEqual({
      cleared: true,
      nextCache: null,
    });
    expect(revokeExternalCalendarAccess(null)).toEqual({
      cleared: true,
      nextCache: null,
    });
  });
});

describe('E15 — importPreviewAdapter (dry-run verified vs unverified preview & idempotency)', () => {
  function buildSampleAderythExport(userId: string): string {
    const collectionsData = {
      habits: [
        {
          id: 'hab-101',
          user_id: userId,
          name: 'Sabah Yürüyüşü',
          xp: 999,
          streak_current: 42,
          access_token: 'leaked-token',
        },
      ],
      tasks: [
        {
          id: 'tsk-201',
          user_id: userId,
          title: 'Vergi beyannamesi',
          focus_points: 500,
        },
      ],
      habit_logs: [
        {
          id: 'log-301',
          habit_id: 'hab-101',
          user_id: userId,
          completed_at: '2026-05-10',
          state: 'done',
          total_xp: 1200,
        },
      ],
    };
    const manifest = buildManifest(userId, '2026-06-15T10:00:00.000Z', collectionsData);
    return JSON.stringify({ manifest, ...collectionsData });
  }

  it('(+) separates aderyth_v3 verifiedFields from non-restorable collections, strips authority fields, and proves 2nd import = 0 new rows', () => {
    const rawBackup = buildSampleAderythExport('u-1');
    const first = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'aderyth_v3',
      rawText: rawBackup,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.dryRun).toBe(true);
    expect(first.trustLevel).toBe('manifest_verified');
    expect(first.importedUnverifiedFields).toEqual([]);
    expect(first.verifiedFields).toHaveLength(2);
    expect(first.newRowCount).toBe(2);
    expect(first.skippedDuplicateCount).toBe(0);
    expect(first.strippedAuthorityFields).toEqual([
      'access_token',
      'focus_points',
      'streak_current',
      'total_xp',
      'xp',
    ]);

    for (const vf of first.verifiedFields) {
      expect(vf.trust).toBe('verified_manifest');
      expect(vf.importRowKey.startsWith('imp:')).toBe(true);
      expect(vf.values).not.toHaveProperty('xp');
      expect(vf.values).not.toHaveProperty('focus_points');
      expect(vf.values).not.toHaveProperty('access_token');
    }

    expect(first.skippedNonRestorableCollections).toEqual([
      expect.objectContaining({ collection: 'habit_logs', count: 1 }),
    ]);

    // Second import with existingIds -> 0 duplicate rows!
    const secondByIds = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'aderyth_v3',
      rawText: rawBackup,
      existingIds: new Set(first.importRowKeys),
    });
    expect(secondByIds.ok).toBe(true);
    if (!secondByIds.ok) return;
    expect(secondByIds.newRowCount).toBe(0);
    expect(secondByIds.verifiedFields).toEqual([]);
    expect(secondByIds.skippedDuplicateCount).toBe(2);

    // Second import with existingNaturalKeys -> 0 duplicate rows!
    const secondByNatural = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'aderyth_v3',
      rawText: rawBackup,
      existingNaturalKeys: new Set(first.naturalKeys),
    });
    expect(secondByNatural.ok).toBe(true);
    if (!secondByNatural.ok) return;
    expect(secondByNatural.newRowCount).toBe(0);
    expect(secondByNatural.skippedDuplicateCount).toBe(2);
  });

  it('(+) maps habitify_json and daylio_csv strictly into importedUnverifiedFields and proves 2nd import = 0 duplicates', () => {
    const habitifyPayload = JSON.stringify({
      xp: 9000,
      refresh_token: 'secret-rt',
      habits: [
        {
          name: 'Su İç',
          total_xp: 400,
          logs: [
            { date: '2026-06-01', status: 'completed', note: '2 litre tamam', fp: 25 },
            { date: '2026-06-01', status: 'completed', note: '2 litre tamam' }, // in-file duplicate
            { date: '2026-06-02', status: 'skipped', note: 'Yolculuk günü' },
          ],
        },
      ],
    });

    const habFirst = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'habitify_json',
      rawText: habitifyPayload,
    });
    expect(habFirst.ok).toBe(true);
    if (!habFirst.ok) return;

    expect(habFirst.trustLevel).toBe('external_unverified');
    expect(habFirst.verifiedFields).toEqual([]);
    expect(habFirst.importedUnverifiedFields).toHaveLength(2);
    expect(habFirst.newRowCount).toBe(2);
    expect(habFirst.skippedDuplicateCount).toBe(1); // 1 in-file duplicate skipped
    expect(habFirst.strippedAuthorityFields).toEqual(['fp', 'refresh_token', 'total_xp', 'xp']);
    expect(habFirst.importedUnverifiedFields[0]).toMatchObject({
      sourceFormat: 'habitify_json',
      habitName: 'Su İç',
      localDate: '2026-06-01',
      completionState: 'done',
      note: '2 litre tamam',
      trust: 'imported_unverified',
      requiresManualReview: true,
    });

    const habSecond = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'habitify_json',
      rawText: habitifyPayload,
      existingIds: new Set(habFirst.importRowKeys),
    });
    expect(habSecond.ok).toBe(true);
    if (!habSecond.ok) return;
    expect(habSecond.newRowCount).toBe(0);
    expect(habSecond.skippedDuplicateCount).toBe(3);

    const daylioCsv = [
      'full_date,date,weekday,time,mood,activities,note_title,note,xp',
      '2026-06-10,10 Haziran,Çarşamba,21:15,good,"yürüyüş | okuma",Akşam,"Sakin geçti",100',
      '2026-06-11,11 Haziran,Perşembe,22:00,meh,"okuma",,"Kısa not",50',
    ].join('\n');

    const daylioFirst = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'daylio_csv',
      rawText: daylioCsv,
    });
    expect(daylioFirst.ok).toBe(true);
    if (!daylioFirst.ok) return;

    expect(daylioFirst.verifiedFields).toEqual([]);
    expect(daylioFirst.importedUnverifiedFields).toHaveLength(2);
    expect(daylioFirst.strippedAuthorityFields).toEqual(['xp']);
    expect(daylioFirst.importedUnverifiedFields[0]).toMatchObject({
      sourceFormat: 'daylio_csv',
      localDate: '2026-06-10',
      moodLabel: 'good',
      moodScore: 4,
      activities: ['yürüyüş', 'okuma'],
      note: 'Akşam: Sakin geçti',
      trust: 'imported_unverified',
      requiresManualReview: true,
    });

    const daylioSecond = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'daylio_csv',
      rawText: daylioCsv,
      existingNaturalKeys: new Set(daylioFirst.naturalKeys),
    });
    expect(daylioSecond.ok).toBe(true);
    if (!daylioSecond.ok) return;
    expect(daylioSecond.newRowCount).toBe(0);
    expect(daylioSecond.skippedDuplicateCount).toBe(2);
  });

  it('(-) refuses cross-account, tampered checksum, truncated JSON/CSV, oversized text, and biometric payloads', () => {
    const validAderyth = buildSampleAderythExport('u-1');

    // Cross-account targetUserId
    const crossTarget = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      targetUserId: 'u-2',
      format: 'habitify_json',
      rawText: '{"habits":[]}',
    });
    expect(crossTarget).toMatchObject({ ok: false, errorCode: 'cross_account' });

    // Cross-account manifest user_id
    const crossManifest = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-other',
      format: 'aderyth_v3',
      rawText: validAderyth,
    });
    expect(crossManifest).toMatchObject({ ok: false, errorCode: 'cross_account' });

    // Corrupt / tampered Aderyth backup checksum
    const tampered = validAderyth.replace('Sabah Yürüyüşü', 'Gece Koşusu');
    const corruptCheck = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'aderyth_v3',
      rawText: tampered,
    });
    expect(corruptCheck).toMatchObject({ ok: false, errorCode: 'malformed' });

    // Truncated Habitify JSON
    const truncatedJson = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'habitify_json',
      rawText: '{"habits":[{"name":"Meditasyon","date":"2026-06-01"',
    });
    expect(truncatedJson).toMatchObject({ ok: false, errorCode: 'truncated' });

    // Truncated Daylio CSV (unclosed quote)
    const truncatedCsv = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'daylio_csv',
      rawText: 'full_date,mood,note\n2026-06-01,good,"yarıda kesilen not',
    });
    expect(truncatedCsv).toMatchObject({ ok: false, errorCode: 'truncated' });

    // Oversized external input
    const oversized = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'habitify_json',
      rawText: 'x'.repeat(MAX_EXTERNAL_IMPORT_CHARS + 1),
    });
    expect(oversized).toMatchObject({ ok: false, errorCode: 'oversized' });

    // Biometric / health payload rejected (I2)
    const biometric = previewExternalHabitCsvOrJson({
      signedInUserId: 'u-1',
      format: 'habitify_json',
      rawText: JSON.stringify({ heart_rate: 72, hrv: 55, habits: [] }),
    });
    expect(biometric).toMatchObject({ ok: false, errorCode: 'unsupported_biometric' });
  });
});

describe('U13 — buildCalmEffortSummary & AchievementsScreen calm effort card', () => {
  it('(+) counts preserved completions and calm returns after miss/skip gaps while keeping prior achievements intact', () => {
    const summary = buildCalmEffortSummary({
      logs: [
        { habit_id: 'h-1', completed_at: '2026-05-01', state: 'done' },
        { habit_id: 'h-1', completed_at: '2026-05-02', state: 'miss' },
        { habit_id: 'h-1', completed_at: '2026-05-03', state: 'skip' },
        { habit_id: 'h-1', completed_at: '2026-05-04', state: 'done' }, // return #1
        { habit_id: 'h-1', completed_at: '2026-05-05', state: 'partial' }, // continuation
        { habit_id: 'h-1', completed_at: '2026-05-06', state: 'miss' },
        { habit_id: 'h-1', completed_at: '2026-05-07', state: 'partial' }, // return #2
      ],
      completedTasksCount: 6,
      focusSessionsCount: 3,
    });

    expect(summary.preservedHabitCompletions).toBe(4);
    expect(summary.doneHabitCount).toBe(2);
    expect(summary.partialHabitCount).toBe(2);
    expect(summary.calmReturnCount).toBe(2);
    expect(summary.calmReturnDays).toEqual(['2026-05-04', '2026-05-07']);
    expect(summary.skippedOrLightenedCount).toBe(1);
    expect(summary.totalSustainedEffortCount).toBe(13);
    expect(summary.priorAchievementsIntact).toBe(true);
  });

  it('(+) renders achievements-calm-effort-card on AchievementsScreen without erasing unlocked badges', () => {
    const screen = renderWithProviders(React.createElement(AchievementsScreen));
    const card = screen.getByTestId('achievements-calm-effort-card');
    expect(card).toBeTruthy();

    const scoped = within(card);
    expect(scoped.getByText('Sürdürülen Çaba & Sakin Dönüş')).toBeTruthy();
    expect(scoped.getByText('3 korunan adım')).toBeTruthy();
    expect(scoped.getByText('1 sakin dönüş')).toBeTruthy();
    expect(scoped.getByText('1 görev · 1 odak')).toBeTruthy();

    // Existing achievements header & unlocked vitrine item stay intact despite miss log
    expect(screen.getByText('Başarım & Rozetler')).toBeTruthy();
    expect(screen.getByText('İlk Adım')).toBeTruthy();
    screen.unmount();
  });
});

describe('U15 — evaluateCalmReturnHint (single-step return, quiet hours, dismissal)', () => {
  const overdueTasks = [
    { id: 't-heavy', title: 'Büyük sunum taslağı', estimatedMinutes: 60 },
    { id: 't-quick', title: 'Faturayı öde', estimatedMinutes: 5 },
  ];
  const missedHabits = [
    { id: 'h-walk', name: 'Akşam yürüyüşü' },
    { id: 'h-read', name: '10 sayfa kitap' },
  ];

  it('(-) stays hidden when total overdue + missed count is below 3', () => {
    const res = evaluateCalmReturnHint({
      localDayKey: '2026-06-15',
      nowLocalHm: '10:30',
      overdueTasks: [overdueTasks[0]],
      missedHabits: [missedHabits[0]],
    });
    expect(res.visible).toBe(false);
    if (res.visible) return;
    expect(res.isMultiOverdueBacklog).toBe(false);
    expect(res.suppressedReason).toBe('below_threshold');
  });

  it('(+) collapses multi-overdue backlog (>= 3) into 1 calm step and respects quiet hours & dismissal', () => {
    const active = evaluateCalmReturnHint({
      localDayKey: '2026-06-15',
      nowLocalHm: '11:00',
      overdueTasks,
      missedHabits,
      quietStart: '22:00',
      quietEnd: '07:30',
    });

    expect(active.visible).toBe(true);
    if (!active.visible) return;
    expect(active.isMultiOverdueBacklog).toBe(true);
    expect(active.totalBacklogCount).toBe(4);
    expect(active.collapsedItemCount).toBe(3);
    expect(active.stepCount).toBe(1);
    expect(active.target).toBe('first_action');
    expect(active.focusItemId).toBe('t-quick'); // shortest calm task picked
    expect(active.ctaLabel).toContain('Faturayı öde');

    // Quiet hours suppression (23:15 inside 22:00..07:30)
    const duringQuiet = evaluateCalmReturnHint({
      localDayKey: '2026-06-15',
      nowLocalHm: '23:15',
      overdueTasks,
      missedHabits,
      quietStart: '22:00',
      quietEnd: '07:30',
    });
    expect(duringQuiet.visible).toBe(false);
    if (duringQuiet.visible) return;
    expect(duringQuiet.isMultiOverdueBacklog).toBe(true);
    expect(duringQuiet.suppressedReason).toBe('quiet_hours');

    // User dismissal honored
    const afterDismiss = evaluateCalmReturnHint({
      localDayKey: '2026-06-15',
      nowLocalHm: '14:00',
      overdueTasks,
      missedHabits,
      dismissedKeys: new Set([active.dismissKey]),
    });
    expect(afterDismiss.visible).toBe(false);
    if (afterDismiss.visible) return;
    expect(afterDismiss.suppressedReason).toBe('dismissed');

    // Recovery target when backlog consists of missed habits only
    const habitBacklog = evaluateCalmReturnHint({
      localDayKey: '2026-06-16',
      nowLocalHm: '10:00',
      overdueTasks: [],
      missedHabits: [
        ...missedHabits,
        { id: 'h-stretch', name: 'Esneme' },
      ],
    });
    expect(habitBacklog.visible).toBe(true);
    if (!habitBacklog.visible) return;
    expect(habitBacklog.target).toBe('recovery');
    expect(habitBacklog.stepCount).toBe(1);
  });
});

describe('P05 — evaluateDurationCalibration & resetCalibration (sample-gated & multi-day guard)', () => {
  it('(-) refuses to infer when disabled, when samples < 5, or when all samples come from a single bad day', () => {
    expect(MIN_CALIBRATION_SAMPLES).toBe(5);

    const disabled = evaluateDurationCalibration({
      optInEnabled: false,
      samples: Array.from({ length: 6 }, (_, idx) => ({
        taskId: `t-${idx}`,
        estimatedMinutes: 20,
        actualFocusedMinutes: 35,
        localDayKey: idx < 3 ? '2026-06-10' : '2026-06-11',
      })),
    });
    expect(disabled).toMatchObject({
      status: 'disabled',
      suggestedMultiplier: 1,
      suggestedMinutes: null,
      canReset: true,
    });

    const tooFew = evaluateDurationCalibration({
      optInEnabled: true,
      samples: [
        { taskId: 't-1', estimatedMinutes: 20, actualFocusedMinutes: 30, localDayKey: '2026-06-10' },
        { taskId: 't-2', estimatedMinutes: 20, actualFocusedMinutes: 30, localDayKey: '2026-06-11' },
        { taskId: 't-3', estimatedMinutes: 20, actualFocusedMinutes: 30, localDayKey: '2026-06-12' },
        { taskId: 't-4', estimatedMinutes: 20, actualFocusedMinutes: 30, localDayKey: '2026-06-13' },
      ],
    });
    expect(tooFew).toMatchObject({
      status: 'insufficient_sample',
      reason: 'too_few_samples',
      suggestedMultiplier: 1,
      suggestedMinutes: null,
      canReset: true,
    });

    // 6 heavy overruns all on ONE bad day -> must NOT build a permanent profile!
    const singleBadDay = evaluateDurationCalibration({
      optInEnabled: true,
      samples: Array.from({ length: 6 }, (_, idx) => ({
        taskId: `bad-${idx}`,
        estimatedMinutes: 20,
        actualFocusedMinutes: 55,
        localDayKey: '2026-06-10',
      })),
    });
    expect(singleBadDay).toMatchObject({
      status: 'insufficient_sample',
      reason: 'single_day_only',
      uniqueDayCount: 1,
      suggestedMultiplier: 1,
      suggestedMinutes: null,
      canReset: true,
    });
  });

  it('(+) computes bounded median ratio across >= 5 samples and >= 2 days, and resets cleanly', () => {
    const calibrated = evaluateDurationCalibration({
      optInEnabled: true,
      referenceEstimateMinutes: 30,
      samples: [
        { taskId: 't-1', estimatedMinutes: 20, actualFocusedMinutes: 30, localDayKey: '2026-06-10' }, // 1.5
        { taskId: 't-2', estimatedMinutes: 20, actualFocusedMinutes: 28, localDayKey: '2026-06-10' }, // 1.4
        { taskId: 't-3', estimatedMinutes: 30, actualFocusedMinutes: 45, localDayKey: '2026-06-11' }, // 1.5
        { taskId: 't-4', estimatedMinutes: 25, actualFocusedMinutes: 40, localDayKey: '2026-06-12' }, // 1.6
        { taskId: 't-5', estimatedMinutes: 10, actualFocusedMinutes: 50, localDayKey: '2026-06-12' }, // 5.0 outlier
      ],
    });

    expect(calibrated).toMatchObject({
      status: 'calibrated',
      reason: null,
      sampleCount: 5,
      uniqueDayCount: 3,
      suggestedMultiplier: 1.5,
      suggestedMinutes: 45,
      canReset: true,
    });

    // Upper clamp (2.0) and lower clamp (0.5)
    const upperClamped = evaluateDurationCalibration({
      optInEnabled: true,
      samples: Array.from({ length: 5 }, (_, idx) => ({
        taskId: `hi-${idx}`,
        estimatedMinutes: 10,
        actualFocusedMinutes: 40,
        localDayKey: idx % 2 === 0 ? '2026-06-10' : '2026-06-11',
      })),
    });
    expect(upperClamped.suggestedMultiplier).toBe(CALIBRATION_MULTIPLIER_MAX);

    const lowerClamped = evaluateDurationCalibration({
      optInEnabled: true,
      samples: Array.from({ length: 5 }, (_, idx) => ({
        taskId: `lo-${idx}`,
        estimatedMinutes: 40,
        actualFocusedMinutes: 5,
        localDayKey: idx % 2 === 0 ? '2026-06-10' : '2026-06-11',
      })),
    });
    expect(lowerClamped.suggestedMultiplier).toBe(CALIBRATION_MULTIPLIER_MIN);

    // Clean reset
    const cleared = resetCalibration();
    expect(cleared).toMatchObject({
      optInEnabled: false,
      samples: [],
      status: 'disabled',
      suggestedMultiplier: 1,
      suggestedMinutes: null,
      canReset: true,
    });
  });
});
