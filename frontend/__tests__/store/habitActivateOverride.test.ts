/**
 * R03.04 — "Yine de etkinleştir" reaches the activation rule as an explicit
 * override; a plain tap never carries one.
 */
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
const mockActivate = jest.fn(async (p: { habit: { id: string } }) => ({ ok: true, habit: { ...p.habit, status: 'active' } }));
jest.mock('../../services/habitService', () => ({
  ...jest.requireActual('../../services/habitService'),
  activateHabit: (p: any) => mockActivate(p),
}));

import { useHabitStore } from '../../store/habitStore';
import { useWillpowerStore } from '../../store/willpowerStore';

beforeEach(() => {
  mockActivate.mockClear();
  useHabitStore.setState({ habits: [{ id: 'w1', status: 'waiting', willpower_cost: 3 } as never], loading: false } as never);
  useWillpowerStore.setState({ state: null, fetchToday: jest.fn(async () => undefined) } as never);
});

it('a plain activation carries no override', async () => {
  await useHabitStore.getState().activateHabit('w1', 3);
  expect(mockActivate.mock.calls[0][0]).toMatchObject({ override: false });
});

it('"Yine de etkinleştir" carries override: true', async () => {
  await useHabitStore.getState().activateHabit('w1', 3, { override: true });
  expect(mockActivate.mock.calls[0][0]).toMatchObject({ override: true });
  expect(useHabitStore.getState().habits[0].status).toBe('active');
});
