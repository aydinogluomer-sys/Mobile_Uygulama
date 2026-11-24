import {
  buildRecoveryFixture,
  buildStartFixture,
} from '../helpers/playbookFixtures';

describe('F0 — Playbook Canonical Synthetic Fixtures & P02 Cohort Separation', () => {
  it('(+) START fixture exposes same local day, empty action history, first-action candidate, and explicit missing-duration flag', () => {
    const selfPlanner = buildStartFixture({ setupSubgroup: 'self_planner' });
    expect(selfPlanner.localDayKey).toBe('2026-11-24');
    expect(selfPlanner.actionHistory).toEqual([]);
    expect(selfPlanner.tasks).toHaveLength(1);
    expect(selfPlanner.tasks[0].title).toBe('Teklifi hazırla');
    expect(selfPlanner.tasks[0].estimated_minutes).toBeNull();
    expect(selfPlanner.missingEstimateTaskIds).toEqual(['task-start-proposal']);
    expect(selfPlanner.fixedBlockIds).toEqual([]);
    expect(selfPlanner.firstAction).toEqual({
      kind: 'task',
      id: 'task-start-proposal',
      label: 'Teklifi hazırla',
      detail: expect.any(String),
    });
    expect(selfPlanner.primaryCta.verb).toBe('Başla');
    expect(selfPlanner.starterCandidates).toEqual([]);
    expect(selfPlanner.cohorts).toEqual(['start_blocked']);
  });

  it('(+) START fixture separates self_planner from routine_starter adults (P02)', () => {
    const routineStarter = buildStartFixture({
      setupSubgroup: 'routine_starter',
      cohorts: ['start_blocked', 'midday_derailed'],
    });
    expect(routineStarter.setupSubgroup).toBe('routine_starter');
    expect(routineStarter.cohorts).toEqual(['start_blocked', 'midday_derailed']);
    expect(routineStarter.starterCandidates).toHaveLength(1);
    expect(routineStarter.starterCandidates[0].packId).toBe('workday-kickoff');
    expect(routineStarter.firstActionCandidateIds).toEqual([
      'task-start-proposal',
      'workday-kickoff',
    ]);
  });

  it('(+) RECOVERY fixture exposes same local day, locked 16:00 appointment, real measurable deficit, overdue item, and missing-duration marker', () => {
    const recovery = buildRecoveryFixture();
    expect(recovery.localDayKey).toBe('2026-11-24');
    expect(recovery.fixedBlocks).toHaveLength(1);
    expect(recovery.fixedBlocks[0]).toMatchObject({
      id: 'appt-fixed-1600',
      local_day: '2026-11-24',
      start_time: '16:00',
      end_time: '17:00',
      locked: true,
    });
    expect(recovery.fixedBlockIds).toEqual(['appt-fixed-1600']);

    const todayTasks = recovery.tasks.filter((t) => t.due_date === recovery.localDayKey);
    const overdueTasks = recovery.tasks.filter((t) => Boolean(t.due_date && t.due_date < recovery.localDayKey));
    expect(todayTasks).toHaveLength(2);
    expect(overdueTasks).toHaveLength(1);
    expect(recovery.missingEstimateTaskIds).toEqual(['task-rec-unestimated']);

    expect(recovery.measurableDeficits).toEqual([
      {
        habitId: 'habit-rec-water',
        targetValue: 1.5,
        loggedValue: 0.5,
        remainingValue: 1.0,
        unit: 'L',
      },
    ]);

    expect(recovery.firstAction).not.toBeNull();
    const actionId =
      recovery.firstAction && 'id' in recovery.firstAction ? recovery.firstAction.id : null;
    expect(actionId).toBe('task-rec-overdue');
    expect(recovery.firstActionCandidateIds).toContain(actionId);
  });
});
