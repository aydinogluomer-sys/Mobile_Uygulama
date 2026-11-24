/**
 * F27 (NAV-10, NAV-13, PS-01) — Today Simplicity Contract & progressive disclosure engine.
 *
 * Pure and deterministic: no I/O, no clock, no store imports.
 */

export type DisclosureStage = 'first_day' | 'first_week' | 'established';
export type TodayToolId = 'spark' | 'metrics' | 'segments' | 'balance' | 'routine' | 'strategy';

export const TODAY_TOOL_IDS: readonly TodayToolId[] = [
  'spark',
  'metrics',
  'segments',
  'balance',
  'routine',
  'strategy',
];

export type ToolChoice = 'on' | 'off';
/** Absent key = automatic stage-driven visibility. */
export type ToolChoices = Partial<Record<TodayToolId, ToolChoice>>;

/** Monotonic ceilings (may only move downward). */
export const TODAY_CONTRACT = {
  maxMainBlocks: 3,
  maxBlocksWithContext: 4,
  maxInteractiveBeforeFirstHabit: 8,
  segmentsAutoItemThreshold: 8,
} as const;

export const STAGE_THRESHOLDS = {
  firstWeekActiveDays: 3,
  firstWeekActiveDaysFast: 2,
  fastOnboardingMinutes: 10,
  establishedActiveDays: 14,
  establishedAccountAgeDays: 14,
  legacyAccountAgeDays: 7,
} as const;

export type DisclosureSignals = {
  /** `null` when unknown (offline first launch): falls back strictly to local counters. */
  accountAgeDays: number | null;
  activeDays: number;
  firstCloseDone: boolean;
  /** Minutes from account creation to first Today view (onboarding speed). */
  firstTodayMinutes: number | null;
};

export function computeStage(s: DisclosureSignals): DisclosureStage {
  if (
    (s.accountAgeDays !== null && s.accountAgeDays >= STAGE_THRESHOLDS.establishedAccountAgeDays) ||
    s.activeDays >= STAGE_THRESHOLDS.establishedActiveDays
  ) {
    return 'established';
  }
  const fastOnboarding =
    s.firstTodayMinutes !== null && s.firstTodayMinutes <= STAGE_THRESHOLDS.fastOnboardingMinutes;
  const weekDaysNeeded = fastOnboarding
    ? STAGE_THRESHOLDS.firstWeekActiveDaysFast
    : STAGE_THRESHOLDS.firstWeekActiveDays;
  if (s.firstCloseDone || s.activeDays >= weekDaysNeeded) {
    return 'first_week';
  }
  return 'first_day';
}

export type ToolContext = {
  itemCount: number;
  routineActive: boolean;
};

export function isToolVisible(
  tool: TodayToolId,
  stage: DisclosureStage,
  choice: ToolChoice | undefined,
  ctx: ToolContext,
): boolean {
  if (choice === 'on') return true;
  if (choice === 'off') return false;

  if (tool === 'spark' || tool === 'metrics' || tool === 'strategy') {
    return false;
  }
  if (tool === 'balance') {
    return stage !== 'first_day';
  }
  if (tool === 'routine') {
    return stage !== 'first_day' || ctx.routineActive;
  }
  if (tool === 'segments') {
    return stage !== 'first_day' && ctx.itemCount > TODAY_CONTRACT.segmentsAutoItemThreshold;
  }
  return false;
}

export function isLegacyAccount(accountAgeDays: number | null): boolean {
  return accountAgeDays !== null && accountAgeDays >= STAGE_THRESHOLDS.legacyAccountAgeDays;
}
