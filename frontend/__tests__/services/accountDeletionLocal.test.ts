/**
 * R02.06 / R10.04 — deleting the account clears what THIS DEVICE holds for it,
 * and never silently: the confirmation states how many changes have not
 * reached the server yet.
 *
 * R02.06: "Logout, hesap değişimi, token expiry ve hesap silmede A/B cache ve
 * queue ayrımını uygula. Gönderilmemiş veriyi kullanıcıdan habersiz silme veya
 * diğer hesapla gönderme."
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('../../lib/session', () => require('../helpers/fakeCoreServer').session);
jest.mock('../../repositories/noteRepository', () => require('../helpers/fakeCoreServer').noteRepo);
jest.mock('../../repositories/journalRepository', () => require('../helpers/fakeCoreServer').journalRepo);
/* eslint-enable @typescript-eslint/no-require-imports */
const mockAuth = { deleted: false, signedOut: false, invokeOk: true };
const mockScheduled = { ids: [] as string[] };
jest.mock('../../lib/notifications', () => ({
  listScheduled: async () => mockScheduled.ids.map((identifier) => ({ identifier, data: null })),
  cancelScheduled: async (ids: readonly string[]) => { mockScheduled.ids = mockScheduled.ids.filter((i) => !ids.includes(i)); },
  scheduleRecoveryReminder: jest.fn(), cancelRecoveryReminder: jest.fn(),
}));
// F04: the read cache is wiped through the account registry; these spies say whether it was.
const mockReadCache = { userCleared: [] as string[], allCleared: 0 };
jest.mock('../../lib/localReadCache', () => ({
  ...jest.requireActual('../../lib/localReadCache'),
  clearUserReadCache: async (uid: string) => { mockReadCache.userCleared.push(uid); },
  clearAllReadCache: async () => { mockReadCache.allCleared += 1; },
}));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 't' } } }),
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      signOut: async () => { mockAuth.signedOut = true; return { error: null }; },
    },
    functions: { invoke: async () => { mockAuth.deleted = mockAuth.invokeOk; return mockAuth.invokeOk ? { data: { ok: true }, error: null } : { data: null, error: { message: 'x' } }; } },
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { server } from '../helpers/fakeCoreServer';
import { coreOutbox } from '../../services/coreOutbox';
import { deleteAccount, unsentChangeCount } from '../../services/accountService';
import { useNoteStore } from '../../store/noteStore';
import { useJournalStore } from '../../store/journalStore';
import { createOutboxChannel } from '../../services/outboxChannel';
import { memoryOutboxStorage, outboxKey } from '../../lib/outboxStorage';

beforeEach(async () => {
  server.reset();
  coreOutbox.reset();
  await AsyncStorage.clear();
  Object.assign(mockAuth, { deleted: false, signedOut: false, invokeOk: true });
  mockReadCache.userCleared = [];
  mockReadCache.allCleared = 0;
  useNoteStore.setState({ notes: [] });
  useJournalStore.setState({ entries: [] });
});

it('unsent changes are counted, so the confirmation can say how many will go with the account', async () => {
  server.online = false;
  await useNoteStore.getState().addNote('a', 'b');
  await useJournalStore.getState().saveEntry('2026-10-08', 'x', 3);
  expect(unsentChangeCount()).toBe(2);
});

it('after the server confirms deletion: no outbox on the device, nothing in memory', async () => {
  server.online = false;
  await useNoteStore.getState().addNote('gizli', 'not');
  await useJournalStore.getState().saveEntry('2026-10-08', 'günlük', 3);
  await AsyncStorage.setItem('app_theme_dark', '1');
  expect((await AsyncStorage.getAllKeys()).some((k) => k.startsWith('outbox.v1.core.'))).toBe(true);

  const res = await deleteAccount();
  expect(res).toEqual({ ok: true, data: true });
  const keys = await AsyncStorage.getAllKeys();
  expect(keys.filter((k) => k.startsWith('outbox.'))).toEqual([]);
  expect(keys).toEqual(['app_theme_dark']); // a display preference is all that stays
  expect(coreOutbox.state()).toBeNull();
  expect(useNoteStore.getState().notes).toEqual([]);
  expect(useJournalStore.getState().entries).toEqual([]);
  expect(unsentChangeCount()).toBe(0);
  expect(mockAuth.signedOut).toBe(true);
});

