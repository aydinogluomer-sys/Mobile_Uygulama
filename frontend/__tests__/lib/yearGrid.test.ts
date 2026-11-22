import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => {
      throw new Error('yearGrid must not touch supabase');
    },
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import type { Habit } from '../../lib/supabase';
import type { HabitDetailLogRow } from '../../services/habitService';
import { addDaysLocal, parseLocalDate, ymd, type Ymd } from '../../lib/date';
import { dayCellFor } from '../../app/screens/habit-detail';
import {
  YEAR_CELL_STATE_LABEL,
  YEAR_GRID_CELL,
  YEAR_GRID_GAP,
  YEAR_GRID_MAX_WEEKS,
  YEAR_GRID_MIN_WEEKS,
  YEAR_GRID_ROWS,
  aggregateSummaryText,
  buildAggregateYearGrid,
  buildHabitYearGrid,
  cellAtPoint,
  gridContentWidth,
  nextSelectableDay,
  yearGridDayLabel,
  yearGridSummaryText,
} from '../../lib/yearGrid';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    name: 'Kitap oku',
    behavior_type: 'positive',
    status: 'active',
    tracking_type: 'boolean',
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    created_at: '2025-01-01T09:00:00',
    end_condition: null,
    ...over,
  } as Habit;
}

describe('lib/yearGrid — buildHabitYearGrid', () => {
  it('(+) builds 53 columns x 7 rows starting Monday with today in the last column', () => {
    const habit = makeHabit();
    const todayYmd = '2026-08-19'; // Wednesday
    const logs = new Map<Ymd, HabitDetailLogRow>();
    const m = buildHabitYearGrid({
      habit,
      todayYmd,
      createdYmd: '2025-01-01',
      cellFor: (d) => dayCellFor(habit, logs, d, todayYmd),
      logStateOn: (day) => logs.get(day)?.state ?? null,
      noteOn: () => false,
      repairedDates: new Set(),
    });

    expect(m.columns).toHaveLength(YEAR_GRID_MAX_WEEKS);
    for (const col of m.columns) {
      expect(col.cells).toHaveLength(YEAR_GRID_ROWS);
      const mon = parseLocalDate(col.weekStart)!;
      expect((mon.getDay() + 6) % 7).toBe(0); // Monday
    }

    const lastCol = m.columns[m.columns.length - 1];
    expect(lastCol.cells.map((c) => c.date)).toContain(todayYmd);
    // Today (Wed index 2) is unlogged -> pending, Thu..Sun (3..6) -> future
    expect(lastCol.cells[2].date).toBe(todayYmd);
    expect(lastCol.cells[2].state).toBe('pending');
    expect(lastCol.cells.slice(3).map((c) => c.state)).toEqual([
      'future',
      'future',
      'future',
      'future',
    ]);
  });

  it('(+) clamps newly created habit (created today) to YEAR_GRID_MIN_WEEKS (13 columns)', () => {
    const todayYmd = '2026-08-19';
    const habit = makeHabit({ created_at: '2026-08-19T10:00:00' });
    const logs = new Map<Ymd, HabitDetailLogRow>();
    const m = buildHabitYearGrid({
      habit,
      todayYmd,
      createdYmd: todayYmd,
      cellFor: (d) => dayCellFor(habit, logs, d, todayYmd),
      logStateOn: () => null,
      noteOn: () => false,
      repairedDates: new Set(),
    });
    expect(m.columns).toHaveLength(YEAR_GRID_MIN_WEEKS);
  });

  it('(+) maps full/partial/skip/not_scheduled, upgrades ONLY missed to repaired, and sets negative unlogged to unknown', () => {
    const todayYmd = '2026-08-19';
    const habit = makeHabit({
      created_at: '2026-08-01T09:00:00',
      frequency_config: { kind: 'daily', interval_days: 2, created_day: '2026-08-10' },
    });
    const logs = new Map<Ymd, HabitDetailLogRow>([
      ['2026-08-10', { habit_id: 'h1', completed_at: '2026-08-10', state: 'done', value: null, notes: 'harika' }],
      ['2026-08-12', { habit_id: 'h1', completed_at: '2026-08-12', state: 'partial', value: 1, notes: null }],
      ['2026-08-14', { habit_id: 'h1', completed_at: '2026-08-14', state: 'skip', value: null, notes: 'yorgun' }],
      // 2026-08-16 eligible & unlogged -> missed, repaired via repairedDates
      // 2026-08-18 eligible & unlogged -> missed (not in repairedDates)
    ]);
    const repaired = new Set<Ymd>(['2026-08-10', '2026-08-16']); // 2026-08-10 is done -> MUST stay done!

    const m = buildHabitYearGrid({
      habit,
      todayYmd,
      createdYmd: '2026-08-10',
      cellFor: (d) => dayCellFor(habit, logs, d, todayYmd),
      logStateOn: (day) => logs.get(day)?.state ?? null,
      noteOn: (day) => Boolean(logs.get(day)?.notes),
      repairedDates: repaired,
    });

    const byDate = new Map(m.columns.flatMap((c) => c.cells).map((cell) => [cell.date, cell]));
    expect(byDate.get('2026-08-10')?.state).toBe('done'); // (-) done + repaired stays done!
    expect(byDate.get('2026-08-10')?.hasNote).toBe(true);
    expect(byDate.get('2026-08-11')?.state).toBe('not_scheduled'); // every_n_days off-day
    expect(byDate.get('2026-08-12')?.state).toBe('partial');
    expect(byDate.get('2026-08-13')?.state).toBe('not_scheduled');
    expect(byDate.get('2026-08-14')?.state).toBe('skip');
    expect(byDate.get('2026-08-14')?.hasNote).toBe(true);
    expect(byDate.get('2026-08-16')?.state).toBe('repaired');
    expect(byDate.get('2026-08-18')?.state).toBe('missed');
    expect(byDate.get('2026-08-19')?.state).toBe('not_scheduled');

    expect(m.summary).toEqual({
      done: 1,
      partial: 1,
      skip: 1,
      repaired: 1,
      missed: 1,
    });

    // Negative habit unlogged past day -> unknown (unless explicit miss log)
    const negHabit = makeHabit({ behavior_type: 'negative', created_at: '2026-08-10T09:00:00' });
    const negLogs = new Map<Ymd, HabitDetailLogRow>([
      ['2026-08-15', { habit_id: 'h1', completed_at: '2026-08-15', state: 'miss', value: null, notes: null }],
    ]);
    const negModel = buildHabitYearGrid({
      habit: negHabit,
      todayYmd,
      createdYmd: '2026-08-10',
      cellFor: (d) => dayCellFor(negHabit, negLogs, d, todayYmd),
      logStateOn: (day) => negLogs.get(day)?.state ?? null,
      noteOn: () => false,
      repairedDates: new Set(),
    });
    const negByDate = new Map(negModel.columns.flatMap((c) => c.cells).map((cell) => [cell.date, cell]));
    expect(negByDate.get('2026-08-14')?.state).toBe('unknown');
    expect(negByDate.get('2026-08-15')?.state).toBe('missed');
    expect(negByDate.get(todayYmd)?.state).toBe('pending');
  });

  it('(-) empty repairedDates produces zero repaired cells, and yearGrid.ts never reads is_makeup', () => {
    const habit = makeHabit({ created_at: '2026-08-01T09:00:00' });
    const todayYmd = '2026-08-19';
    const logs = new Map<Ymd, HabitDetailLogRow>();
    const m = buildHabitYearGrid({
      habit,
      todayYmd,
      createdYmd: '2026-08-01',
      cellFor: (d) => dayCellFor(habit, logs, d, todayYmd),
      logStateOn: () => null,
      noteOn: () => false,
      repairedDates: new Set(),
    });
    const repairedCells = m.columns.flatMap((c) => c.cells).filter((c) => c.state === 'repaired');
    expect(repairedCells).toHaveLength(0);

    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'yearGrid.ts'), 'utf8');
    expect(src).not.toContain('is_makeup');
  });

  it('(+) yearGridSummaryText lists positive facts only and (-) NEVER mentions missed count or "kaçır"', () => {
    const sampleModel = {
      columns: Array.from({ length: 53 }, (_, i) => ({
        weekStart: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        monthLabel: null,
        cells: [],
      })),
      summary: { done: 112, partial: 9, skip: 4, repaired: 6, missed: 37 },
      firstDay: '2025-08-18',
      lastDay: '2026-08-19',
    };
    const text = yearGridSummaryText(sampleModel);
    expect(text).toBe('Son 53 haftada 112 gün tam, 9 gün kısmi, 4 bilinçli atlama, 6 onarılmış gün.');
    expect(text.toLowerCase()).not.toContain('kaçır');
    expect(text).not.toContain('37');

    // Zero parts omitted
    const sparse = yearGridSummaryText({
      ...sampleModel,
      summary: { done: 5, partial: 0, skip: 0, repaired: 2, missed: 99 },
    });
    expect(sparse).toBe('Son 53 haftada 5 gün tam, 2 onarılmış gün.');
    expect(sparse.toLowerCase()).not.toContain('kaçır');
    expect(sparse).not.toContain('99');

    // All zero positive counts
    const empty = yearGridSummaryText({
      ...sampleModel,
      summary: { done: 0, partial: 0, skip: 0, repaired: 0, missed: 14 },
    });
    expect(empty.toLowerCase()).not.toContain('kaçır');
    expect(empty).not.toContain('14');
  });

  it('(+) yearGridDayLabel formats local date in Turkish with state label', () => {
    expect(
      yearGridDayLabel({ date: '2025-03-12', state: 'done', value: null, hasNote: false }),
    ).toBe('12 Mart Çarşamba: Tamamlandı');
    expect(YEAR_CELL_STATE_LABEL.done).toBe('Tamamlandı');
    expect(YEAR_CELL_STATE_LABEL.missed).toBe('Kaçırıldı');
  });

  it('(+) cellAtPoint maps cell interiors and (-) returns null in gaps or out of bounds', () => {
    const cols = 13;
    const w = gridContentWidth(cols);
    expect(w).toBe(13 * YEAR_GRID_CELL + 12 * YEAR_GRID_GAP);

    expect(cellAtPoint(0, 0, cols)).toEqual({ column: 0, row: 0 });
    expect(cellAtPoint(YEAR_GRID_CELL - 0.1, YEAR_GRID_CELL - 0.1, cols)).toEqual({
      column: 0,
      row: 0,
    });
    // Gap between col 0 and col 1
    expect(cellAtPoint(YEAR_GRID_CELL, 0, cols)).toBeNull();
    expect(cellAtPoint(YEAR_GRID_CELL + YEAR_GRID_GAP - 0.1, 0, cols)).toBeNull();
    // Start of col 1, row 2
    const pitch = YEAR_GRID_CELL + YEAR_GRID_GAP;
    expect(cellAtPoint(pitch, pitch * 2 + 1, cols)).toEqual({ column: 1, row: 2 });
    // Out of bounds
    expect(cellAtPoint(-1, 0, cols)).toBeNull();
    expect(cellAtPoint(0, -1, cols)).toBeNull();
    expect(cellAtPoint(w, 0, cols)).toBeNull();
    expect(cellAtPoint(0, YEAR_GRID_ROWS * pitch, cols)).toBeNull();
  });

  it('(+) nextSelectableDay steps chronologically and (-) skips future/out-of-window days', () => {
    const habit = makeHabit({ created_at: '2026-08-01T09:00:00' });
    const todayYmd = '2026-08-19'; // Wed; Thu..Sun are future
    const logs = new Map<Ymd, HabitDetailLogRow>();
    const m = buildHabitYearGrid({
      habit,
      todayYmd,
      createdYmd: '2026-08-19',
      cellFor: (d) => dayCellFor(habit, logs, d, todayYmd),
      logStateOn: () => null,
      noteOn: () => false,
      repairedDates: new Set(),
    });

    expect(nextSelectableDay(m, '2026-08-18', 1)).toBe('2026-08-19');
    expect(nextSelectableDay(m, '2026-08-19', 1)).toBeNull(); // future skipped!
    expect(nextSelectableDay(m, '2026-08-19', -1)).toBe('2026-08-18');
    expect(nextSelectableDay(m, m.firstDay, -1)).toBeNull();
    // From future date backwards lands on todayYmd
    expect(nextSelectableDay(m, '2026-08-22', -1)).toBe('2026-08-19');
  });
});

