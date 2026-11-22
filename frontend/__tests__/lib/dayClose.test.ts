import AsyncStorage from '@react-native-async-storage/async-storage';
import { endAccountScope, registeredAccountStorage } from '../../lib/accountScope';
import {
  CLOSE_LIST_LIMIT,
  closingDayFor,
  DAY_CLOSE_COPY,
  DAY_ROLLOVER_HOUR,
  dayAfter,
  dayCloseEchoLine,
  dayCloseKey,
  dueDayOf,
  isDayClosedOn,
  loadDayClose,
  MAX_RECORD_COUNT,
  mergeDayClose,
  movePatch,
  parseDayClose,
  saveDayClose,
  selectCloseCandidates,
  undoPatch,
  visibleCandidates,
  type CloseTaskLike,
  type DayCloseRecord,
} from '../../lib/dayClose';

jest.mock('../../lib/notifications', () => ({
  listScheduled: async () => [],
  cancelScheduled: async () => undefined,
}));

const makeTask = (
  id: string,
  overrides: Partial<CloseTaskLike> = {},
): CloseTaskLike => ({
  id,
  title: `Görev ${id}`,
  priority: 'none',
  due_date: '2026-11-02',
  created_at: '2026-11-01T10:00:00Z',
  completed: false,
  status: 'pending',
  ...overrides,
});

