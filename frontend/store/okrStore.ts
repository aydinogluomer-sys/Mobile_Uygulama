import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import {
  deleteKeyResult,
  deleteObjective,
  fetchOkrs,
  insertKeyResultWithId,
  insertObjectiveWithId,
  updateKeyResultValue,
  type KeyResultRow,
  type OkrRow,
} from '../repositories/okrRepository';
import { createLatest } from '../lib/latestOnly';
import { serialByKey } from '../lib/serialByKey';
import { newOperationId, overlay } from '../lib/outbox';
import { safeUserIdOf, writeThrough } from '../lib/outboxEngine';
import { invalidateCachedSnapshot, readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export type KeyResult = KeyResultRow;
export type OKR = OkrRow & { key_results: KeyResult[] };

export const OKR_OBJECTIVE_ENTITY = 'okr_objective';
export const KEY_RESULT_ENTITY = 'key_result';
const DEVICE_SAVE_WARNING = 'Değişiklik cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.';

type OkrAggregate = { okrs: OkrRow[]; keyResults: KeyResultRow[] };

const okrCacheKey = (quarters?: number) => `okrs:q${quarters ?? 8}`;
const okrLatest = createLatest();
const OKR_CACHE_KEYS = ['okrs:q4', 'okrs:q8'] as const;
let activeQuarters: number | undefined;

const safeUserId = (): Promise<string | null> => safeUserIdOf(currentUser);

function snapshotOf(okrs: OKR[]): OkrAggregate {
  return { okrs: okrs.map(({ key_results: _keyResults, ...o }) => o), keyResults: okrs.flatMap((o) => o.key_results) };
}

async function persistOkrSnapshot(okrs: OKR[]): Promise<void> {
  const uid = await safeUserId();
  if (!uid) return;
  const key = okrCacheKey(activeQuarters);
  await setCachedSnapshot(uid, key, snapshotOf(okrs));
  // Başka pencereli anahtarlar bu değişikliği içermez: soğuk açılışta yanlış sonuç vermesinler.
  for (const other of OKR_CACHE_KEYS) {
    if (other !== key) await invalidateCachedSnapshot(uid, other);
  }
}

function assembleOkrs(data: OkrAggregate): OKR[] {
  const box = coreOutbox.state();
  const objectives = box ? overlay(box, OKR_OBJECTIVE_ENTITY, data.okrs) : data.okrs;
  const krs = box ? overlay(box, KEY_RESULT_ENTITY, data.keyResults) : data.keyResults;
  const byOkr: Record<string, KeyResult[]> = {};
  for (const kr of krs) (byOkr[kr.okr_id] ??= []).push(kr);
  return objectives.map((o) => ({ ...o, key_results: byOkr[o.id] ?? [] }));
}

/**
 * OKRs.
 *
 * ## What the move fixed
 *
 * This store had the most direct database calls of any (5) and the loosest
 * ones. `loadOKRs` fetched both `okrs` and `key_results` with **no user
 * filter and no bound** — every row RLS would hand back, forever. The four
 * mutations matched on `id` alone and discarded their results.
 *
 * `addKeyResult` also attached a key result to an arbitrary `okrId` without
 * checking that the objective belonged to the caller. That is the same shape
 * of gap the live RLS audit found on `habit_logs`, and the repository now
 * verifies ownership before inserting.
 *
 * The two tables load together because they are one aggregate; the objective
 * list is bounded by quarter count, which is the natural window for this
 * screen (there is no "load more objectives" gesture).
 */
type OKRStore = {
  okrs: OKR[];
  loading: boolean;
  error: string | null;
  loadOKRs: (quarters?: number) => Promise<void>;
  addObjective: (objective: string, year: number, quarter: number) => Promise<boolean>;
  addKeyResult: (okrId: string, title: string, target: number, unit: string | null) => Promise<boolean>;
  updateKRValue: (krId: string, current: number) => Promise<boolean>;
  removeObjective: (id: string) => Promise<boolean>;
  removeKR: (id: string) => Promise<boolean>;
};

type OkrSet = (partial: Partial<OKRStore> | ((s: OKRStore) => Partial<OKRStore>)) => void;
function commit(set: OkrSet, get: () => OKRStore, updater: (s: OKRStore) => Partial<OKRStore>): void {
  set(updater);
  void persistOkrSnapshot(get().okrs);
}

export const useOKRStore = create<OKRStore>((set, get) => ({
  okrs: [],
  loading: false,
  error: null,

  loadOKRs: async (quarters) => {
    const run = okrLatest.begin();
    activeQuarters = quarters;
    try {
      await coreOutbox.ensure();
      if (!run.isCurrent()) return;
      const uid = await safeUserId();
      if (!run.isCurrent()) return;
      const cKey = okrCacheKey(quarters);
      const cached = uid ? await readCachedSnapshot<OkrAggregate>(uid, cKey) : null;
      if (!run.isCurrent()) return;
      if (cached) {
        set({
          okrs: assembleOkrs(cached.data),
          loading: false,
          error: null,
        });
      } else {
        set({ loading: true, error: null });
      }

      const res = await fetchOkrs({ quarters });
      if (!run.isCurrent()) return;
      if (!res.ok) {
        if (cached) {
          set({ loading: false, error: res.offline ? null : res.error });
        } else {
          set({ loading: false, error: res.error });
        }
        return;
      }
      if (uid) {
        void setCachedSnapshot(uid, cKey, res.data);
      }
      set({
        okrs: assembleOkrs(res.data),
        loading: false,
        error: null,
      });
    } finally {
      run.done();
      if (okrLatest.pending() === 0 && get().loading) set({ loading: false });
    }
  },

  addObjective: async (objective, year, quarter) => {
    const text = objective.trim();
    if (!text) return false;
    const id = newOperationId();
    const payload = { objective: text, year, quarter };

    const res = await writeThrough({
      channel: coreOutbox,
      entity: OKR_OBJECTIVE_ENTITY,
      entityId: id,
      kind: 'create',
      payload,
      online: () => insertObjectiveWithId({ id, ...payload }),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }

    const row: OKR =
      res.via === 'online'
        ? { ...res.row, key_results: [] }
        : {
            id,
            user_id: res.userId ?? '',
            ...payload,
            created_at: new Date().toISOString(),
            key_results: [],
          };
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    commit(set, get, (s) => ({ okrs: [row, ...s.okrs], error }));
    return true;
  },

  addKeyResult: async (okrId, title, target, unit) => {
    const text = title.trim();
    if (!text || !(target > 0)) return false;
    const cleanUnit = unit?.trim() || null;
    const id = newOperationId();
    const payload = { okr_id: okrId, title: text, current_value: 0, target_value: target, unit: cleanUnit };

    await coreOutbox.ensure();
    const box = coreOutbox.state();
    const pendingObjCmd = box?.commands.find(
      (c) => c.entity === OKR_OBJECTIVE_ENTITY && c.entityId === okrId && c.kind === 'create',
    );

    const res = await writeThrough({
      channel: coreOutbox,
      entity: KEY_RESULT_ENTITY,
      entityId: id,
      kind: 'create',
      payload,
      ...(pendingObjCmd ? { dependsOn: [pendingObjCmd.operationId] } : {}),
      online: () => insertKeyResultWithId({ id, ...payload }),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: pendingObjCmd ? 'Çevrimdışı anahtar sonuç eklenemedi.' : res.error });
      return false;
    }

    const row: KeyResult =
      res.via === 'online'
        ? res.row
        : { id, user_id: res.userId ?? '', ...payload, created_at: new Date().toISOString() };
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    commit(set, get, (s) => ({
      okrs: s.okrs.map((o) => (o.id === okrId ? { ...o, key_results: [...o.key_results, row] } : o)),
      error,
    }));
    return true;
  },

  updateKRValue: (krId, current) =>
    serialByKey(`kr:${krId}`, async () => {
      const safeVal = Number.isFinite(current) ? Math.max(0, current) : 0;
      const res = await writeThrough({
        channel: coreOutbox,
        entity: KEY_RESULT_ENTITY,
        entityId: krId,
        kind: 'update',
        payload: { current_value: safeVal },
        online: () => updateKeyResultValue(krId, safeVal),
        userId: safeUserId,
      });
      if (!res.ok) {
        set({ error: res.error });
        return false;
      }

      const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
      commit(set, get, (s) => ({
        okrs: s.okrs.map((o) => ({
          ...o,
          key_results: o.key_results.map((k) =>
            k.id === krId ? (res.via === 'online' ? res.row : { ...k, current_value: safeVal }) : k,
          ),
        })),
        error,
      }));
      return true;
    }),

  removeObjective: async (id) => {
    const res = await writeThrough({
      channel: coreOutbox,
      entity: OKR_OBJECTIVE_ENTITY,
      entityId: id,
      kind: 'delete',
      online: () => deleteObjective(id),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    commit(set, get, (s) => ({ okrs: s.okrs.filter((o) => o.id !== id), error }));
    return true;
  },

  removeKR: async (id) => {
    const res = await writeThrough({
      channel: coreOutbox,
      entity: KEY_RESULT_ENTITY,
      entityId: id,
      kind: 'delete',
      online: () => deleteKeyResult(id),
      userId: safeUserId,
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    const error = res.via === 'outbox' && !res.savedOnDevice ? DEVICE_SAVE_WARNING : null;
    commit(set, get, (s) => ({
      okrs: s.okrs.map((o) => ({ ...o, key_results: o.key_results.filter((k) => k.id !== id) })),
      error,
    }));
    return true;
  },
}));

export function krProgress(kr: KeyResult): number {
  if (!(kr.target_value > 0)) return 0;
  return Math.min(100, Math.round((kr.current_value / kr.target_value) * 100));
}

export function objectiveProgress(okr: OKR): number {
  if (okr.key_results.length === 0) return 0;
  const sum = okr.key_results.reduce((a, k) => a + krProgress(k), 0);
  return Math.round(sum / okr.key_results.length);
}

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'okr', store: useOKRStore });
