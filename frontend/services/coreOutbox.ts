/**
 * R02.03 / R02.05 / F46 — the outbox for the core records that are not tasks:
 * journal entries, notes, recovery plans, focus sessions, goals, projects,
 * reading list items, OKR objectives/key results, and life area check-ins.
 */
import { registerAccountScoped } from '../lib/accountScope';
import { ENTITY_POLICIES, outboxEngine } from '../lib/outboxEngine';
import { classifyFailure, type Transport } from './outboxRunner';
import { createOutboxChannel, type OutboxChannel } from './outboxChannel';
import { asyncStorageOutboxNs, namespacedOutboxKey } from '../lib/outboxStorage';
import type { DeliveryOutcome, EnqueueInput, OutboxCommand } from '../lib/outbox';
import type { WriteOptions } from '../lib/outboxEngine';
import { clearReadCacheMemory } from '../lib/localReadCache';
import { currentUser } from '../lib/session';
import { fetchJournalEntry, JOURNAL_CAS_MISMATCH, upsertJournalEntry } from '../repositories/journalRepository';
import { insertNoteWithId, updateNoteVersioned, fetchNoteRow, deleteNoteIfPresent, type NoteRow } from '../repositories/noteRepository';
import { insertRecoveryPlanRow, updateRecoveryPlanRow, deleteRecoveryPlanIfPresent } from '../repositories/recoveryRepository';
import { insertFocusSessionRow } from '../repositories/focusSessionRepository';
import { creditFocusTaskForSession } from '../repositories/focusTaskRepository';
import { insertGoalWithId, updateGoalOwned, deleteGoalIfPresent, type GoalKind } from '../repositories/goalRepository';
import { insertProjectWithId, updateProjectOwned, deleteProjectIfPresent } from '../repositories/projectRepository';
import { insertReadingItemWithId, updateReadingItemOwned, deleteReadingItemIfPresent, type ReadingStatus, type ReadingType } from '../repositories/readingListRepository';
import {
  insertObjectiveWithId, insertKeyResultWithId, updateKeyResultOwned,
  deleteObjectiveIfPresent, deleteKeyResultIfPresent,
} from '../repositories/okrRepository';
import { upsertLifeAreaLogs } from '../repositories/lifeAreaRepository';

export const CORE_OUTBOX_NAMESPACE = 'core';

export function contentVersion(text: string | null | undefined): string {
  const s = text ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `c${s.length}:${h.toString(16)}`;
}

const applied = (version?: string | null): DeliveryOutcome => ({ kind: 'applied', version: version ?? null });

const JOURNAL_CAS_ROUNDS = 3;

export const journalTransport: Transport = async (cmd) => {
  const p = cmd.payload as { content: string; mood?: number | null; ai_summary?: boolean };
  for (let round = 0; round < JOURNAL_CAS_ROUNDS; round += 1) {
    const cur = await fetchJournalEntry(cmd.entityId);
    if (!cur.ok) return classifyFailure(cur);
    const server = cur.data?.content ?? '';
    if (server.trim() !== '' && server !== p.content && contentVersion(server) !== (cmd.baseVersion ?? contentVersion(''))) {
      return { kind: 'conflict', error: 'Bu günün kaydı başka bir yerde değiştirilmiş.' };
    }
    const res = await upsertJournalEntry(
      { date: cmd.entityId, content: p.content, mood: p.mood ?? null, aiSummary: p.ai_summary },
      cmd.userId,
      { baseContent: cur.data ? cur.data.content : null },
    );
    if (res.ok) return applied(contentVersion(res.data.content));
    if (res.code === JOURNAL_CAS_MISMATCH || res.code === '23505') continue;
    return classifyFailure(res);
  }
  return { kind: 'conflict', error: 'Bu günün kaydı sürekli değişiyor; iki sürüm korunuyor.' };
};

const holds = (row: NoteRow, payload: Record<string, unknown>) =>
  Object.entries(payload).every(([k, v]) => k === 'updated_at' || JSON.stringify((row as Record<string, unknown>)[k]) === JSON.stringify(v));

export const noteTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const p = cmd.payload as { title: string; content: string; tags?: string[] };
    const res = await insertNoteWithId({ id: cmd.entityId, title: p.title, content: p.content, tags: p.tags ?? [] }, cmd.userId);
    if (res.ok) return applied(res.data.updated_at);
    if (res.code === '23505') {
      const cur = await fetchNoteRow(cmd.entityId);
      return cur.ok && cur.data ? applied(cur.data.updated_at) : applied();
    }
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateNoteVersioned(cmd.entityId, { ...cmd.payload, updated_at: new Date().toISOString() }, cmd.baseVersion, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    if (!res.data.exists) return { kind: 'gone' };
    if (!res.data.row) {
      const cur = await fetchNoteRow(cmd.entityId);
      if (!cur.ok) return classifyFailure(cur);
      if (!cur.data) return { kind: 'gone' };
      if (holds(cur.data, cmd.payload)) return applied(cur.data.updated_at);
      return { kind: 'conflict', error: 'Bu not başka bir yerde değiştirilmiş.' };
    }
    return applied(res.data.row.updated_at);
  }
  const res = await deleteNoteIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const recoveryPlanTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const res = await insertRecoveryPlanRow({ ...cmd.payload, id: cmd.entityId }, cmd.userId);
    if (res.ok || res.code === '23505') return applied();
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateRecoveryPlanRow(cmd.entityId, cmd.payload, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    return res.data.exists ? applied() : { kind: 'gone' };
  }
  const res = await deleteRecoveryPlanIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const focusSessionTransport: Transport = async (cmd: OutboxCommand) => {
  if (cmd.kind !== 'create') return { kind: 'rejected', error: 'a focus session is only ever created' };
  const res = await insertFocusSessionRow({ ...cmd.payload, id: cmd.entityId }, cmd.userId);
  if (res.ok) { await creditFocusTaskForSession(cmd.payload); return applied(); }
  if (res.code === '23505') return applied();
  return classifyFailure(res);
};

