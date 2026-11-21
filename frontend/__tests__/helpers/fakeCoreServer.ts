/**
 * An in-memory stand-in for the core tables the core outbox writes
 * (notes, journal_entries, recovery_plans, focus_sessions, goals, projects,
 * reading_list, okrs, key_results, life_area_logs), shaped like the
 * repository functions it replaces. Used through `jest.mock(..., () =>
 * require('../helpers/fakeCoreServer').noteRepo)` and friends.
 */
export type FakeNote = { id: string; user_id: string; title: string; content: string; tags: string[]; created_at: string; updated_at: string };

export type FakeTable = 'goals' | 'projects' | 'readingItems' | 'okrs' | 'keyResults' | 'lifeAreaLogs';

export const server = {
  online: true,
  user: 'u1' as string | null,
  notes: new Map<string, FakeNote>(),
  journal: new Map<string, { content: string; mood: number | null }>(),
  plans: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  goals: new Map<string, Record<string, unknown>>(),
  projects: new Map<string, Record<string, unknown>>(),
  readingItems: new Map<string, Record<string, unknown>>(),
  okrs: new Map<string, Record<string, unknown>>(),
  keyResults: new Map<string, Record<string, unknown>>(),
  lifeAreaLogs: new Map<string, number>(),
  /** Next n writes APPLY on the server, then return offline to the caller (committed, response lost). */
  lose: {} as Partial<Record<FakeTable, number>>,
  /** Next write returns a permanent server refusal (4xx). */
  refuse: null as null | { status: number; error: string },
  /** One-shot hook run right BEFORE `upsertJournalEntry` writes (another device racing between read and write). */
  beforeJournalWrite: null as null | (() => void),
  tick: 0,
  reset() {
    this.online = true; this.user = 'u1'; this.tick = 0;
    this.notes.clear(); this.journal.clear(); this.plans.clear(); this.sessions.clear();
    this.goals.clear(); this.projects.clear(); this.readingItems.clear();
    this.okrs.clear(); this.keyResults.clear(); this.lifeAreaLogs.clear();
    this.lose = {};
    this.refuse = null;
    this.beforeJournalWrite = null;
  },
};

const OFF = { ok: false as const, error: 'Network request failed', offline: true, status: 0 };
const wrong = (expected?: string) => (expected !== undefined && expected !== server.user ? { ok: false as const, error: 'Oturum başka bir hesaba ait.', status: 401 } : null);
export const stamp = () => `2026-10-08T00:${String(Math.floor(++server.tick / 60)).padStart(2, '0')}:${String(server.tick % 60).padStart(2, '0')}.000Z`;

export function commitThenLoseResponse(table: FakeTable, times = 1): void {
  server.lose[table] = times;
}

const consumeLoss = (table: FakeTable): boolean => {
  const n = server.lose[table] ?? 0;
  if (n > 0) {
    server.lose[table] = n - 1;
    return true;
  }
  return false;
};

export const session = { currentUser: async () => (server.user ? { id: server.user } : null) };

export const noteRepo = {
  insertNoteWithId: async (row: FakeNote, exp?: string) => {
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    if (server.notes.has(row.id)) return { ok: false, error: 'duplicate', code: '23505' };
    const n = { ...row, user_id: server.user!, created_at: stamp(), updated_at: stamp() } as FakeNote;
    server.notes.set(row.id, n);
    return { ok: true, data: n };
  },
  updateNoteVersioned: async (id: string, patch: Partial<FakeNote>, base: string | null, exp?: string) => {
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    const cur = server.notes.get(id);
    if (!cur) return { ok: true, data: { row: null, exists: false } };
    if (base !== null && cur.updated_at !== base) return { ok: true, data: { row: null, exists: true } };
    const n = { ...cur, ...patch, updated_at: stamp() };
    server.notes.set(id, n);
    return { ok: true, data: { row: n, exists: true } };
  },
  fetchNoteRow: async (id: string) => (server.online ? { ok: true, data: server.notes.get(id) ?? null } : OFF),
  deleteNoteIfPresent: async (id: string, exp?: string) => {
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    return { ok: true, data: { deleted: server.notes.delete(id) } };
  },
  fetchNotesPage: async () => (server.online
    ? { ok: true, data: { rows: [...server.notes.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), nextCursor: null, hasMore: false } }
    : OFF),
  searchNotes: async () => ({ ok: true, data: [] }),
};

