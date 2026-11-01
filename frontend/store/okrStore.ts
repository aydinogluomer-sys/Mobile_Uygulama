import { create } from 'zustand';
import {
  deleteKeyResult,
  deleteObjective,
  fetchOkrs,
  insertKeyResult,
  insertObjective,
  updateKeyResultValue,
  type KeyResultRow,
  type OkrRow,
} from '../repositories/okrRepository';
import { hasPending, newOperationId, overlay } from '../lib/outbox';
import { readCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { coreOutbox } from '../services/coreOutbox';

export type KeyResult = KeyResultRow;
export type OKR = OkrRow & { key_results: KeyResult[] };

export const OKR_OBJECTIVE_ENTITY = 'okr_objective';
export const KEY_RESULT_ENTITY = 'key_result';

type OkrAggregate = { okrs: OkrRow[]; keyResults: KeyResultRow[] };

const okrCacheKey = (quarters?: number) => `okrs:q${quarters ?? 8}`;

async function safeUserId(): Promise<string | null> {
  try {
    return (await currentUser())?.id ?? null;
  } catch {
    return null;
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

export const useOKRStore = create<OKRStore>((set) => ({
  okrs: [],
  loading: false,
  error: null,

  loadOKRs: async (quarters) => {
    await coreOutbox.ensure();
    const uid = await safeUserId();
    const cKey = okrCacheKey(quarters);
    const cached = uid ? await readCachedSnapshot<OkrAggregate>(uid, cKey) : null;
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
  },

  addObjective: async (objective, year, quarter) => {
    const text = objective.trim();
    if (!text) return false;
    const res = await insertObjective({ objective: text, year, quarter });
    if (res.ok) {
      set((s) => ({ okrs: [{ ...res.data, key_results: [] }, ...s.okrs], error: null }));
      return true;
    }
    if (res.offline) {
      const id = newOperationId();
      const uid = (await safeUserId()) ?? '';
      const payload = { objective: text, year, quarter };
      const queued = await coreOutbox.write({ entity: OKR_OBJECTIVE_ENTITY, entityId: id, kind: 'create', payload });
      if (queued.ok) {
        const optimistic: OKR = {
          id,
          user_id: uid,
          ...payload,
          created_at: new Date().toISOString(),
          key_results: [],
        };
        set((s) => ({ okrs: [optimistic, ...s.okrs], error: null }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  addKeyResult: async (okrId, title, target, unit) => {
    const text = title.trim();
    if (!text || !(target > 0)) return false;
    const cleanUnit = unit?.trim() || null;

    await coreOutbox.ensure();
    const box = coreOutbox.state();
    const pendingObjCmd = box?.commands.find(
      (c) => c.entity === OKR_OBJECTIVE_ENTITY && c.entityId === okrId && c.kind === 'create',
    );
    if (pendingObjCmd) {
      const id = newOperationId();
      const uid = (await safeUserId()) ?? '';
      const payload = { okr_id: okrId, title: text, current_value: 0, target_value: target, unit: cleanUnit };
      const queued = await coreOutbox.write({
        entity: KEY_RESULT_ENTITY,
        entityId: id,
        kind: 'create',
        payload,
        dependsOn: [pendingObjCmd.operationId],
      });
      if (!queued.ok) { set({ error: 'Çevrimdışı anahtar sonuç eklenemedi.' }); return false; }
      void coreOutbox.flush();
      const optimistic: KeyResult = { id, user_id: uid, ...payload, created_at: new Date().toISOString() };
      set((s) => ({
        okrs: s.okrs.map((o) => (o.id === okrId ? { ...o, key_results: [...o.key_results, optimistic] } : o)),
        error: null,
      }));
      return true;
    }

    const res = await insertKeyResult({ okrId, title: text, targetValue: target, unit: cleanUnit });
    if (res.ok) {
      set((s) => ({
        okrs: s.okrs.map((o) => (o.id === okrId ? { ...o, key_results: [...o.key_results, res.data] } : o)),
        error: null,
      }));
      return true;
    }
    if (res.offline) {
      const id = newOperationId();
      const uid = (await safeUserId()) ?? '';
      const payload = { okr_id: okrId, title: text, current_value: 0, target_value: target, unit: cleanUnit };
      const queued = await coreOutbox.write({ entity: KEY_RESULT_ENTITY, entityId: id, kind: 'create', payload });
      if (queued.ok) {
        const optimistic: KeyResult = { id, user_id: uid, ...payload, created_at: new Date().toISOString() };
        set((s) => ({
          okrs: s.okrs.map((o) => (o.id === okrId ? { ...o, key_results: [...o.key_results, optimistic] } : o)),
          error: null,
        }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  updateKRValue: async (krId, current) => {
    const safeVal = Number.isFinite(current) ? Math.max(0, current) : 0;
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, KEY_RESULT_ENTITY, krId)) {
      const queued = await coreOutbox.write({ entity: KEY_RESULT_ENTITY, entityId: krId, kind: 'update', payload: { current_value: safeVal } });
      if (!queued.ok) { set({ error: 'Çevrimdışı anahtar sonuç güncellenemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({
        okrs: s.okrs.map((o) => ({
          ...o,
          key_results: o.key_results.map((k) => (k.id === krId ? { ...k, current_value: safeVal } : k)),
        })),
        error: null,
      }));
      return true;
    }

    const res = await updateKeyResultValue(krId, safeVal);
    if (res.ok) {
      set((s) => ({
        okrs: s.okrs.map((o) => ({
          ...o,
          key_results: o.key_results.map((k) => (k.id === krId ? res.data : k)),
        })),
        error: null,
      }));
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: KEY_RESULT_ENTITY, entityId: krId, kind: 'update', payload: { current_value: safeVal } });
      if (queued.ok) {
        set((s) => ({
          okrs: s.okrs.map((o) => ({
            ...o,
            key_results: o.key_results.map((k) => (k.id === krId ? { ...k, current_value: safeVal } : k)),
          })),
          error: null,
        }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  removeObjective: async (id) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, OKR_OBJECTIVE_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: OKR_OBJECTIVE_ENTITY, entityId: id, kind: 'delete' });
      if (!queued.ok) { set({ error: 'Çevrimdışı hedef silinemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({ okrs: s.okrs.filter((o) => o.id !== id), error: null }));
      return true;
    }

    const res = await deleteObjective(id);
    if (res.ok) {
      set((s) => ({ okrs: s.okrs.filter((o) => o.id !== id), error: null }));
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: OKR_OBJECTIVE_ENTITY, entityId: id, kind: 'delete' });
      if (queued.ok) {
        set((s) => ({ okrs: s.okrs.filter((o) => o.id !== id), error: null }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
  },

  removeKR: async (id) => {
    await coreOutbox.ensure();
    const box = coreOutbox.state();
    if (box && hasPending(box, KEY_RESULT_ENTITY, id)) {
      const queued = await coreOutbox.write({ entity: KEY_RESULT_ENTITY, entityId: id, kind: 'delete' });
      if (!queued.ok) { set({ error: 'Çevrimdışı anahtar sonuç silinemedi.' }); return false; }
      void coreOutbox.flush();
      set((s) => ({
        okrs: s.okrs.map((o) => ({ ...o, key_results: o.key_results.filter((k) => k.id !== id) })),
        error: null,
      }));
      return true;
    }

    const res = await deleteKeyResult(id);
    if (res.ok) {
      set((s) => ({
        okrs: s.okrs.map((o) => ({ ...o, key_results: o.key_results.filter((k) => k.id !== id) })),
        error: null,
      }));
      return true;
    }
    if (res.offline) {
      const queued = await coreOutbox.write({ entity: KEY_RESULT_ENTITY, entityId: id, kind: 'delete' });
      if (queued.ok) {
        set((s) => ({
          okrs: s.okrs.map((o) => ({ ...o, key_results: o.key_results.filter((k) => k.id !== id) })),
          error: null,
        }));
        return true;
      }
    }
    set({ error: res.error });
    return false;
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
