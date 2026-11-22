/**
 * F15 (REP-10 / INT-25): Focus session date-window queries use half-open
 * local-day UTC boundaries (`[startIso, endExclusiveIso)`) on the server
 * instead of UTC date strings or `T23:59:59` lexical comparisons.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

type CapturedFilter = { op: 'eq' | 'gte' | 'lt' | 'lte'; col: string; val: unknown };

const mockState = {
  rows: [] as Record<string, unknown>[],
  captured: [] as CapturedFilter[],
  user: { id: 'u-f15' } as { id: string } | null,
};

jest.mock('../../lib/supabase', () => {
  function select() {
    const filters: CapturedFilter[] = [];
    let sliceRange: [number, number] | null = null;
    const q: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        filters.push({ op: 'eq', col, val });
        return q;
      },
      gte(col: string, val: unknown) {
        filters.push({ op: 'gte', col, val });
        return q;
      },
      lt(col: string, val: unknown) {
        filters.push({ op: 'lt', col, val });
        return q;
      },
      lte(col: string, val: unknown) {
        filters.push({ op: 'lte', col, val });
        return q;
      },
      order() {
        return q;
      },
      range(from: number, to: number) {
        sliceRange = [from, to];
        return q;
      },
      then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
        mockState.captured = [...filters];
        const matched = mockState.rows.filter((row) => {
          for (const f of filters) {
            const cell = row[f.col];
            if (f.op === 'eq' && cell !== f.val) return false;
            if (f.op === 'gte' && !(Date.parse(String(cell)) >= Date.parse(String(f.val)))) return false;
            if (f.op === 'lt' && !(Date.parse(String(cell)) < Date.parse(String(f.val)))) return false;
            if (f.op === 'lte' && !(Date.parse(String(cell)) <= Date.parse(String(f.val)))) return false;
          }
          return true;
        });
        const data = sliceRange ? matched.slice(sliceRange[0], sliceRange[1] + 1) : matched;
        return Promise.resolve({ data, error: null }).then(onOk, onErr);
      },
    };
    return q;
  }

  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: {
            session: mockState.user ? { user: mockState.user, access_token: 'tok' } : null,
          },
          error: null,
        }),
      },
      from: () => ({ select }),
    },
  };
});

import { localDayStartIso } from '../../lib/date';
import { fetchFocusSessionsBetween } from '../../repositories/focusSessionRepository';

const ROOT = join(__dirname, '..', '..');
const TEST_ZONE = process.env.TEST_TZ || 'Europe/Istanbul';
const IS_ISTANBUL = TEST_ZONE === 'Europe/Istanbul';
const describeIstanbul: typeof describe = IS_ISTANBUL ? describe : describe.skip;

function readCode(relPath: string): string {
  return stripComments(readFileSync(join(ROOT, relPath), 'utf8'));
}

beforeEach(() => {
  mockState.rows = [];
  mockState.captured = [];
  mockState.user = { id: 'u-f15' };
});

describe('F15 focusWindowsLocalDay — static source invariants', () => {
  it('(+) focusSessionRepository defines fetchFocusSessionsBetween with .gte/.lt and selectAllPages, without T23:59:59 or T00:00:00.000Z', () => {
    const src = readCode('repositories/focusSessionRepository.ts');
    expect(src).toMatch(/\bexport\s+async\s+function\s+fetchFocusSessionsBetween\b/);
    expect(src).toContain(".gte('started_at'");
    expect(src).toContain(".lt('started_at'");
    expect(src).toContain('selectAllPages');
    expect(src).not.toContain('T23:59:59');
    expect(src).not.toContain('T00:00:00.000Z');
  });

  it.each([
    'app/screens/weekly-review.tsx',
    'app/screens/insights.tsx',
    'app/screens/monthly-review.tsx',
  ])('(+) %s uses sessionsBetween and has zero started_at lexical string filters', (screenPath) => {
    const src = readCode(screenPath);
    expect(src).toMatch(/\bsessionsBetween\b/);
    expect(src).not.toContain('T23:59:59');
    expect(src).not.toMatch(/\bsess\.started_at\s*<=/);
    expect(src).not.toMatch(/\bsess\.started_at\s*>=/);
  });

  it('(+) monthly-review.tsx splits month and previous-month sessions via ymdFromIso(sess.started_at)', () => {
    const src = readCode('app/screens/monthly-review.tsx');
    expect(src).toMatch(/ymdFromIso\(\s*sess\.started_at\s*\)\s*>=\s*start/);
    expect(src).toMatch(/ymdFromIso\(\s*sess\.started_at\s*\)\s*>=\s*prevStart/);
  });
});

describe('F15 focusWindowsLocalDay — fetchFocusSessionsBetween behavior', () => {
  it('(+) sends half-open [localDayStartIso(start), localDayStartIso(end + 1)) filters to Supabase', async () => {
    expect(typeof fetchFocusSessionsBetween).toBe('function');
    const res = await fetchFocusSessionsBetween({ startYmd: '2026-11-02', endYmd: '2026-11-08' });
    expect(res.ok).toBe(true);
    expect(mockState.captured).toEqual([
      { op: 'eq', col: 'user_id', val: 'u-f15' },
      { op: 'gte', col: 'started_at', val: localDayStartIso('2026-11-02') },
      { op: 'lt', col: 'started_at', val: localDayStartIso('2026-11-09') },
    ]);
  });

  it('(-) rejects invalid or inverted date windows before issuing a query', async () => {
    const badDate = await fetchFocusSessionsBetween({ startYmd: '2026-02-30', endYmd: '2026-03-05' });
    expect(badDate.ok).toBe(false);
    expect(mockState.captured).toEqual([]);

    const inverted = await fetchFocusSessionsBetween({ startYmd: '2026-11-09', endYmd: '2026-11-08' });
    expect(inverted.ok).toBe(false);
    expect(mockState.captured).toEqual([]);
  });

  describeIstanbul('Europe/Istanbul week boundary [2026-11-02, 2026-11-08]', () => {
    it('(+) includes Monday 00:30+03 and Sunday 23:59:59+03, excludes Sunday 23:59:59 prev week and next Monday 00:00+03', async () => {
      mockState.rows = [
        {
          id: 'prev-sun-2359',
          user_id: 'u-f15',
          task_id: null,
          task_title: null,
          mode: 'work',
          started_at: new Date('2026-11-01T23:59:59+03:00').toISOString(),
          ended_at: null,
          planned_seconds: 1500,
          completed_seconds: 1500,
          completed: true,
        },
        {
          id: 'mon-0030',
          user_id: 'u-f15',
          task_id: null,
          task_title: null,
          mode: 'work',
          started_at: new Date('2026-11-02T00:30:00+03:00').toISOString(),
          ended_at: null,
          planned_seconds: 1500,
          completed_seconds: 1500,
          completed: true,
        },
        {
          id: 'sun-2359',
          user_id: 'u-f15',
          task_id: null,
          task_title: null,
          mode: 'work',
          started_at: new Date('2026-11-08T23:59:59+03:00').toISOString(),
          ended_at: null,
          planned_seconds: 1500,
          completed_seconds: 1500,
          completed: true,
        },
        {
          id: 'next-mon-0000',
          user_id: 'u-f15',
          task_id: null,
          task_title: null,
          mode: 'work',
          started_at: new Date('2026-11-09T00:00:00+03:00').toISOString(),
          ended_at: null,
          planned_seconds: 1500,
          completed_seconds: 1500,
          completed: true,
        },
      ];

      const res = await fetchFocusSessionsBetween({ startYmd: '2026-11-02', endYmd: '2026-11-08' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.map((r) => r.id).sort()).toEqual(['mon-0030', 'sun-2359']);
      }
    });
  });
});