it('R10.04: no reminder of the deleted account fires again; runner and mood memory are gone', async () => {
  const { useRoutineRunnerStore } = jest.requireActual('../../store/routineRunnerStore');
  const { useMoodStore } = jest.requireActual('../../store/moodStore');
  mockScheduled.ids = ['h:h1:2026-10-09:09:00', 'recovery-p1', 'snooze-x'];
  useRoutineRunnerStore.setState({ userId: 'u1', history: [{ id: 'x' }] });
  useMoodStore.setState({ userId: 'u1', checkins: [{ id: 'c' }] });
  expect((await deleteAccount()).ok).toBe(true);
  expect(mockScheduled.ids).toEqual([]);
  expect(useRoutineRunnerStore.getState()).toMatchObject({ userId: null, history: [], session: null });
  expect(useMoodStore.getState()).toMatchObject({ userId: null, checkins: [] });
});

it('a refused deletion clears nothing (the unsent work is still there)', async () => {
  server.online = false;
  await useNoteStore.getState().addNote('kalsın', 'x');
  mockAuth.invokeOk = false;
  mockScheduled.ids = ['h:h1:2026-10-09:09:00'];
  const res = await deleteAccount();
  expect(res.ok).toBe(false);
  expect(mockScheduled.ids).toEqual(['h:h1:2026-10-09:09:00']); // reminders untouched
  expect(unsentChangeCount()).toBe(1);
  expect((await AsyncStorage.getAllKeys()).some((k) => k.startsWith('outbox.v1.core.'))).toBe(true);
});

it('reset mid-delivery: a later command still queued is not written back either', async () => {
  const storage = memoryOutboxStorage();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const ch = createOutboxChannel({
    storage,
    // e1 lands after the reset; e2 would then be left pending (offline) and SAVED without the guard
    transports: { x: async (c) => { if (c.entityId === 'e1') { await gate; return { kind: 'applied' }; } return { kind: 'offline' }; } },
    currentUserId: async () => 'u1',
  });
  await ch.write({ entity: 'x', entityId: 'e1', kind: 'create', payload: {} });
  await ch.write({ entity: 'y', entityId: 'e2', kind: 'create', payload: {} });
  await new Promise((r) => setTimeout(r, 0));
  ch.reset();
  storage.raw.clear();
  release();
  await ch.flush();
  await new Promise((r) => setTimeout(r, 0));
  expect(storage.raw.has(outboxKey('u1'))).toBe(false);
});

it('a delivery still running when the account is reset never writes the old outbox back', async () => {
  const storage = memoryOutboxStorage();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const ch = createOutboxChannel({
    storage,
    transports: { x: async () => { await gate; return { kind: 'applied' }; } },
    currentUserId: async () => 'u1',
  });
  await ch.write({ entity: 'x', entityId: 'e1', kind: 'create', payload: {} });
  await ch.write({ entity: 'x', entityId: 'e2', kind: 'create', payload: {} });
  const flushing = ch.flush();
  // account deleted mid-delivery: memory reset, device copy removed
  ch.reset();
  storage.raw.clear();
  release();
  await flushing;
  // nothing of the old queue comes back: not on the device, not in memory
  const saved = storage.raw.get(outboxKey('u1'));
  expect(saved === undefined || JSON.parse(saved).state.commands.length === 0).toBe(true);
  expect(ch.state()?.commands ?? []).toEqual([]);
});

