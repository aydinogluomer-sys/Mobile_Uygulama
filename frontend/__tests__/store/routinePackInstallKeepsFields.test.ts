/**
 * R05.01 — installing a routine pack keeps what the pack says about each
 * habit: icon, unit, daily goal, direction and schedule. It used to install
 * "Su hedefi, 8 bardak" as a bare yes/no habit with no unit and no target,
 * because the pack was stripped to four fields for validation and the
 * stripped proposal was what got installed.
 */
const mockInstallCalls: { habits: Record<string, unknown>[] }[] = [];

jest.mock('../../services/routineService', () => ({
  installProposal: jest.fn(async (habits: Record<string, unknown>[]) => {
    mockInstallCalls.push({ habits });
    return { ok: true, habits: [] };
  }),
}));
jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: jest.fn() }, auth: { getSession: jest.fn() } } }));

import { useRoutineStore } from '../../store/routineStore';
import { useHabitStore } from '../../store/habitStore';
import { findRoutinePack } from '../../lib/routinePacks';

beforeEach(() => {
  mockInstallCalls.length = 0;
  useHabitStore.setState({ habits: [], loading: false });
  useRoutineStore.setState({
    proposalSource: null, stagedIcons: null, proposal: null, proposalErrors: null, evaluation: null,
    installing: false, installError: null, installed: false,
  });
});

describe('R05.01 — a pack installs with its own fields', () => {
  it('unit, goal, direction, schedule and icon reach the install', async () => {
    useRoutineStore.getState().loadPack('fitness-foundation');
    expect(useRoutineStore.getState().proposalErrors).toBeNull();
    expect(await useRoutineStore.getState().confirmInstall()).toBe(true);

    const water = mockInstallCalls[0].habits.find((h) => h.name === 'Su hedefi')!;
    expect(water).toMatchObject({
      tracking_type: 'numeric', unit: 'bardak', daily_goal: 8, target_direction: 'at_least',
      frequency_config: { kind: 'daily' }, icon: 'water-outline',
    });
  });

  it('every habit of every field the pack defines arrives, by name', async () => {
    const pack = findRoutinePack('fitness-foundation')!;
    useRoutineStore.getState().loadPack('fitness-foundation');
    await useRoutineStore.getState().confirmInstall();
    const sent = mockInstallCalls[0].habits;
    expect(sent).toHaveLength(pack.habits.length);
    for (const h of pack.habits) {
      const got = sent.find((x) => x.name === h.name)!;
      expect(got.icon).toBe(h.icon);
      expect(got.frequency_config).toEqual(h.frequency_config);
      if (h.unit) expect(got.unit).toBe(h.unit);
      if (h.daily_goal) expect(got.daily_goal).toBe(h.daily_goal);
    }
  });

  it('icons are a pack thing: an AI/coach proposal staged later carries none', () => {
    useRoutineStore.getState().loadPack('fitness-foundation');
    expect(useRoutineStore.getState().stagedIcons).not.toBeNull();
    useRoutineStore.getState().clearGenerated();
    expect(useRoutineStore.getState().stagedIcons).toBeNull();
  });
});