describe('F29 — lib/dayClose pure rules & account-scoped storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  describe('closingDayFor (04:00 local rollover)', () => {
    it('(+) returns same calendar day at or after 04:00 and previous day between 00:00 and 03:59', () => {
      expect(DAY_ROLLOVER_HOUR).toBe(4);
      expect(closingDayFor(new Date(2026, 10, 2, 22, 30))).toBe('2026-11-02');
      expect(closingDayFor(new Date(2026, 10, 2, 4, 0))).toBe('2026-11-02');
      expect(closingDayFor(new Date(2026, 10, 2, 0, 30))).toBe('2026-11-01');
      expect(closingDayFor(new Date(2026, 10, 2, 3, 59))).toBe('2026-11-01');
      expect(closingDayFor(new Date(2027, 0, 1, 1, 0))).toBe('2026-12-31');
    });
  });

  describe('dayAfter & dueDayOf', () => {
    it('(+) advances across month, year, and leap-day boundaries', () => {
      expect(dayAfter('2026-11-30')).toBe('2026-12-01');
      expect(dayAfter('2026-12-31')).toBe('2027-01-01');
      expect(dayAfter('2028-02-28')).toBe('2028-02-29');
      expect(dayAfter('2028-02-29')).toBe('2028-03-01');
    });

    it('(-) returns malformed dayAfter input unchanged without throwing', () => {
      expect(dayAfter('2026-13-40')).toBe('2026-13-40');
      expect(dayAfter('2026-02-30')).toBe('2026-02-30');
      expect(dayAfter('')).toBe('');
    });

    it('(+) extracts valid YYYY-MM-DD prefix from plain date or timestamptz and rejects invalid dates', () => {
      expect(dueDayOf('2026-11-02')).toBe('2026-11-02');
      expect(dueDayOf('2026-11-02T00:00:00+00:00')).toBe('2026-11-02');
      expect(dueDayOf(null)).toBe('');
      expect(dueDayOf(undefined)).toBe('');
      expect(dueDayOf('')).toBe('');
      expect(dueDayOf('2026-13-40')).toBe('');
      expect(dueDayOf('2026-02-30T10:00:00Z')).toBe('');
      expect(dueDayOf('bozuk')).toBe('');
    });
  });

  describe('selectCloseCandidates & visibleCandidates', () => {
    it('(+) selects open tasks due <= closingDay (including timestamptz), sorted by priority, due day, created_at without mutating input', () => {
      const input: readonly CloseTaskLike[] = Object.freeze([
        makeTask('none-later', { priority: 'none', due_date: '2026-11-02', created_at: '2026-11-01T12:00:00Z' }),
        makeTask('med-today-2', { priority: 'medium', due_date: '2026-11-02T00:00:00+00:00', created_at: '2026-11-01T15:00:00Z' }),
        makeTask('high-today', { priority: 'high', due_date: '2026-11-02', created_at: '2026-11-01T09:00:00Z' }),
        makeTask('high-overdue', { priority: 'high', due_date: '2026-10-30', created_at: '2026-10-29T09:00:00Z' }),
        makeTask('med-today-1', { priority: 'medium', due_date: '2026-11-02', created_at: '2026-11-01T08:00:00Z' }),
        makeTask('low-overdue', { priority: 'low', due_date: '2026-11-01', created_at: '2026-10-31T08:00:00Z' }),
      ]);

      const snapshot = [...input];
      const out = selectCloseCandidates(input, '2026-11-02');
      expect(out.map((t) => t.id)).toEqual([
        'high-overdue',
        'high-today',
        'med-today-1',
        'med-today-2',
        'low-overdue',
        'none-later',
      ]);
      expect(input).toEqual(snapshot);
    });

    it('(-) excludes tomorrow/future, undated, completed, and cancelled tasks', () => {
      const input: CloseTaskLike[] = [
        makeTask('tomorrow', { due_date: '2026-11-03' }),
        makeTask('future', { due_date: '2026-12-15' }),
        makeTask('undated-null', { due_date: null }),
        makeTask('undated-undef', { due_date: undefined }),
        makeTask('done', { due_date: '2026-11-02', completed: true }),
        makeTask('cancelled', { due_date: '2026-11-01', status: 'cancelled' }),
        makeTask('valid', { due_date: '2026-11-02' }),
      ];

      expect(selectCloseCandidates(input, '2026-11-02').map((t) => t.id)).toEqual(['valid']);
    });

    it('(+) caps visibleCandidates at CLOSE_LIST_LIMIT (5) and handles 0 or negative limits safely', () => {
      expect(CLOSE_LIST_LIMIT).toBe(5);
      const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      expect(visibleCandidates(seven)).toEqual({ rows: ['a', 'b', 'c', 'd', 'e'], hasMore: true });
      expect(visibleCandidates(seven.slice(0, 5))).toEqual({ rows: ['a', 'b', 'c', 'd', 'e'], hasMore: false });
      expect(visibleCandidates([])).toEqual({ rows: [], hasMore: false });

      expect(visibleCandidates(['a', 'b'], 0)).toEqual({ rows: [], hasMore: true });
      expect(visibleCandidates([], 0)).toEqual({ rows: [], hasMore: false });
      expect(visibleCandidates(['a', 'b', 'c'], -2)).toEqual({ rows: [], hasMore: true });
    });
  });

  describe('movePatch & undoPatch', () => {
    it('(+) produces exact tomorrow and release patches without deleting or completing', () => {
      const tom = movePatch('tomorrow', '2026-11-03');
      expect(tom).toEqual({ due_date: '2026-11-03' });
      expect('list_type' in tom).toBe(false);
      expect('status' in tom).toBe(false);
      expect('completed' in tom).toBe(false);

      const rel = movePatch('release', '2026-11-03');
      expect(rel).toEqual({ list_type: 'someday', due_date: null });
      expect('status' in rel).toBe(false);
      expect('completed' in rel).toBe(false);

      const prev = Object.freeze({ due_date: '2026-11-02', list_type: 'this_week' as const });
      const undone = undoPatch(prev);
      expect(undone).toEqual({ due_date: '2026-11-02', list_type: 'this_week' });
      expect(undone).not.toBe(prev);
    });
  });

  describe('parseDayClose & mergeDayClose', () => {
    it('(+) parses valid v1 records up to MAX_RECORD_COUNT and (-) rejects corrupt or out-of-range inputs', () => {
      expect(MAX_RECORD_COUNT).toBe(999);
      const valid: DayCloseRecord = {
        v: 1,
        date: '2026-11-02',
        movedCount: 999,
        easedCount: 3,
        closedAt: '2026-11-02T21:30:00.000Z',
      };
      expect(parseDayClose(JSON.stringify(valid))).toEqual(valid);

      expect(parseDayClose(null)).toBeNull();
      expect(parseDayClose('')).toBeNull();
      expect(parseDayClose('{bozuk')).toBeNull();
      expect(parseDayClose('[]')).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, v: 2 }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, date: '2026-13-40' }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, date: '2026-02-30' }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, movedCount: -1 }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, movedCount: 1.5 }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, movedCount: 1000 }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, easedCount: 1000 }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, easedCount: -1 }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, closedAt: '' }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ ...valid, closedAt: 'not-a-timestamp' }))).toBeNull();
      expect(parseDayClose(JSON.stringify({ v: 1, date: '2026-11-02', movedCount: 1 }))).toBeNull();
    });

    it('(+) merges same-day movedCount (capped at 999) with latest easedCount, replaces on new day, and never mutates inputs', () => {
      const prev: DayCloseRecord = Object.freeze({
        v: 1,
        date: '2026-11-02',
        movedCount: 2,
        easedCount: 1,
        closedAt: '2026-11-02T20:00:00.000Z',
      });
      const nextSame = Object.freeze({
        date: '2026-11-02',
        movedCount: 3,
        easedCount: 4,
        closedAt: '2026-11-02T22:00:00.000Z',
      });
      expect(mergeDayClose(prev, nextSame)).toEqual({
        v: 1,
        date: '2026-11-02',
        movedCount: 5,
        easedCount: 4,
        closedAt: '2026-11-02T22:00:00.000Z',
      });

      const nearCap: DayCloseRecord = { ...prev, movedCount: 998 };
      expect(mergeDayClose(nearCap, { ...nextSame, movedCount: 5 }).movedCount).toBe(999);

      const nextDay = Object.freeze({
        date: '2026-11-03',
        movedCount: 1,
        easedCount: 0,
        closedAt: '2026-11-03T21:00:00.000Z',
      });
      expect(mergeDayClose(prev, nextDay)).toEqual({
        v: 1,
        ...nextDay,
      });
      expect(mergeDayClose(null, nextDay)).toEqual({
        v: 1,
        ...nextDay,
      });
    });
  });

  describe('dayCloseEchoLine', () => {
    const recFor = (date: string, movedCount: number): DayCloseRecord => ({
      v: 1,
      date,
      movedCount,
      easedCount: 0,
      closedAt: '2026-11-02T22:00:00.000Z',
    });

    it('(+) renders calm Turkish word-only copy for yesterday across n=0, 1, 2..10, 11+ and respects 00:30 night-owl close', () => {
      const morning = new Date(2026, 10, 3, 8, 30); // 2026-11-03 08:30
      expect(dayCloseEchoLine(recFor('2026-11-02', 0), morning)).toBe('Dün günü kapattın.');
      expect(dayCloseEchoLine(recFor('2026-11-02', 1), morning)).toBe(
        'Dün günü kapattın; bir işi bugüne taşıdın.',
      );
      expect(dayCloseEchoLine(recFor('2026-11-02', 2), morning)).toBe(
        'Dün günü kapattın; iki işi bugüne taşıdın.',
      );
      expect(dayCloseEchoLine(recFor('2026-11-02', 10), morning)).toBe(
        'Dün günü kapattın; on işi bugüne taşıdın.',
      );
      expect(dayCloseEchoLine(recFor('2026-11-02', 11), morning)).toBe(
        'Dün günü kapattın; işlerini bugüne taşıdın.',
      );

      // Closed at 2026-11-03 00:30 -> closingDayFor is 2026-11-02; hidden at 02:00, shown at 08:30
      const closedNightOwl = closingDayFor(new Date(2026, 10, 3, 0, 30));
      expect(closedNightOwl).toBe('2026-11-02');
      expect(dayCloseEchoLine(recFor(closedNightOwl, 2), new Date(2026, 10, 3, 2, 0))).toBeNull();
      expect(dayCloseEchoLine(recFor(closedNightOwl, 2), morning)).toBe(
        'Dün günü kapattın; iki işi bugüne taşıdın.',
      );
    });

    it('(-) returns null for null, same-day close, or >= 2 days ago, and never emits digits for n=0..50', () => {
      const morning = new Date(2026, 10, 3, 9, 0);
      expect(dayCloseEchoLine(null, morning)).toBeNull();
      expect(dayCloseEchoLine(recFor('2026-11-03', 2), new Date(2026, 10, 3, 21, 0))).toBeNull();
      expect(dayCloseEchoLine(recFor('2026-11-01', 2), morning)).toBeNull();

      for (let n = 0; n <= 50; n += 1) {
        const line = dayCloseEchoLine(recFor('2026-11-02', n), morning);
        expect(line).not.toBeNull();
        expect(line).not.toMatch(/\d/);
      }
    });
  });

  describe('storage, user isolation, isDayClosedOn & accountScope registration', () => {
    const sample: DayCloseRecord = {
      v: 1,
      date: '2026-11-02',
      movedCount: 2,
      easedCount: 1,
      closedAt: '2026-11-02T21:15:00.000Z',
    };

    it('(+) saves and loads under exact aderyth:day_close:v1:<uid> key and isolates accounts', async () => {
      expect(dayCloseKey('u1')).toBe('aderyth:day_close:v1:u1');
      expect(await saveDayClose('u1', sample)).toBe(true);
      expect(await AsyncStorage.getItem('aderyth:day_close:v1:u1')).not.toBeNull();
      expect(await loadDayClose('u1')).toEqual(sample);
      expect(await loadDayClose('u2')).toBeNull();

      expect(await isDayClosedOn('u1', '2026-11-02')).toBe(true);
      expect(await isDayClosedOn('u1', '2026-11-03')).toBe(false);
      expect(await isDayClosedOn('u2', '2026-11-02')).toBe(false);
    });

    it('(-) handles corrupt blobs and AsyncStorage write failures without throwing', async () => {
      await AsyncStorage.setItem(dayCloseKey('u1'), 'not-json');
      expect(await loadDayClose('u1')).toBeNull();
      expect(await isDayClosedOn('u1', '2026-11-02')).toBe(false);

      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
      expect(await saveDayClose('u1', sample)).toBe(false);
    });

    it('(+) registers dayClose in accountScope with transient: false (kept on sign-out, wiped on account_deleted)', async () => {
      expect(registeredAccountStorage()).toContain('dayClose');

      await saveDayClose('u1', sample);
      await endAccountScope('signed_out', 'u1');
      expect(await loadDayClose('u1')).toEqual(sample);

      await endAccountScope('account_deleted', 'u1');
      expect(await loadDayClose('u1')).toBeNull();
      expect(await AsyncStorage.getItem('aderyth:day_close:v1:u1')).toBeNull();
    });
  });

  describe('DAY_CLOSE_COPY calm-tech tone invariants', () => {
    it('(+) contains zero digits, percent signs, exclamation marks, or guilt words', () => {
      const values = Object.values(DAY_CLOSE_COPY);
      expect(values.length).toBeGreaterThanOrEqual(10);
      for (const text of values) {
        expect(text).not.toMatch(/\d/);
        expect(text).not.toContain('%');
        expect(text).not.toContain('!');
        expect(text).not.toMatch(/(başarısız|kaçırdın|geciktin|gecikmiş|yetişemedin|ceza)/i);
      }
    });
  });
});