describe('lib/yearGrid — buildAggregateYearGrid (PRF-02)', () => {
  it('(+) lights 3 cells with activeDays=3 for 3 done rows on distinct dates, and empty array lights 0', () => {
    const todayYmd = '2026-08-19';
    const empty = buildAggregateYearGrid({ rows: [], todayYmd, capacity: 3 });
    expect(empty.activeDays).toBe(0);
    expect(empty.totalCompletions).toBe(0);
    expect(empty.columns.flatMap((c) => c.cells).every((c) => c.level === 0)).toBe(true);

    const populated = buildAggregateYearGrid({
      rows: [
        { completed_at: '2026-06-01', state: 'done' },
        { completed_at: '2026-07-15', state: 'done' },
        { completed_at: '2026-08-19', state: 'done' },
      ],
      todayYmd,
      capacity: 2,
    });
    expect(populated.activeDays).toBe(3);
    expect(populated.totalCompletions).toBe(3);
    const lit = populated.columns.flatMap((c) => c.cells).filter((c) => c.level > 0);
    expect(lit).toHaveLength(3);
    expect(aggregateSummaryText(populated)).toContain('3 tamamlama');
    expect(aggregateSummaryText(populated)).toContain('3 aktif gün');
  });

  it('(-) miss and skip rows NEVER light a cell; partial gives 0.5 credit', () => {
    const todayYmd = '2026-08-19';
    const m = buildAggregateYearGrid({
      rows: [
        { completed_at: '2026-08-17', state: 'miss' },
        { completed_at: '2026-08-18', state: 'skip' },
        { completed_at: '2026-08-19', state: 'partial' },
      ],
      todayYmd,
      capacity: 1,
    });
    const byDate = new Map(m.columns.flatMap((c) => c.cells).map((cell) => [cell.date, cell]));
    expect(byDate.get('2026-08-17')?.level).toBe(0);
    expect(byDate.get('2026-08-18')?.level).toBe(0);
    expect(byDate.get('2026-08-19')?.partial).toBe(1);
    expect(byDate.get('2026-08-19')?.level).toBe(2); // 0.5 / 1 = 0.5 -> [0.34, 0.67) -> level 2
    expect(m.activeDays).toBe(1);
    expect(m.totalCompletions).toBe(1);
  });
});

