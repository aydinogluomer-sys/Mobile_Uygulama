// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import * as SQLite from 'expo-sqlite';
import { endAccountScope, registeredAccountScopes } from '../../lib/accountScope';
import type { InsightPeriod } from '../../lib/journalStats';

const mockFetchJournalInsight = jest.fn();
const mockUpsertJournalInsight = jest.fn();

jest.mock('../../repositories/journalInsightRepository', () => ({
  fetchJournalInsight: (...args: unknown[]) => mockFetchJournalInsight(...args),
  upsertJournalInsight: (...args: unknown[]) => mockUpsertJournalInsight(...args),
}));

import { useInsightsStore, type JournalInsight } from '../../store/insightsStore';

function makeInsight(
  period: InsightPeriod,
  periodKey: string,
  overrides: Partial<JournalInsight> = {},
): JournalInsight {
  return {
    id: `ins-${period}-${periodKey}`,
    user_id: 'u1',
    period,
    period_key: periodKey,
    content: `${period} içgörüsü`,
    entry_count: 4,
    created_at: '2026-11-24T09:00:00.000Z',
    updated_at: '2026-11-24T09:00:00.000Z',
    ...overrides,
  };
}

describe('insightsStore', () => {
  beforeEach(async () => {
    await endAccountScope('signed_out', null);
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  });

  it('fetchInsight caches rows under `${period}:${key}` and ignores null or failed responses', async () => {
    const weekly = makeInsight('weekly', '2026-11-23', { content: 'Haftalık özet' });
    const monthly = makeInsight('monthly', '2026-11', { content: 'Aylık özet' });

    mockFetchJournalInsight
      .mockResolvedValueOnce({ ok: true, data: weekly })
      .mockResolvedValueOnce({ ok: true, data: monthly });

    await useInsightsStore.getState().fetchInsight('weekly', '2026-11-23');
    await useInsightsStore.getState().fetchInsight('monthly', '2026-11');

    expect(mockFetchJournalInsight).toHaveBeenNthCalledWith(1, 'weekly', '2026-11-23');
    expect(mockFetchJournalInsight).toHaveBeenNthCalledWith(2, 'monthly', '2026-11');
    expect(useInsightsStore.getState().cache).toEqual({
      'weekly:2026-11-23': weekly,
      'monthly:2026-11': monthly,
    });
    expect(useInsightsStore.getState().get('weekly', '2026-11-23')).toEqual(weekly);
    expect(useInsightsStore.getState().get('yearly', '2026')).toBeUndefined();

    // Failed repository call and null data leave existing cache intact
    mockFetchJournalInsight
      .mockResolvedValueOnce({ ok: false, error: 'network timeout' })
      .mockResolvedValueOnce({ ok: true, data: null });

    await useInsightsStore.getState().fetchInsight('weekly', '2026-11-23');
    await useInsightsStore.getState().fetchInsight('yearly', '2026');

    expect(useInsightsStore.getState().cache).toEqual({
      'weekly:2026-11-23': weekly,
      'monthly:2026-11': monthly,
    });
  });

  it('saveInsight updates `${period}:${key}` cache on ok: true and ignores failed upserts', async () => {
    const saved = makeInsight('monthly', '2026-11', {
      content: 'Yeni aylık sentez',
      entry_count: 12,
    });
    mockUpsertJournalInsight.mockResolvedValueOnce({ ok: true, data: saved });

    await useInsightsStore.getState().saveInsight('monthly', '2026-11', 'Yeni aylık sentez', 12);

    expect(mockUpsertJournalInsight).toHaveBeenCalledWith({
      period: 'monthly',
      key: '2026-11',
      content: 'Yeni aylık sentez',
      entryCount: 12,
    });
    expect(useInsightsStore.getState().get('monthly', '2026-11')).toEqual(saved);

    // Failed save does not overwrite or corrupt cache
    mockUpsertJournalInsight.mockResolvedValue({ ok: false, error: 'RLS denied' });
    await useInsightsStore.getState().saveInsight('monthly', '2026-11', 'Bozuk içerik', 99);
    await useInsightsStore.getState().saveInsight('yearly', '2026', 'Yıllık', 30);

    expect(useInsightsStore.getState().cache).toEqual({
      'monthly:2026-11': saved,
    });
  });

  it('registers with accountScope and resets cache to {} on endAccountScope("signed_out", "u1")', async () => {
    expect(registeredAccountScopes()).toContain('insights');

    const weekly = makeInsight('weekly', '2026-11-23');
    mockFetchJournalInsight.mockResolvedValueOnce({ ok: true, data: weekly });
    await useInsightsStore.getState().fetchInsight('weekly', '2026-11-23');
    expect(useInsightsStore.getState().get('weekly', '2026-11-23')).toEqual(weekly);

    await endAccountScope('signed_out', 'u1');

    expect(useInsightsStore.getState().cache).toEqual({});
    expect(useInsightsStore.getState().get('weekly', '2026-11-23')).toBeUndefined();
  });
});
