import {
  buildTodayNarrative,
  OVERDUE_CALM_LIMIT,
  type NarrativeInput,
} from '../../lib/todayNarrative';

const base: NarrativeInput = {
  hour: 10,
  overdueCount: 0,
  todayTaskCount: 0,
  remainingHabits: 2,
  totalHabits: 3,
  focusSessions: 0,
};

describe('F27 (INT-22) — lib/todayNarrative calm backlog & zero streak pressure', () => {
  it('exports OVERDUE_CALM_LIMIT = 5', () => {
    expect(OVERDUE_CALM_LIMIT).toBe(5);
  });

  it.each([
    [1, '1 gecikmiş işi', true],
    [5, '5 gecikmiş işi', true],
    [6, 'bugün yalnız birini', false],
    [143, 'bugün yalnız birini', false],
  ] as const)(
    'overdueCount=%i -> emphasis="%s" (shows count=%s)',
    (overdueCount, expectedEmphasis, showsCount) => {
      const n = buildTodayNarrative({ ...base, overdueCount });
      expect(n.emphasis).toBe(expectedEmphasis);
      const joined = `${n.lead}${n.emphasis}${n.tail}`;
      if (showsCount) {
        expect(joined).toContain(String(overdueCount));
      } else {
        expect(joined).toBe('Birikmiş işler var; bugün yalnız birini seç.');
        expect(joined).not.toMatch(/\d/);
      }
    },
  );

  it('preserves F23 calm habit copy when overdueCount=0 and todayTaskCount=0', () => {
    const n = buildTodayNarrative(base);
    expect(n.emphasis).toBe('2 alışkanlık');
    expect(n.tail).toBe(' seni bekliyor; hazır olduğunda başla.');
  });

  it('(-) never emits "seriyi koru" across any narrative branch or hour', () => {
    const cases: NarrativeInput[] = [
      { ...base, overdueCount: 1 },
      { ...base, overdueCount: 25 },
      { ...base, todayTaskCount: 3 },
      { ...base, remainingHabits: 4, totalHabits: 5 },
      { ...base, remainingHabits: 0, totalHabits: 5 },
      { ...base, remainingHabits: 0, totalHabits: 0 },
    ];
    for (const hour of [6, 14, 21]) {
      for (const focusSessions of [0, 2]) {
        for (const c of cases) {
          const n = buildTodayNarrative({ ...c, hour, focusSessions });
          expect(`${n.lead}${n.emphasis}${n.tail} ${n.sub}`).not.toContain('seriyi koru');
        }
      }
    }
  });
});