export const journalRepo = {
  fetchJournalEntry: async (date: string) => {
    if (!server.online) return OFF;
    const e = server.journal.get(date);
    return { ok: true, data: e ? { id: `j-${date}`, user_id: server.user, date, content: e.content, mood: e.mood, ai_summary: null, created_at: '' } : null };
  },
  upsertJournalEntry: async (
    input: { date: string; content: string; mood?: number | null; aiSummary?: boolean },
    exp?: string,
    guard?: { baseContent: string | null },
  ) => {
    if (server.beforeJournalWrite) {
      const hook = server.beforeJournalWrite;
      server.beforeJournalWrite = null;
      hook();
    }
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    if (server.refuse) return { ok: false as const, error: server.refuse.error, status: server.refuse.status };
    if (guard !== undefined) {
      const cur = server.journal.get(input.date);
      if (guard.baseContent === null) {
        if (cur !== undefined) {
          return { ok: false as const, error: 'duplicate', code: '23505', status: 409 };
        }
      } else if (!cur || cur.content !== guard.baseContent) {
        return { ok: false as const, error: 'Bu günün kaydı başka bir yerde değişti.', code: 'CAS_MISMATCH', status: 409 };
      }
    }
    server.journal.set(input.date, { content: input.content, mood: input.mood ?? null });
    return {
      ok: true,
      data: { id: `j-${input.date}`, user_id: server.user, date: input.date, content: input.content, mood: input.mood ?? null, ai_summary: input.aiSummary ?? null, created_at: '' },
    };
  },
  fetchJournalEntries: async () => (server.online
    ? { ok: true, data: [...server.journal.entries()].map(([date, e]) => ({ id: `j-${date}`, user_id: server.user, date, content: e.content, mood: e.mood, ai_summary: null, created_at: '' })) }
    : OFF),
};

export const recoveryRepo = {
  insertRecoveryPlanRow: async (row: Record<string, unknown> & { id: string }, exp?: string) => {
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    if (server.plans.has(row.id)) return { ok: false, error: 'duplicate', code: '23505' };
    server.plans.set(row.id, { ...row, user_id: server.user });
    return { ok: true, data: row };
  },
  updateRecoveryPlanRow: async (id: string, patch: Record<string, unknown>, exp?: string) => {
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    const cur = server.plans.get(id);
    if (!cur) return { ok: true, data: { row: null, exists: false } };
    server.plans.set(id, { ...cur, ...patch });
    return { ok: true, data: { row: { ...cur, ...patch }, exists: true } };
  },
  deleteRecoveryPlanIfPresent: async (id: string) => (server.online ? { ok: true, data: { deleted: server.plans.delete(id) } } : OFF),
  fetchPlannedRecoveryPlans: async () => (server.online
    ? { ok: true, data: [...server.plans.values()].filter((p) => p.status === 'planned') }
    : OFF),
};

function ownedTable(table: Exclude<FakeTable, 'lifeAreaLogs'>, map: Map<string, Record<string, unknown>>) {
  return {
    insert: async (row: Record<string, unknown> & { id: string }, exp?: string) => {
      if (!server.online) return OFF;
      const w = wrong(exp); if (w) return w;
      if (server.refuse) return { ok: false as const, error: server.refuse.error, status: server.refuse.status };
      if (map.has(row.id)) return { ok: false as const, error: 'duplicate', code: '23505', status: 409 };
      const saved = { ...row, user_id: server.user, created_at: stamp() };
      map.set(row.id, saved);
      return consumeLoss(table) ? OFF : { ok: true as const, data: saved };
    },
    update: async (id: string, patch: Record<string, unknown>, exp?: string) => {
      if (!server.online) return OFF;
      const w = wrong(exp); if (w) return w;
      if (server.refuse) return { ok: false as const, error: server.refuse.error, status: server.refuse.status };
      const cur = map.get(id);
      if (!cur) return { ok: true as const, data: { row: null, exists: false } };
      const next = { ...cur, ...patch };
      map.set(id, next);
      return consumeLoss(table) ? OFF : { ok: true as const, data: { row: next, exists: true } };
    },
    remove: async (id: string, exp?: string) => {
      if (!server.online) return OFF;
      const w = wrong(exp); if (w) return w;
      if (server.refuse) return { ok: false as const, error: server.refuse.error, status: server.refuse.status };
      const deleted = map.delete(id);
      return consumeLoss(table) ? OFF : { ok: true as const, data: { deleted } };
    },
  };
}

