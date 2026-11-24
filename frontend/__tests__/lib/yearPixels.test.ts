import { parseLocalDate, type Ymd } from '../../lib/date';
import { dailyMoods, makeCheckin, type MoodDefinition } from '../../lib/moods';
import {
  buildYearPixels,
  JOURNAL_FETCH_LIMIT,
  monthSummaryText,
  valenceToMood,
  YEAR_PIXELS_SCOPE_NOTE,
  YEAR_PIXELS_SCOPE_NOTE_DEVICE,
  YEAR_PIXELS_TRUNCATED_NOTE,
  yearPixelsSummaryText,
} from '../../lib/yearPixels';

const CUSTOM_MOOD: MoodDefinition = {
  id: 'custom-calm',
  name: 'Dingin',
  icon: '🌿',
  valence: 4,
  builtIn: false,
  archived: false,
};

describe('lib/yearPixels — pure model & valence rounding', () => {
  it('(+) builds 12 months with 365 cells for 2026 (non-leap) and 366 cells for 2028 (leap year)', () => {
    const m2026 = buildYearPixels({ year: 2026, moods: [], todayYmd: '2026-12-31' });
    expect(m2026.year).toBe(2026);
    expect(m2026.months).toHaveLength(12);
    expect(m2026.months.map((m) => m.cells.length)).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(m2026.months.reduce((acc, m) => acc + m.cells.length, 0)).toBe(365);

    const m2028 = buildYearPixels({ year: 2028, moods: [], todayYmd: '2028-12-31' });
    expect(m2028.months[1].cells).toHaveLength(29);
    expect(m2028.months[1].cells[28].date).toBe('2028-02-29');
    expect(m2028.months.reduce((acc, m) => acc + m.cells.length, 0)).toBe(366);
  });

  it('(+) valenceToMood rounds half-up and clamps into 1..5', () => {
    expect(valenceToMood(3.5)).toBe(4);
    expect(valenceToMood(2.5)).toBe(3);
    expect(valenceToMood(1.2)).toBe(1);
    expect(valenceToMood(0.2)).toBe(1);
    expect(valenceToMood(4.9)).toBe(5);
    expect(valenceToMood(6.4)).toBe(5);
  });

  it('(+) maps mood days, preserves raw float averageMood per month, and matches distribution sum to loggedDays', () => {
    const checkins = [
      makeCheckin({ ...CUSTOM_MOOD, valence: 3 }, { id: 'c1', at: new Date(2026, 0, 10, 9), day: '2026-01-10', intensity: 1 }),
      makeCheckin({ ...CUSTOM_MOOD, valence: 4 }, { id: 'c2', at: new Date(2026, 0, 10, 18), day: '2026-01-10', intensity: 2 }),
    ];
    const merged = dailyMoods(checkins, [
      { date: '2026-01-10', mood: 1 }, // overridden by check-in mean 3.5 -> mood 4
      { date: '2026-01-15', mood: 3 },
      { date: '2026-06-01', mood: 3 },
    ]);

    const model = buildYearPixels({ year: 2026, moods: merged, todayYmd: '2026-08-01' });
    expect(model.loggedDays).toBe(3);

    const jan = model.months[0];
    expect(jan.entryDays).toBe(2);
    // Raw mean of 3.5 and 3 is 3.25 (unrounded!)
    expect(jan.averageMood).toBeCloseTo(3.25, 5);
    expect(jan.cells[9]).toEqual({ date: '2026-01-10', day: 10, state: 'mood', mood: 4 });
    expect(jan.cells[14]).toEqual({ date: '2026-01-15', day: 15, state: 'mood', mood: 3 });

    const distSum = Object.values(model.distribution).reduce((a, b) => a + b, 0);
    expect(distSum).toBe(model.loggedDays);
    expect(model.distribution[3]).toBe(2);
    expect(model.distribution[4]).toBe(1);

    expect(yearPixelsSummaryText(model)).toBe('2026: 3 gün kayıt; en sık ruh hali Orta.');
    expect(monthSummaryText(jan)).toBe('Ocak: 2 gün kayıt, ortalama Orta');
  });

  it('(+) empty year yields loggedDays=0, neutral summary, and exports exact scope/truncated notes', () => {
    const empty = buildYearPixels({ year: 2026, moods: [], todayYmd: '2026-05-01' });
    expect(empty.loggedDays).toBe(0);
    expect(empty.months[0].averageMood).toBeNull();
    expect(yearPixelsSummaryText(empty)).toBe('2026: henüz ruh hali kaydı yok.');
    expect(YEAR_PIXELS_SCOPE_NOTE_DEVICE).toBe("Bu cihazdaki check-in'ler ve tüm günlük kayıtların gösterilir.");
    expect(YEAR_PIXELS_SCOPE_NOTE).toBe(YEAR_PIXELS_SCOPE_NOTE_DEVICE);
    expect(YEAR_PIXELS_TRUNCATED_NOTE).toBe('Yalnızca son 365 kayıt gösteriliyor.');
    expect(JOURNAL_FETCH_LIMIT).toBe(365);
  });

  it('(-) ignores other years, marks unlogged past days as empty (never missed), marks > todayYmd as future, never emits Feb 30, and never shames with boş/kaçır', () => {
    const model = buildYearPixels({
      year: 2026,
      moods: [
        { date: '2025-12-31', mood: 5 },
        { date: '2027-01-01', mood: 5 },
        { date: '2026-03-01', mood: 4 },
        { date: '2026-10-15', mood: 5 }, // future relative to todayYmd
      ],
      todayYmd: '2026-06-15',
    });

    expect(model.loggedDays).toBe(1);
    const allCells = model.months.flatMap((m) => m.cells);
    expect(allCells.some((c) => c.date === '2026-02-30')).toBe(false);
    expect(allCells.some((c) => c.date === '2026-02-29')).toBe(false);
    expect(allCells.every((c) => c.state === 'mood' || c.state === 'empty' || c.state === 'future')).toBe(true);

    const feb10 = allCells.find((c) => c.date === '2026-02-10')!;
    expect(feb10.state).toBe('empty');
    expect(feb10.mood).toBeNull();

    const jun15 = allCells.find((c) => c.date === '2026-06-15')!;
    expect(jun15.state).toBe('empty');

    const jun16 = allCells.find((c) => c.date === '2026-06-16')!;
    expect(jun16.state).toBe('future');
    expect(jun16.mood).toBeNull();

    const oct15 = allCells.find((c) => c.date === '2026-10-15')!;
    expect(oct15.state).toBe('future');
    expect(oct15.mood).toBeNull();

    const summary = yearPixelsSummaryText(model);
    expect(summary.toLocaleLowerCase('tr-TR')).not.toContain('boş');
    expect(summary.toLocaleLowerCase('tr-TR')).not.toContain('kaçır');
    // Unlogged count (364 or 165) must never appear in summary
    expect(summary).not.toContain('364');
    expect(summary).not.toContain('165');

    for (const m of model.months) {
      const mText = monthSummaryText(m).toLocaleLowerCase('tr-TR');
      expect(mText).not.toContain('boş');
      expect(mText).not.toContain('kaçır');
    }
  });
});