describe('lib/yearGrid — DST & leap-year calendar integrity (4-zone TZ matrix)', () => {
  const ANCHORS: { label: string; todayYmd: Ymd; mustContain: Ymd }[] = [
    { label: 'America/New_York spring forward', todayYmd: '2026-03-15', mustContain: '2026-03-08' },
    { label: 'America/New_York fall back', todayYmd: '2026-11-08', mustContain: '2026-11-01' },
    { label: 'Pacific/Auckland spring forward', todayYmd: '2026-10-04', mustContain: '2026-09-27' },
    { label: 'Leap day 2028-02-29', todayYmd: '2028-03-10', mustContain: '2028-02-29' },
  ];

  it.each(ANCHORS)('$label: every calendar day appears once with zero column/row shift', ({ todayYmd, mustContain }) => {
    const habit = makeHabit({ created_at: '2024-01-01T09:00:00' });
    const logs = new Map<Ymd, HabitDetailLogRow>();
    const m = buildHabitYearGrid({
      habit,
      todayYmd,
      createdYmd: '2024-01-01',
      cellFor: (d) => dayCellFor(habit, logs, d, todayYmd),
      logStateOn: () => null,
      noteOn: () => false,
      repairedDates: new Set(),
    });

    const allCells = m.columns.flatMap((c) => c.cells);
    expect(allCells).toHaveLength(53 * 7);

    const dates = allCells.map((c) => c.date);
    expect(new Set(dates).size).toBe(53 * 7);
    expect(dates).toContain(mustContain);

    // Every consecutive cell advances by strictly +1 local calendar day and matches row weekday
    const first = parseLocalDate(dates[0])!;
    for (let i = 0; i < allCells.length; i++) {
      const expected = ymd(addDaysLocal(first, i));
      expect(dates[i]).toBe(expected);
      const d = parseLocalDate(dates[i])!;
      expect((d.getDay() + 6) % 7).toBe(i % 7);
    }

    // Month labels exist and never repeat consecutively
    const monthLabels = m.columns.map((c) => c.monthLabel);
    expect(monthLabels.filter(Boolean).length).toBeGreaterThanOrEqual(11);
    for (let c = 1; c < monthLabels.length; c++) {
      if (monthLabels[c] && monthLabels[c - 1]) {
        expect(monthLabels[c]).not.toBe(monthLabels[c - 1]);
      }
    }
  });
});