describe('F04 (SYN-07, SYN-08): deletion goes through the account registry', () => {
  it("after the server confirms: this user's read cache and every user's are wiped; other stores are empty too", async () => {
    const { useHabitStore } = jest.requireActual('../../store/habitStore');
    const { useGoalStore } = jest.requireActual('../../store/goalStore');
    useHabitStore.setState({ habits: [{ id: 'h-A', name: 'A habit' }] });
    useGoalStore.setState({ goals: [{ id: 'g-A', title: 'A goal' }] });

    expect((await deleteAccount()).ok).toBe(true);
    expect(mockReadCache.userCleared).toEqual(['u1']);
    expect(mockReadCache.allCleared).toBe(1);
    expect(useHabitStore.getState().habits).toEqual([]);
    expect(useGoalStore.getState().goals).toEqual([]);
  });

  it('a refused deletion wipes no cache', async () => {
    mockAuth.invokeOk = false;
    expect((await deleteAccount()).ok).toBe(false);
    expect(mockReadCache.userCleared).toEqual([]);
    expect(mockReadCache.allCleared).toBe(0);
  });

  it('F19 (SYN-04): sweeps both outbox and habit syncQueue quarantine keys on confirmed account deletion', async () => {
    await AsyncStorage.setItem('outbox.v1.u1.quarantine.1', '{"corrupt":true}');
    await AsyncStorage.setItem('atlas_sync_queue_v1:u1.quarantine.2', '{"corrupt":true}');
    await AsyncStorage.setItem('app_theme_dark', '1');

    expect((await deleteAccount()).ok).toBe(true);
    const remaining = await AsyncStorage.getAllKeys();
    expect(remaining).toEqual(['app_theme_dark']);
  });

  it('F29 (STO-03): sweeps aderyth:day_close:v1:<uid> on confirmed deletion and preserves it when server deletion fails', async () => {
    const { endAccountScope } = jest.requireActual('../../lib/accountScope') as typeof import('../../lib/accountScope');
    const { dayCloseKey, saveDayClose } = jest.requireActual('../../lib/dayClose') as typeof import('../../lib/dayClose');
    await saveDayClose('u1', {
      v: 1,
      date: '2026-11-02',
      movedCount: 2,
      easedCount: 1,
      closedAt: '2026-11-02T22:00:00.000Z',
    });
    await endAccountScope('account_deleted', 'u1');
    expect(await AsyncStorage.getItem(dayCloseKey('u1'))).toBeNull();

    await saveDayClose('u1', {
      v: 1,
      date: '2026-11-02',
      movedCount: 2,
      easedCount: 1,
      closedAt: '2026-11-02T22:00:00.000Z',
    });
    await AsyncStorage.setItem('app_theme_dark', '1');

    // Negative: server refuses deletion -> dayClose record stays intact
    mockAuth.invokeOk = false;
    expect((await deleteAccount()).ok).toBe(false);
    expect(await AsyncStorage.getItem(dayCloseKey('u1'))).not.toBeNull();

    // Positive: server confirms deletion -> dayClose key is gone
    mockAuth.invokeOk = true;
    expect((await deleteAccount()).ok).toBe(true);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).not.toContain(dayCloseKey('u1'));
    expect(keys).toEqual(['app_theme_dark']);
  });

  it('F37: sweeps aderyth:time_capsules:v1:<uid> and moods.v1.<uid> (with energy) on confirmed deletion and keeps them when refused', async () => {
    await AsyncStorage.setItem(
      'aderyth:time_capsules:v1:u1',
      JSON.stringify({ v: 1, items: [{ id: 'c1', text: 'Sabret', day: '2026-11-01', createdAt: '2026-11-01T10:00:00.000Z' }] }),
    );
    await AsyncStorage.setItem(
      'moods.v1.u1',
      JSON.stringify({ v: 1, definitions: [], checkins: [{ id: 'm1', at: '2026-11-02T09:00:00.000Z', day: '2026-11-02', moodId: 'builtin-2', label: 'Yorgun', valence: 2, intensity: 2, energy: 'low' }] }),
    );
    await AsyncStorage.setItem('app_theme_dark', '1');

    // Negative: server refuses deletion -> local capsule and mood keys remain intact
    mockAuth.invokeOk = false;
    expect((await deleteAccount()).ok).toBe(false);
    expect(await AsyncStorage.getItem('aderyth:time_capsules:v1:u1')).not.toBeNull();
    expect(await AsyncStorage.getItem('moods.v1.u1')).not.toBeNull();

    // Positive: server confirms deletion -> both keys are removed
    mockAuth.invokeOk = true;
    expect((await deleteAccount()).ok).toBe(true);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).not.toContain('aderyth:time_capsules:v1:u1');
    expect(keys).not.toContain('moods.v1.u1');
    expect(keys).toEqual(['app_theme_dark']);
  });
});