const goalsTable = ownedTable('goals', server.goals);
const projectsTable = ownedTable('projects', server.projects);
const readingTable = ownedTable('readingItems', server.readingItems);
const okrsTable = ownedTable('okrs', server.okrs);
const keyResultsTable = ownedTable('keyResults', server.keyResults);

export const goalRepo = {
  insertGoalWithId: (row: Record<string, unknown> & { id: string }, exp?: string) =>
    goalsTable.insert({
      ...row,
      progress: Math.max(0, Math.min(100, Math.round(Number(row.progress ?? 0)))),
      year: row.year ?? null,
      quarter: row.quarter ?? null,
      month: row.month ?? null,
      archived: row.archived ?? false,
    }, exp),
  updateGoalOwned: goalsTable.update,
  deleteGoalIfPresent: goalsTable.remove,
  insertGoal: (input: Record<string, unknown>) =>
    goalsTable.insert({
      id: `srv-goal-${++server.tick}`,
      kind: input.kind,
      title: input.title,
      progress: Math.max(0, Math.min(100, Math.round(Number(input.progress ?? 0)))),
      year: input.year ?? null,
      quarter: input.quarter ?? null,
      month: input.month ?? null,
      archived: false,
    }),
  fetchGoalsPage: async () => (server.online
    ? { ok: true as const, data: { rows: [...server.goals.values()].filter((g) => !g.archived), nextCursor: null, hasMore: false } }
    : OFF),
  updateGoalProgress: async (id: string, progress: number) => {
    const r = await goalsTable.update(id, { progress: Math.max(0, Math.min(100, Math.round(progress))) });
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
  archiveGoal: async (id: string) => {
    const r = await goalsTable.update(id, { archived: true });
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
  deleteGoal: async (id: string) => {
    const r = await goalsTable.remove(id);
    if (!r.ok) return r;
    return r.data.deleted ? { ok: true as const, data: true as const } : { ok: false as const, error: 'not found' };
  },
};

export const projectRepo = {
  insertProjectWithId: (row: Record<string, unknown> & { id: string }, exp?: string) =>
    projectsTable.insert({
      ...row,
      color: row.color ?? null,
      description: row.description ?? null,
      status: row.status ?? 'active',
    }, exp),
  updateProjectOwned: projectsTable.update,
  deleteProjectIfPresent: projectsTable.remove,
  insertProject: (input: Record<string, unknown>) =>
    projectsTable.insert({
      id: `srv-proj-${++server.tick}`,
      name: input.name,
      color: input.color ?? null,
      description: input.description ?? null,
      status: 'active',
    }),
  fetchProjectsPage: async () => (server.online
    ? { ok: true as const, data: { rows: [...server.projects.values()].filter((p) => p.status !== 'archived'), nextCursor: null, hasMore: false } }
    : OFF),
  updateProject: async (id: string, patch: Record<string, unknown>) => {
    const r = await projectsTable.update(id, patch);
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
  archiveProject: async (id: string) => {
    const r = await projectsTable.update(id, { status: 'archived' });
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
};

export const readingRepo = {
  insertReadingItemWithId: (row: Record<string, unknown> & { id: string }, exp?: string) =>
    readingTable.insert({
      ...row,
      author: row.author ?? null,
      status: row.status ?? 'want_to_read',
      url: row.url ?? null,
      notes: row.notes ?? null,
      rating: row.rating ?? null,
      updated_at: stamp(),
    }, exp),
  updateReadingItemOwned: (id: string, patch: Record<string, unknown>, exp?: string) =>
    readingTable.update(id, { ...patch, updated_at: stamp() }, exp),
  deleteReadingItemIfPresent: readingTable.remove,
  insertReadingItem: (input: Record<string, unknown>) =>
    readingTable.insert({
      id: `srv-read-${++server.tick}`,
      title: input.title,
      author: input.author ?? null,
      type: input.type,
      status: 'want_to_read',
      url: input.url ?? null,
      notes: null,
      rating: null,
      updated_at: stamp(),
    }),
  fetchReadingListPage: async (_cursor?: unknown, _limit?: unknown, opts?: { status?: string }) => (server.online
    ? {
        ok: true as const,
        data: {
          rows: [...server.readingItems.values()].filter((r) => !opts?.status || r.status === opts.status),
          nextCursor: null,
          hasMore: false,
        },
      }
    : OFF),
  fetchReadingCounts: async () => {
    if (!server.online) return OFF;
    const out = { want_to_read: 0, reading: 0, completed: 0 };
    for (const r of server.readingItems.values()) {
      const st = String(r.status ?? 'want_to_read') as keyof typeof out;
      if (st in out) out[st] += 1;
    }
    return { ok: true as const, data: out };
  },
  updateReadingStatus: async (id: string, status: string) => {
    const r = await readingTable.update(id, { status, updated_at: stamp() });
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
  updateReadingRating: async (id: string, rating: number | null) => {
    const r = await readingTable.update(id, { rating, updated_at: stamp() });
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
  updateReadingNotes: async (id: string, notes: string) => {
    const r = await readingTable.update(id, { notes, updated_at: stamp() });
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
  deleteReadingItem: async (id: string) => {
    const r = await readingTable.remove(id);
    if (!r.ok) return r;
    return r.data.deleted ? { ok: true as const, data: true as const } : { ok: false as const, error: 'not found' };
  },
};

export const okrRepo = {
  insertObjectiveWithId: okrsTable.insert,
  insertKeyResultWithId: (row: Record<string, unknown> & { id: string }, exp?: string) =>
    keyResultsTable.insert({
      ...row,
      current_value: row.current_value ?? 0,
      unit: row.unit ?? null,
    }, exp),
  updateKeyResultOwned: keyResultsTable.update,
  deleteObjectiveIfPresent: okrsTable.remove,
  deleteKeyResultIfPresent: keyResultsTable.remove,
  insertObjective: (input: Record<string, unknown>) =>
    okrsTable.insert({ id: `srv-okr-${++server.tick}`, ...input }),
  insertKeyResult: (input: Record<string, unknown>) =>
    keyResultsTable.insert({
      id: `srv-kr-${++server.tick}`,
      okr_id: input.okrId,
      title: input.title,
      current_value: 0,
      target_value: input.targetValue,
      unit: input.unit ?? null,
    }),
  fetchOkrs: async () => (server.online
    ? { ok: true as const, data: { okrs: [...server.okrs.values()], keyResults: [...server.keyResults.values()] } }
    : OFF),
  updateKeyResultValue: async (id: string, currentValue: number) => {
    const r = await keyResultsTable.update(id, { current_value: currentValue });
    if (!r.ok) return r;
    return r.data.row ? { ok: true as const, data: r.data.row } : { ok: false as const, error: 'not found' };
  },
  deleteObjective: async (id: string) => {
    const r = await okrsTable.remove(id);
    if (!r.ok) return r;
    return r.data.deleted ? { ok: true as const, data: true as const } : { ok: false as const, error: 'not found' };
  },
  deleteKeyResult: async (id: string) => {
    const r = await keyResultsTable.remove(id);
    if (!r.ok) return r;
    return r.data.deleted ? { ok: true as const, data: true as const } : { ok: false as const, error: 'not found' };
  },
};

export const lifeAreaRepo = {
  upsertLifeAreaLogs: async (date: string, values: Record<string, number>, exp?: string) => {
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    if (server.refuse) return { ok: false as const, error: server.refuse.error, status: server.refuse.status };
    for (const [area, value] of Object.entries(values)) {
      server.lifeAreaLogs.set(`${date}|${area}`, value);
    }
    return consumeLoss('lifeAreaLogs') ? OFF : { ok: true as const, data: true as const };
  },
  fetchRecentLifeAreaLogs: async () => (server.online
    ? {
        ok: true as const,
        data: [...server.lifeAreaLogs.entries()].map(([k, value]) => {
          const [date, area] = k.split('|');
          return { date, area, value };
        }),
      }
    : OFF),
};
