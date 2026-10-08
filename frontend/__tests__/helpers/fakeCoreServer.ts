/**
 * An in-memory stand-in for the four core tables the core outbox writes
 * (notes, journal_entries, recovery_plans, focus_sessions), shaped like the
 * repository functions it replaces. Used through `jest.mock(..., () =>
 * require('../helpers/fakeCoreServer').noteRepo)` and friends.
 */
export type FakeNote = { id: string; user_id: string; title: string; content: string; tags: string[]; created_at: string; updated_at: string };

export const server = {
  online: true,
  user: 'u1' as string | null,
  notes: new Map<string, FakeNote>(),
  journal: new Map<string, { content: string; mood: number | null }>(),
  plans: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  tick: 0,
  reset() {
    this.online = true; this.user = 'u1'; this.tick = 0;
    this.notes.clear(); this.journal.clear(); this.plans.clear(); this.sessions.clear();
  },
};

const OFF = { ok: false as const, error: 'Network request failed', offline: true, status: 0 };
const wrong = (expected?: string) => (expected !== undefined && expected !== server.user ? { ok: false as const, error: 'Oturum başka bir hesaba ait.', status: 401 } : null);
export const stamp = () => `2026-10-08T00:${String(Math.floor(++server.tick / 60)).padStart(2, '0')}:${String(server.tick % 60).padStart(2, '0')}.000Z`;

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
  upsertJournalEntry: async (input: { date: string; content: string; mood?: number | null }, exp?: string) => {
    if (!server.online) return OFF;
    const w = wrong(exp); if (w) return w;
    server.journal.set(input.date, { content: input.content, mood: input.mood ?? null });
    return { ok: true, data: { id: `j-${input.date}`, user_id: server.user, date: input.date, content: input.content, mood: input.mood ?? null, ai_summary: null, created_at: '' } };
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