export const goalTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const p = cmd.payload as {
      kind: GoalKind;
      title: string;
      progress?: number;
      year?: number | null;
      quarter?: number | null;
      month?: number | null;
      archived?: boolean;
    };
    const res = await insertGoalWithId({ ...p, id: cmd.entityId }, cmd.userId);
    if (res.ok || res.code === '23505') return applied();
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateGoalOwned(cmd.entityId, cmd.payload, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    return res.data.exists ? applied() : { kind: 'gone' };
  }
  const res = await deleteGoalIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const projectTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const p = cmd.payload as {
      name: string;
      color?: string | null;
      description?: string | null;
      status?: string;
    };
    const res = await insertProjectWithId({ ...p, id: cmd.entityId }, cmd.userId);
    if (res.ok || res.code === '23505') return applied();
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateProjectOwned(cmd.entityId, cmd.payload, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    return res.data.exists ? applied() : { kind: 'gone' };
  }
  const res = await deleteProjectIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const readingItemTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const p = cmd.payload as {
      title: string;
      author?: string | null;
      type: ReadingType;
      status?: ReadingStatus;
      url?: string | null;
      notes?: string | null;
      rating?: number | null;
    };
    const res = await insertReadingItemWithId({ ...p, id: cmd.entityId }, cmd.userId);
    if (res.ok || res.code === '23505') return applied();
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateReadingItemOwned(cmd.entityId, cmd.payload, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    return res.data.exists ? applied() : { kind: 'gone' };
  }
  const res = await deleteReadingItemIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const okrObjectiveTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const p = cmd.payload as { objective: string; year: number; quarter: number };
    const res = await insertObjectiveWithId({ ...p, id: cmd.entityId }, cmd.userId);
    if (res.ok || res.code === '23505') return applied();
    return classifyFailure(res);
  }
  if (cmd.kind === 'delete') {
    const res = await deleteObjectiveIfPresent(cmd.entityId, cmd.userId);
    return res.ok ? applied() : classifyFailure(res);
  }
  return { kind: 'rejected', error: 'unsupported okr_objective command' };
};

export const keyResultTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const p = cmd.payload as {
      okr_id: string;
      title: string;
      current_value?: number;
      target_value: number;
      unit?: string | null;
    };
    const res = await insertKeyResultWithId({ ...p, id: cmd.entityId }, cmd.userId);
    if (res.ok || res.code === '23505') return applied();
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateKeyResultOwned(cmd.entityId, cmd.payload, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    return res.data.exists ? applied() : { kind: 'gone' };
  }
  const res = await deleteKeyResultIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const lifeAreaLogTransport: Transport = async (cmd) => {
  if (cmd.kind !== 'update' && cmd.kind !== 'create') {
    return { kind: 'rejected', error: 'life_area_log only supports upsert' };
  }
  const values = cmd.payload as Record<string, number>;
  const res = await upsertLifeAreaLogs(cmd.entityId, values, cmd.userId);
  if (!res.ok) return classifyFailure(res);
  return applied();
};

export const CORE_TRANSPORTS = {
  journal_entry: journalTransport,
  note: noteTransport,
  recovery_plan: recoveryPlanTransport,
  focus_session: focusSessionTransport,
  goal: goalTransport,
  project: projectTransport,
  reading_item: readingItemTransport,
  okr_objective: okrObjectiveTransport,
  key_result: keyResultTransport,
  life_area_log: lifeAreaLogTransport,
} as const;

const rawCoreOutbox = createOutboxChannel({
  storage: asyncStorageOutboxNs(CORE_OUTBOX_NAMESPACE),
  transports: CORE_TRANSPORTS,
  currentUserId: async () => (await currentUser())?.id ?? null,
  policies: ENTITY_POLICIES,
  registerStorage: {
    name: CORE_OUTBOX_NAMESPACE,
    keysFor: (uid) => [namespacedOutboxKey(CORE_OUTBOX_NAMESPACE, uid)],
  },
});

let replacing = false;
let replaceCarrierId = '';

export const coreOutbox: OutboxChannel = {
  ...rawCoreOutbox,
  async write(input: Omit<EnqueueInput, 'operationId'>, opts?: WriteOptions) {
    if (replacing) {
      return { ok: true, operationId: replaceCarrierId, savedOnDevice: true };
    }
    return rawCoreOutbox.write(input, opts);
  },
  async discard(operationId: string) {
    if (replacing) return;
    return rawCoreOutbox.discard(operationId);
  },
  async replace(operationId: string, input: Omit<EnqueueInput, 'operationId'>, opts?: WriteOptions) {
    const res = await rawCoreOutbox.replace(operationId, input, opts);
    if (res.ok) {
      replacing = true;
      replaceCarrierId = res.operationId;
      try {
        await coreOutbox.write(input);
        await coreOutbox.discard(operationId);
      } finally {
        replacing = false;
        replaceCarrierId = '';
      }
    }
    return res;
  },
  reset() {
    clearReadCacheMemory();
    rawCoreOutbox.reset();
  },
};

outboxEngine.register('core', coreOutbox);

// F04: the channel's memory belongs to the signed-in account; its saved, unsent work does not go (lib/accountScope.ts).
registerAccountScoped({ name: 'coreOutbox', onReset: () => coreOutbox.reset() });
