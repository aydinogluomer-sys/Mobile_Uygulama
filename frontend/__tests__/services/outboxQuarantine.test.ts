/**
 * F19 (SYN-04) — unreadable, wrong-version, foreign-account, or partially
 * corrupt outbox and habit syncQueue blobs are quarantined instead of
 * silently overwritten; legacy queue migration deletes the legacy key only
 * after the adopted queue is durably saved.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyOutbox, enqueue, type OutboxCommand } from '../../lib/outbox';
import {
  asyncStorageOutboxNs,
  countQuarantined,
  namespacedOutboxKey,
  OUTBOX_QUARANTINE_SLOTS,
  OUTBOX_VERSION,
} from '../../lib/outboxStorage';
import {
  emptyQueueState,
  enqueue as enqueueHabitOp,
  loadSyncQueue,
  saveSyncQueue,
  type SyncQueueState,
} from '../../lib/syncQueue';
import { createOutboxChannel } from '../../services/outboxChannel';

describe('F19 (SYN-04) — outboxStorage & syncQueue quarantine', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  const coreStorage = asyncStorageOutboxNs('core');
  const coreKeyU1 = namespacedOutboxKey('core', 'u1');

  function makeValidOutbox(userId: string, count: number) {
    let state = emptyOutbox(userId);
    for (let i = 0; i < count; i += 1) {
      const r = enqueue(
        state,
        {
          operationId: `op-${i}`,
          entity: 'goal',
          entityId: `g-${i}`,
          kind: 'create',
          payload: { title: `Goal ${i}` },
        },
        userId,
        1_000 + i,
      );
      if (!r.ok) throw new Error(r.reason);
      state = r.state;
    }
    return state;
  }

  describe('outboxStorage quarantine', () => {
    it('moves unreadable JSON to a .quarantine.<ts> key, clears primary key, returns empty outbox, and preserves quarantine across later saves', async () => {
      await AsyncStorage.setItem(coreKeyU1, '{{{corrupt-json');

      const loaded = await coreStorage.load('u1');
      expect(loaded).toEqual(emptyOutbox('u1'));
      expect(await AsyncStorage.getItem(coreKeyU1)).toBeNull();

      const qKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${coreKeyU1}.quarantine.`));
      expect(qKeys).toHaveLength(1);
      expect(await AsyncStorage.getItem(qKeys[0])).toBe('{{{corrupt-json');

      // Subsequent save writes clean primary blob without touching quarantine
      const next = makeValidOutbox('u1', 1);
      await coreStorage.save(next);
      expect(await AsyncStorage.getItem(qKeys[0])).toBe('{{{corrupt-json');
      expect((await coreStorage.load('u1')).commands).toHaveLength(1);
    });

    it('quarantines blobs with an unsupported version (v: 2) or belonging to another account', async () => {
      const v2Raw = JSON.stringify({ v: 2, state: makeValidOutbox('u1', 2) });
      await AsyncStorage.setItem(coreKeyU1, v2Raw);
      expect(await coreStorage.load('u1')).toEqual(emptyOutbox('u1'));
      expect(await AsyncStorage.getItem(coreKeyU1)).toBeNull();

      const foreignRaw = JSON.stringify({ v: OUTBOX_VERSION, state: makeValidOutbox('u2', 1) });
      await AsyncStorage.setItem(coreKeyU1, foreignRaw);
      expect(await coreStorage.load('u1')).toEqual(emptyOutbox('u1'));
      expect(await AsyncStorage.getItem(coreKeyU1)).toBeNull();

      const qKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${coreKeyU1}.quarantine.`)).sort();
      expect(qKeys.length).toBeGreaterThanOrEqual(1);
    });

    it('salvages 40 valid commands when 1 of 41 is malformed, and quarantines the rejected command', async () => {
      const valid40 = makeValidOutbox('u1', 40);
      const malformed = { operationId: 'bad-op', entity: 'goal', kind: 'invalid_kind', payload: null } as unknown as OutboxCommand;
      const mixedBlob = JSON.stringify({
        v: OUTBOX_VERSION,
        state: { ...valid40, commands: [...valid40.commands.slice(0, 20), malformed, ...valid40.commands.slice(20)] },
      });
      await AsyncStorage.setItem(coreKeyU1, mixedBlob);

      const loaded = await coreStorage.load('u1');
      expect(loaded.commands).toHaveLength(40);
      expect(loaded.commands.every((c) => c.operationId !== 'bad-op')).toBe(true);

      const qKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${coreKeyU1}.quarantine.`));
      expect(qKeys).toHaveLength(1);
      const qPayload = JSON.parse((await AsyncStorage.getItem(qKeys[0]))!);
      expect(qPayload).toEqual({ reason: 'commands', commands: [malformed] });
    });

    it('bounds quarantine slots per base key to OUTBOX_QUARANTINE_SLOTS (evicts oldest)', async () => {
      let fakeNow = 10_000;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => ++fakeNow);
      try {
        for (let i = 1; i <= OUTBOX_QUARANTINE_SLOTS + 2; i += 1) {
          await AsyncStorage.setItem(coreKeyU1, `{corrupt-${i}`);
          await coreStorage.load('u1');
        }
        const qKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${coreKeyU1}.quarantine.`)).sort();
        expect(qKeys).toHaveLength(OUTBOX_QUARANTINE_SLOTS);
        const contents = await Promise.all(qKeys.map((k) => AsyncStorage.getItem(k)));
        expect(contents).toEqual(['{corrupt-3', '{corrupt-4', '{corrupt-5']);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('refuses to overwrite primary key when quarantine write fails (savedOnDevice: false), then recovers once storage works', async () => {
      await AsyncStorage.setItem(coreKeyU1, '{{{precious-unreadable-blob');

      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('QuotaExceededError'));

      const ch = createOutboxChannel({
        storage: coreStorage,
        transports: { goal: async () => ({ kind: 'offline' }) },
        currentUserId: async () => 'u1',
      });

      // First write triggers load -> quarantineBlob fails -> saveGuarded refuses to overwrite!
      const firstWrite = await ch.write({ entity: 'goal', entityId: 'g-new', kind: 'create', payload: { title: 'New' } });
      expect(firstWrite).toMatchObject({ ok: true, savedOnDevice: false });
      expect(await AsyncStorage.getItem(coreKeyU1)).toBe('{{{precious-unreadable-blob');

      // Storage recovers (`mockRejectedValueOnce` consumed); reset channel memory and reload
      ch.reset();
      const secondWrite = await ch.write({ entity: 'goal', entityId: 'g-after', kind: 'create', payload: { title: 'After' } });
      expect(secondWrite).toMatchObject({ ok: true, savedOnDevice: true });

      const qKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${coreKeyU1}.quarantine.`));
      expect(qKeys).toHaveLength(1);
      expect(await AsyncStorage.getItem(qKeys[0])).toBe('{{{precious-unreadable-blob');
    });
  });

  describe('habit syncQueue quarantine & legacy migration', () => {
    function makeValidHabitQueue(count: number, userId?: string): SyncQueueState {
      let q = emptyQueueState();
      for (let i = 0; i < count; i += 1) {
        q = enqueueHabitOp(q, `h-${i}`, '2026-10-08', { state: 'done' }, { id: `hop-${i}`, now: 1_000 + i, userId }).state;
      }
      return q;
    }

    it('quarantines corrupt JSON in habit queue and returns an empty queue', async () => {
      await AsyncStorage.setItem('atlas_sync_queue_v1:u1', 'not-valid-json[');
      const loaded = await loadSyncQueue('u1');
      expect(loaded).toEqual(emptyQueueState());
      expect(await AsyncStorage.getItem('atlas_sync_queue_v1:u1')).toBeNull();

      const qKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('atlas_sync_queue_v1:u1.quarantine.'));
      expect(qKeys).toHaveLength(1);
      expect(await AsyncStorage.getItem(qKeys[0])).toBe('not-valid-json[');
    });

    it('salvages 4 valid ops when 1 of 5 is invalid, and quarantines the rejected op', async () => {
      const valid4 = makeValidHabitQueue(4, 'u1');
      const badOp = { id: 'bad', habitId: 'h-bad', date: 'not-a-date', intent: { state: 'done' } };
      await AsyncStorage.setItem(
        'atlas_sync_queue_v1:u1',
        JSON.stringify({ nextSeq: 10, ops: [...valid4.ops.slice(0, 2), badOp, ...valid4.ops.slice(2)] }),
      );

      const loaded = await loadSyncQueue('u1');
      expect(loaded.ops).toHaveLength(4);
      expect(loaded.ops.map((o) => o.id)).toEqual(['hop-0', 'hop-1', 'hop-2', 'hop-3']);

      const qKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('atlas_sync_queue_v1:u1.quarantine.'));
      expect(qKeys).toHaveLength(1);
      expect(JSON.parse((await AsyncStorage.getItem(qKeys[0]))!)).toEqual({ reason: 'ops', ops: [badOp] });
    });

    it('legacy key migration keeps atlas_sync_queue_v1 if saveSyncQueue fails, and removes it once saveSyncQueue succeeds', async () => {
      const legacyQueue = makeValidHabitQueue(2);
      const legacyRaw = JSON.stringify(legacyQueue);
      await AsyncStorage.setItem('atlas_sync_queue_v1', legacyRaw);

      const realSetItem = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
      (AsyncStorage.setItem as jest.Mock).mockImplementation(async (k: string, v: string) => {
        if (k === 'atlas_sync_queue_v1:u1') throw new Error('disk full');
        return realSetItem(k, v);
      });
      try {
        const firstLoad = await loadSyncQueue('u1');
        expect(firstLoad.ops).toHaveLength(2);
        // Save failed -> legacy key MUST NOT be deleted yet!
        expect(await AsyncStorage.getItem('atlas_sync_queue_v1')).toBe(legacyRaw);
      } finally {
        (AsyncStorage.setItem as jest.Mock).mockImplementation(realSetItem);
      }

      const secondLoad = await loadSyncQueue('u1');
      expect(secondLoad.ops).toHaveLength(2);
      expect(await AsyncStorage.getItem('atlas_sync_queue_v1')).toBeNull();
      expect(await AsyncStorage.getItem('atlas_sync_queue_v1:u1')).not.toBeNull();
    });

    it('countQuarantined sums outbox and habit queue quarantine entries for that user only, and healthy storage produces 0', async () => {
      expect(await countQuarantined('u1')).toBe(0);

      // Valid blobs produce 0 quarantine entries
      await coreStorage.save(makeValidOutbox('u1', 2));
      await saveSyncQueue(makeValidHabitQueue(2, 'u1'), 'u1');
      await coreStorage.load('u1');
      await loadSyncQueue('u1');
      expect(await countQuarantined('u1')).toBe(0);

      // 1 outbox quarantine + 1 habit queue quarantine for u1, plus 1 for u2
      await AsyncStorage.setItem(coreKeyU1, 'bad-core-u1');
      await coreStorage.load('u1');
      await AsyncStorage.setItem('atlas_sync_queue_v1:u1', 'bad-habit-u1');
      await loadSyncQueue('u1');
      await AsyncStorage.setItem(namespacedOutboxKey('core', 'u2'), 'bad-core-u2');
      await coreStorage.load('u2');

      expect(await countQuarantined('u1')).toBe(2);
      expect(await countQuarantined('u2')).toBe(1);
    });
  });
});
