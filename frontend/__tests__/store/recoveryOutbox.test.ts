/**
 * R02.03 — recovery plans through the core outbox, with the REAL store and
 * service: a plan made offline is listed and delivered later with its own id;
 * one completed offline disappears from the list and is closed on delivery.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('../../lib/session', () => require('../helpers/fakeCoreServer').session);
jest.mock('../../repositories/recoveryRepository', () => require('../helpers/fakeCoreServer').recoveryRepo);
/* eslint-enable @typescript-eslint/no-require-imports */
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn(), getSession: jest.fn() } } }));
jest.mock('../../lib/notifications', () => ({ scheduleRecoveryReminder: jest.fn(), cancelRecoveryReminder: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { server } from '../helpers/fakeCoreServer';
import { coreOutbox } from '../../services/coreOutbox';
import { useRecoveryStore } from '../../store/recoveryStore';

const input = { habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-10-06', targetDate: '2026-10-09', strategy: 'complete_today' as const };

beforeEach(async () => {
  server.reset();
  coreOutbox.reset();
  await AsyncStorage.clear();
  useRecoveryStore.setState({ plans: [] });
});

it('offline: the plan is listed (also after a refetch) and delivered later with the same id', async () => {
  server.online = false;
  const plan = await useRecoveryStore.getState().addPlan(input);
  expect(plan).not.toBeNull();
  useRecoveryStore.setState({ plans: [] });
  await useRecoveryStore.getState().fetchPlans(); // still offline: the device's own queue answers
  expect(useRecoveryStore.getState().plans.map((p) => p.id)).toEqual([plan!.id]);
  server.online = true;
  await coreOutbox.flush();
  expect(server.plans.get(plan!.id)).toMatchObject({ habit_id: 'h1', status: 'planned' });
});

it('completed offline: gone from the list at once, closed on the server on delivery', async () => {
  const plan = (await useRecoveryStore.getState().addPlan(input))!;
  server.online = false;
  await useRecoveryStore.getState().completePlan(plan.id);
  expect(useRecoveryStore.getState().plans).toEqual([]);
  server.online = true;
  await useRecoveryStore.getState().fetchPlans(); // server still says planned; the queued completion hides it
  expect(useRecoveryStore.getState().plans).toEqual([]);
  await coreOutbox.flush();
  expect(server.plans.get(plan.id)).toMatchObject({ status: 'completed' });
  expect(typeof server.plans.get(plan.id)!.completed_at).toBe('string');
});