describe('lib/yearPixels — DST & leap-year TZ matrix integrity', () => {
  const TARGETS: { year: number; date: Ymd; expectedMonth: number; expectedDay: number }[] = [
    { year: 2026, date: '2026-03-08', expectedMonth: 2, expectedDay: 8 },
    { year: 2026, date: '2026-11-01', expectedMonth: 10, expectedDay: 1 },
    { year: 2026, date: '2026-09-27', expectedMonth: 8, expectedDay: 27 },
    { year: 2028, date: '2028-02-29', expectedMonth: 1, expectedDay: 29 },
    { year: 2026, date: '2026-12-31', expectedMonth: 11, expectedDay: 31 },
  ];

  it.each(TARGETS)(
    '$date appears exactly once in month $expectedMonth at day $expectedDay in every timezone',
    ({ year, date, expectedMonth, expectedDay }) => {
      const model = buildYearPixels({
        year,
        moods: [{ date, mood: 5 }],
        todayYmd: `${year}-12-31`,
      });
      const allCells = model.months.flatMap((m) => m.cells);
      const matches = allCells.filter((c) => c.date === date);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toEqual({ date, day: expectedDay, state: 'mood', mood: 5 });
      expect(model.months[expectedMonth].cells[expectedDay - 1].date).toBe(date);
      expect(parseLocalDate(date)).not.toBeNull();
    },
  );
});
