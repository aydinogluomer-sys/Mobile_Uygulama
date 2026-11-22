import {
  computeStage,
  isLegacyAccount,
  isToolVisible,
  STAGE_THRESHOLDS,
  TODAY_CONTRACT,
  TODAY_TOOL_IDS,
  type DisclosureSignals,
  type DisclosureStage,
} from '../../lib/disclosure';

const STAGE_RANK: Record<DisclosureStage, number> = {
  first_day: 0,
  first_week: 1,
  established: 2,
};

describe('F27 (NAV-10, NAV-13) — lib/disclosure pure engine', () => {
  it('pins TODAY_CONTRACT ceilings and STAGE_THRESHOLDS', () => {
    expect(TODAY_CONTRACT.maxMainBlocks).toBeLessThanOrEqual(3);
    expect(TODAY_CONTRACT.maxBlocksWithContext).toBeLessThanOrEqual(4);
    expect(TODAY_CONTRACT.maxInteractiveBeforeFirstHabit).toBeLessThanOrEqual(8);
    expect(TODAY_CONTRACT.segmentsAutoItemThreshold).toBe(8);
    expect(STAGE_THRESHOLDS).toEqual({
      firstWeekActiveDays: 3,
      firstWeekActiveDaysFast: 2,
      fastOnboardingMinutes: 10,
      establishedActiveDays: 14,
      establishedAccountAgeDays: 14,
      legacyAccountAgeDays: 7,
    });
    expect(TODAY_TOOL_IDS).toEqual(['spark', 'metrics', 'segments', 'balance', 'routine', 'strategy']);
  });

  describe('computeStage truth table & boundaries', () => {
    const base: DisclosureSignals = {
      accountAgeDays: 0,
      activeDays: 0,
      firstCloseDone: false,
      firstTodayMinutes: null,
    };

    it('returns first_day at 0-2 active days without fast onboarding or first close', () => {
      expect(computeStage(base)).toBe('first_day');
      expect(computeStage({ ...base, activeDays: 2, accountAgeDays: 6 })).toBe('first_day');
      expect(computeStage({ ...base, activeDays: 2, firstTodayMinutes: 11 })).toBe('first_day');
    });

    it('promotes to first_week on 3 active days, first close, or 2 active days with fast onboarding (<= 10m)', () => {
      expect(computeStage({ ...base, activeDays: 3 })).toBe('first_week');
      expect(computeStage({ ...base, activeDays: 0, firstCloseDone: true })).toBe('first_week');
      expect(computeStage({ ...base, activeDays: 1, firstTodayMinutes: 10 })).toBe('first_day');
      expect(computeStage({ ...base, activeDays: 2, firstTodayMinutes: 10 })).toBe('first_week');
      expect(computeStage({ ...base, activeDays: 2, firstTodayMinutes: 0 })).toBe('first_week');
      expect(computeStage({ ...base, activeDays: 13, accountAgeDays: 13 })).toBe('first_week');
    });

    it('promotes to established at 14 active days or accountAgeDays >= 14', () => {
      expect(computeStage({ ...base, activeDays: 14 })).toBe('established');
      expect(computeStage({ ...base, accountAgeDays: 14, activeDays: 0 })).toBe('established');
      expect(computeStage({ ...base, accountAgeDays: 90, activeDays: 1 })).toBe('established');
    });

    it('(-) falls back to local counters when accountAgeDays is null (offline first open) and never regresses', () => {
      expect(computeStage({ ...base, accountAgeDays: null, activeDays: 0 })).toBe('first_day');
      expect(computeStage({ ...base, accountAgeDays: null, activeDays: 3 })).toBe('first_week');
      expect(computeStage({ ...base, accountAgeDays: null, activeDays: 14 })).toBe('established');

      let prevRank = 0;
      for (let d = 0; d <= 20; d += 1) {
        const rank = STAGE_RANK[computeStage({ ...base, accountAgeDays: d, activeDays: d })];
        expect(rank).toBeGreaterThanOrEqual(prevRank);
        prevRank = rank;
      }
    });
  });

  describe('isToolVisible truth table', () => {
    const stages: DisclosureStage[] = ['first_day', 'first_week', 'established'];

    it('keeps spark, metrics, and strategy off by default in ALL stages', () => {
      for (const stage of stages) {
        for (const tool of ['spark', 'metrics', 'strategy'] as const) {
          expect(isToolVisible(tool, stage, undefined, { itemCount: 50, routineActive: true })).toBe(false);
        }
      }
    });

    it('gates balance on stage > first_day, routine on stage > first_day OR routineActive, and segments on stage > first_day AND itemCount > 8', () => {
      expect(isToolVisible('balance', 'first_day', undefined, { itemCount: 20, routineActive: false })).toBe(false);
      expect(isToolVisible('balance', 'first_week', undefined, { itemCount: 0, routineActive: false })).toBe(true);
      expect(isToolVisible('balance', 'established', undefined, { itemCount: 0, routineActive: false })).toBe(true);

      expect(isToolVisible('routine', 'first_day', undefined, { itemCount: 0, routineActive: false })).toBe(false);
      expect(isToolVisible('routine', 'first_day', undefined, { itemCount: 0, routineActive: true })).toBe(true);
      expect(isToolVisible('routine', 'first_week', undefined, { itemCount: 0, routineActive: false })).toBe(true);

      expect(isToolVisible('segments', 'first_day', undefined, { itemCount: 20, routineActive: false })).toBe(false);
      expect(isToolVisible('segments', 'first_week', undefined, { itemCount: 8, routineActive: false })).toBe(false);
      expect(isToolVisible('segments', 'first_week', undefined, { itemCount: 9, routineActive: false })).toBe(true);
      expect(isToolVisible('segments', 'established', undefined, { itemCount: 8, routineActive: false })).toBe(false);
      expect(isToolVisible('segments', 'established', undefined, { itemCount: 9, routineActive: false })).toBe(true);
    });

    it('lets explicit user choice (on/off) override automatic visibility in every stage and context', () => {
      for (const stage of stages) {
        for (const tool of TODAY_TOOL_IDS) {
          expect(isToolVisible(tool, stage, 'on', { itemCount: 0, routineActive: false })).toBe(true);
          expect(isToolVisible(tool, stage, 'off', { itemCount: 50, routineActive: true })).toBe(false);
        }
      }
    });
  });

  describe('isLegacyAccount', () => {
    it('returns true iff accountAgeDays >= 7', () => {
      expect(isLegacyAccount(null)).toBe(false);
      expect(isLegacyAccount(0)).toBe(false);
      expect(isLegacyAccount(6)).toBe(false);
      expect(isLegacyAccount(7)).toBe(true);
      expect(isLegacyAccount(45)).toBe(true);
    });
  });
});
