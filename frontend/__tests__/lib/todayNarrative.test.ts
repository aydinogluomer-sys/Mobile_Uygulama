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

  it('(+) F44 characterization — pins exact lead/emphasis/tail/sub across every priority and hour/focusSessions branch', () => {
    // 1. Overdue > OVERDUE_CALM_LIMIT + morning no focus
    expect(
      buildTodayNarrative({
        hour: 8,
        overdueCount: 6,
        todayTaskCount: 4,
        remainingHabits: 2,
        totalHabits: 3,
        focusSessions: 0,
      }),
    ).toEqual({
      lead: 'Birikmiş işler var; ',
      emphasis: 'bugün yalnız birini',
      tail: ' seç.',
      sub: 'Güne kısa bir odak bloğuyla başla.',
    });

    // 2. Overdue 1..5 + afternoon no focus
    expect(
      buildTodayNarrative({
        hour: 14,
        overdueCount: 3,
        todayTaskCount: 4,
        remainingHabits: 2,
        totalHabits: 3,
        focusSessions: 0,
      }),
    ).toEqual({
      lead: 'Bugün önce ',
      emphasis: '3 gecikmiş işi',
      tail: ' sakin biçimde topla.',
      sub: 'Bir odak bloğu aç ve ilerlemeyi sürdür.',
    });

    // 3. Today tasks > 0 + evening no focus
    expect(
      buildTodayNarrative({
        hour: 20,
        overdueCount: 0,
        todayTaskCount: 4,
        remainingHabits: 2,
        totalHabits: 3,
        focusSessions: 0,
      }),
    ).toEqual({
      lead: 'Bugün ',
      emphasis: '4 planlı görevi',
      tail: ' net bir akışla bitir.',
      sub: 'Günü sakin bir kapanışla bitir.',
    });

    // 4. Remaining habits > 0 + focusSessions > 0 overrides hour sub
    expect(
      buildTodayNarrative({
        hour: 9,
        overdueCount: 0,
        todayTaskCount: 0,
        remainingHabits: 2,
        totalHabits: 5,
        focusSessions: 3,
      }),
    ).toEqual({
      lead: 'Bugün ',
      emphasis: '2 alışkanlık',
      tail: ' seni bekliyor; hazır olduğunda başla.',
      sub: 'Bugün 3 odak seansı tamamlandı; ritmi koru.',
    });

    // 5. All habits done (remainingHabits = 0, totalHabits > 0) at boundary hour = 12
    expect(
      buildTodayNarrative({
        hour: 12,
        overdueCount: 0,
        todayTaskCount: 0,
        remainingHabits: 0,
        totalHabits: 3,
        focusSessions: 0,
      }),
    ).toEqual({
      lead: 'Masadaki işler ',
      emphasis: 'tamamlandı',
      tail: ' — sıradaki odağı planla.',
      sub: 'Bir odak bloğu aç ve ilerlemeyi sürdür.',
    });

    // 6. Clean slate (totalHabits = 0) at boundary hour = 18
    expect(
      buildTodayNarrative({
        hour: 18,
        overdueCount: 0,
        todayTaskCount: 0,
        remainingHabits: 0,
        totalHabits: 0,
        focusSessions: 0,
      }),
    ).toEqual({
      lead: 'Bugüne ',
      emphasis: 'temiz bir sayfa',
      tail: ' ile başla.',
      sub: 'Günü sakin bir kapanışla bitir.',
    });
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
