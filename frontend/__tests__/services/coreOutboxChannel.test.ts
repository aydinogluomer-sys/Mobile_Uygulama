/**
 * R02.03 / R02.05 / R02.06 — the core outbox channel against an in-memory
 * server, with the REAL note/journal/recovery/focus transports (their
 * repositories are replaced by that server).
 *
 * R02 kabul: "aynı komut beş retry'da tek etki yaratır; A kuyruğu B hesabına
 * taşınmaz; silinmiş öğe geç edit ile geri doğmaz" + R02.03 "yerel değişiklik
 * + outbox aynı yerel transaction'da" + R02.05 T08 "aynı notta çatışan sürümü
 * koru".
 */
type Note = { id: string; user_id: string; title: string; content: string; tags: string[]; created_at: string; updated_at: string };
const mockServer = {
  online: true,
  user: 'u1' as string | null,
  notes: new Map<string, Note>(),
  journal: new Map<string, { content: string; mood: number | null }>(),
  plans: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  calls: 0,
  tick: 0,
};
const OFF = { ok: false as const, error: 'Network request failed', offline: true, status: 0 };
const wrong = (expected?: string) => (expected !== undefined && expected !== mockServer.user ? { ok: false as const, error: 'Oturum başka bir hesaba ait.', status: 401 } : null);
const stamp = () => `2026-10-08T00:00:${String(++mockServer.tick).padStart(2, '0')}.000Z`;

jest.mock('../../lib/session', () => ({ currentUser: async () => (mockServer.user ? { id: mockServer.user } : null) }));
jest.mock('../../repositories/noteRepository', () => ({
  insertNoteWithId: async (row: Note, exp?: string) => {
    mockServer.calls++;
    if (!mockServer.online) return OFF;
    const w = wrong(exp); if (w) return w;
    if (mockServer.notes.has(row.id)) return { ok: false, error: 'duplicate', code: '23505' };
    const n = { ...row, user_id: mockServer.user!, created_at: stamp(), updated_at: stamp() } as Note;
    mockServer.notes.set(row.id, n);
    return { ok: true, data: n };
  },
  updateNoteVersioned: async (id: string, patch: Partial<Note>, base: string | null, exp?: string) => {
    mockServer.calls++;
    if (!mockServer.online) return OFF;
    const w = wrong(exp); if (w) return w;
    const cur = mockServer.notes.get(id);
    if (!cur) return { ok: true, data: { row: null, exists: false } };
    if (base !== null && cur.updated_at !== base) return { ok: true, data: { row: null, exists: true } };
    const n = { ...cur, ...patch, updated_at: stamp() };
    mockServer.notes.set(id, n);
    return { ok: true, data: { row: n, exists: true } };
  },
  fetchNoteRow: async (id: string) => (mockServer.online ? { ok: true, data: mockServer.notes.get(id) ?? null } : OFF),
  deleteNoteIfPresent: async (id: string, exp?: string) => {
    mockServer.calls++;
    if (!mockServer.online) return OFF;
    const w = wrong(exp); if (w) return w;
    return { ok: true, data: { deleted: mockServer.notes.delete(id) } };
  },
  fetchNotesPage: async () => ({ ok: true, data: { rows: [...mockServer.notes.values()], nextCursor: null, hasMore: false } }),
  searchNotes: async () => ({ ok: true, data: [] }),
}));
jest.mock('../../repositories/journalRepository', () => ({
  fetchJournalEntry: async (date: string) => {
    if (!mockServer.online) return OFF;
    const e = mockServer.journal.get(date);
    return { ok: true, data: e ? { id: `j-${date}`, user_id: mockServer.user, date, content: e.content, mood: e.mood, ai_summary: null, created_at: '' } : null };
  },
  upsertJournalEntry: async (input: { date: string; content: string; mood?: number | null }, exp?: string) => {
    mockServer.calls++;
    if (!mockServer.online) return OFF;
    const w = wrong(exp); if (w) return w;
    mockServer.journal.set(input.date, { content: input.content, mood: input.mood ?? null });
    return { ok: true, data: { id: `j-${input.date}`, user_id: mockServer.user, date: input.date, content: input.content, mood: input.mood ?? null, ai_summary: null, created_at: '' } };
  },
  fetchJournalEntries: async () => ({ ok: true, data: [] }),
}));
jest.mock('../../repositories/recoveryRepository', () => ({
  insertRecoveryPlanRow: async (row: Record<string, unknown> & { id: string }, exp?: string) => {
    mockServer.calls++;
    if (!mockServer.online) return OFF;
    const w = wrong(exp); if (w) return w;
    if (mockServer.plans.has(row.id)) return { ok: false, error: 'duplicate', code: '23505' };
    mockServer.plans.set(row.id, row);
    return { ok: true, data: row };
  },
  updateRecoveryPlanRow: async (id: string, patch: Record<string, unknown>) => {
    mockServer.calls++;
    if (!mockServer.online) return OFF;
    const cur = mockServer.plans.get(id);
    if (!cur) return { ok: true, data: { row: null, exists: false } };
    mockServer.plans.set(id, { ...cur, ...patch });
    return { ok: true, data: { row: { ...cur, ...patch }, exists: true } };
  },
  deleteRecoveryPlanIfPresent: async (id: string) => (mockServer.online ? { ok: true, data: { deleted: mockServer.plans.delete(id) } } : OFF),
  fetchPlannedRecoveryPlans: async () => ({ ok: true, data: [] }),
}));
jest.mock('../../repositories/focusSessionRepository', () => ({
  insertFocusSessionRow: async (row: Record<string, unknown> & { id: string }) => {
    mockServer.calls++;
    if (!mockServer.online) return OFF;
    if (mockServer.sessions.has(row.id)) return { ok: false, error: 'duplicate', code: '23505' };
    mockServer.sessions.set(row.id, row);
    return { ok: true, data: { id: row.id } };
  },
}));

import { createOutboxChannel, type OutboxChannel } from '../../services/outboxChannel';
import { CORE_TRANSPORTS, contentVersion, noteTransport } from '../../services/coreOutbox';
import { memoryOutboxStorage } from '../../lib/outboxStorage';
import { clearSending } from '../../lib/outbox';

let storage: ReturnType<typeof memoryOutboxStorage>;
let ch: OutboxChannel;
const fresh = () => createOutboxChannel({ storage, transports: CORE_TRANSPORTS, currentUserId: async () => mockServer.user });

beforeEach(() => {
  Object.assign(mockServer, { online: true, user: 'u1', calls: 0, tick: 0 });
  mockServer.notes.clear(); mockServer.journal.clear(); mockServer.plans.clear(); mockServer.sessions.clear();
  storage = memoryOutboxStorage();
  ch = fresh();
});

describe('R02.03 — the change and its command are one device write, before any request', () => {
  it('offline: the journal text is saved on the device, survives a restart, and is delivered once online', async () => {
    mockServer.online = false;
    const w = await ch.write({ entity: 'journal_entry', entityId: '2026-10-08', kind: 'update', payload: { content: 'uçakta yazdım', mood: 4 }, baseVersion: contentVersion('') });
    expect(w).toMatchObject({ ok: true, savedOnDevice: true });
    await ch.flush();
    expect(mockServer.journal.size).toBe(0);
    // app killed: a NEW channel over the same device storage
    mockServer.online = true;
    const after = fresh();
    expect((await after.ensure())!.commands).toHaveLength(1);
    await after.flush();
    expect(mockServer.journal.get('2026-10-08')).toEqual({ content: 'uçakta yazdım', mood: 4 });
    expect(after.state()!.commands).toHaveLength(0);
  });

  it('a plan, a note and a focus session made offline are all delivered after reconnecting', async () => {
    mockServer.online = false;
    await ch.write({ entity: 'recovery_plan', entityId: 'p1', kind: 'create', payload: { habit_id: 'h', status: 'planned' } });
    await ch.write({ entity: 'note', entityId: 'n1', kind: 'create', payload: { title: 'T', content: 'C', tags: [] } });
    await ch.write({ entity: 'focus_session', entityId: 's1', kind: 'create', payload: { mode: 'work', completed_seconds: 1500 } });
    await ch.flush();
    expect(ch.sync().pending).toBe(3);
    mockServer.online = true;
    // the outbox waits for its backoff; a later flush (next trigger) delivers
    const later = createOutboxChannel({ storage, transports: CORE_TRANSPORTS, currentUserId: async () => mockServer.user, now: () => Date.now() + 10 * 60_000 });
    await later.flush();
    expect([mockServer.plans.size, mockServer.notes.size, mockServer.sessions.size]).toEqual([1, 1, 1]);
  });
});

describe('R02.03 — the same command delivered five times is ONE effect', () => {
  it('a create re-sent after every "crash" lands once (23505 = already applied)', async () => {
    mockServer.online = true;
    await ch.write({ entity: 'focus_session', entityId: 's-dup', kind: 'create', payload: { mode: 'work' } });
    const cmd = { operationId: 'x', userId: 'u1', entity: 'focus_session', entityId: 's-dup', kind: 'create' as const, payload: { mode: 'work' }, baseVersion: null, dependsOn: [], seq: 1, attempts: 0, status: 'pending' as const, readyAt: 0, createdAt: 0 };
    for (let i = 0; i < 5; i++) expect((await CORE_TRANSPORTS.focus_session(cmd)).kind).toBe('applied');
    expect(mockServer.sessions.size).toBe(1);
  });

  it('a note update replayed after its response was lost is applied, not a conflict with itself', async () => {
    await ch.write({ entity: 'note', entityId: 'n', kind: 'create', payload: { title: 'a', content: 'b', tags: [] } });
    await ch.flush();
    const v1 = mockServer.notes.get('n')!.updated_at;
    const upd = { operationId: 'u', userId: 'u1', entity: 'note', entityId: 'n', kind: 'update' as const, payload: { content: 'yeni' }, baseVersion: v1, dependsOn: [], seq: 2, attempts: 0, status: 'pending' as const, readyAt: 0, createdAt: 0 };
    expect((await noteTransport(upd)).kind).toBe('applied');
    // the server applied it, the response was lost, the outbox re-sends it 4 more times
    for (let i = 0; i < 4; i++) expect((await noteTransport(upd)).kind).toBe('applied');
    expect(mockServer.notes.get('n')!.content).toBe('yeni');
  });

  it('a send interrupted mid-flight (saved with `sending`) is sent again on load, still one effect', async () => {
    await ch.write({ entity: 'recovery_plan', entityId: 'p-crash', kind: 'create', payload: { status: 'planned' } });
    await ch.flush();
    // simulate: server applied, but the outbox save that removed the command never happened
    const st = { ...ch.state()!, commands: [{ operationId: 'o', userId: 'u1', entity: 'recovery_plan', entityId: 'p-crash', kind: 'create' as const, payload: { status: 'planned' }, baseVersion: null, dependsOn: [], seq: 9, attempts: 0, status: 'pending' as const, readyAt: 0, createdAt: 0, sending: true }] };
    await storage.save(st);
    const reloaded = fresh();
    expect((await reloaded.ensure())!.commands[0].sending).toBeFalsy();
    expect(clearSending(st).commands[0].sending).toBeFalsy();
    await reloaded.flush();
    expect(mockServer.plans.size).toBe(1);
    expect(reloaded.state()!.commands).toHaveLength(0);
  });
});

describe('R02.05 — T08: the same note edited in two places keeps BOTH versions', () => {
  it('an edit over a note that changed elsewhere is a conflict; the server text is untouched and the local text is kept', async () => {
    await ch.write({ entity: 'note', entityId: 'n8', kind: 'create', payload: { title: 'Plan', content: 'v1', tags: [] } });
    await ch.flush();
    const seen = mockServer.notes.get('n8')!.updated_at;
    // device B edits on the server
    mockServer.notes.set('n8', { ...mockServer.notes.get('n8')!, content: 'B cihazı', updated_at: stamp() });
    // device A edits against what it saw
    await ch.write({ entity: 'note', entityId: 'n8', kind: 'update', payload: { content: 'A cihazı' }, baseVersion: seen });
    await ch.flush();
    expect(mockServer.notes.get('n8')!.content).toBe('B cihazı');
    const c = ch.state()!.commands.find((x) => x.entityId === 'n8')!;
    expect(c.status).toBe('conflict');
    expect(c.payload).toEqual({ content: 'A cihazı' });
  });

  it('journal: a day rewritten elsewhere is a conflict, not an overwrite', async () => {
    mockServer.journal.set('2026-10-07', { content: 'telefondan', mood: 3 });
    await ch.write({ entity: 'journal_entry', entityId: '2026-10-07', kind: 'update', payload: { content: 'tabletten', mood: 3 }, baseVersion: contentVersion('') });
    await ch.flush();
    expect(mockServer.journal.get('2026-10-07')!.content).toBe('telefondan');
    expect(ch.state()!.commands[0].status).toBe('conflict');
  });

  it('journal: an edit over the text it started from is applied', async () => {
    mockServer.journal.set('2026-10-06', { content: 'sabah', mood: 3 });
    await ch.write({ entity: 'journal_entry', entityId: '2026-10-06', kind: 'update', payload: { content: 'sabah + akşam', mood: 3 }, baseVersion: contentVersion('sabah') });
    await ch.flush();
    expect(mockServer.journal.get('2026-10-06')!.content).toBe('sabah + akşam');
  });
});

describe('R02.06 / R02 — accounts and tombstones', () => {
  it("A's queued work is never sent as B, and is still there when A returns", async () => {
    mockServer.online = false;
    await ch.write({ entity: 'note', entityId: 'na', kind: 'create', payload: { title: 'A', content: 'a', tags: [] } });
    mockServer.online = true;
    mockServer.user = 'u2';
    ch.reset();
    await ch.flush();
    expect(mockServer.notes.size).toBe(0);
    expect(ch.state()!.userId).toBe('u2');
    mockServer.user = 'u1';
    ch.reset();
    const later = createOutboxChannel({ storage, transports: CORE_TRANSPORTS, currentUserId: async () => mockServer.user, now: () => Date.now() + 10 * 60_000 });
    await later.flush();
    expect(mockServer.notes.get('na')?.user_id).toBe('u1');
  });

  it('a deleted note does not come back through a late edit', async () => {
    await ch.write({ entity: 'note', entityId: 'nd', kind: 'create', payload: { title: 'x', content: 'y', tags: [] } });
    await ch.flush();
    await ch.write({ entity: 'note', entityId: 'nd', kind: 'delete' });
    await ch.flush();
    await ch.write({ entity: 'note', entityId: 'nd', kind: 'update', payload: { content: 'geç düzenleme' }, baseVersion: null });
    await ch.flush();
    expect(mockServer.notes.has('nd')).toBe(false);
    expect(ch.state()!.commands).toHaveLength(0);
  });

  it('F19 (SYN-05): clearTombstones releases confirmed tombstones and unsent deletes so restored rows appear and accept edits', async () => {
    await ch.write({ entity: 'note', entityId: 'n-res', kind: 'create', payload: { title: 'Eski', content: 'v1', tags: [] } });
    await ch.flush();
    await ch.write({ entity: 'note', entityId: 'n-res', kind: 'delete' });
    await ch.flush();
    expect(ch.state()!.tombstones['note|n-res']).toBeDefined();
    expect(ch.state()!.confirmedDeletes?.['note|n-res']).toBeDefined();

    // Also queue an unsent delete on another note (let the initial offline flush finish so it is not mid-flight)
    mockServer.online = false;
    await ch.write({ entity: 'note', entityId: 'n-unsent', kind: 'delete' });
    await ch.flush();
    expect(ch.sync().pending).toBe(1);

    await ch.clearTombstones('note', ['n-res', 'n-unsent']);
    expect(ch.state()!.tombstones['note|n-res']).toBeUndefined();
    expect(ch.state()!.confirmedDeletes?.['note|n-res']).toBeUndefined();
    expect(ch.state()!.tombstones['note|n-unsent']).toBeUndefined();
    expect(ch.sync().pending).toBe(0);

    // Server row restored directly (e.g. backup restore) now accepts updates again
    mockServer.online = true;
    mockServer.notes.set('n-res', { id: 'n-res', user_id: 'u1', title: 'Eski', content: 'v1', tags: [], created_at: stamp(), updated_at: 'v-restored' });
    await ch.write({ entity: 'note', entityId: 'n-res', kind: 'update', payload: { content: 'düzenlendi' }, baseVersion: 'v-restored' });
    await ch.flush();
    expect(mockServer.notes.get('n-res')?.content).toBe('düzenlendi');
  });
});

describe('the onApplied hook reports what the server accepted, and only that', () => {
  it('fires once per applied command, never while offline, never for a refusal', async () => {
    const seen: string[] = [];
    ch.onApplied((c) => seen.push(`${c.entity}:${c.entityId}`));
    mockServer.online = false;
    await ch.write({ entity: 'recovery_plan', entityId: 'pa', kind: 'create', payload: {} });
    await ch.flush();
    expect(seen).toEqual([]);
    mockServer.online = true;
    await ch.write({ entity: 'focus_session', entityId: 'sa', kind: 'create', payload: {} });
    await ch.flush();
    // offline is not a refusal: the plan is re-sent first, in queue order, then the session
    expect(seen).toEqual(['recovery_plan:pa', 'focus_session:sa']);
    // a refused command is never reported
    const refused = createOutboxChannel({ storage: memoryOutboxStorage(), transports: { x: async () => ({ kind: 'rejected', error: 'no' }) }, currentUserId: async () => 'u1' });
    const r: string[] = [];
    refused.onApplied((c) => r.push(c.entityId));
    await refused.write({ entity: 'x', entityId: 'e', kind: 'create', payload: {} });
    await refused.flush();
    expect(r).toEqual([]);
    expect(refused.state()!.commands[0].lastError).toBe('no');
  });
});
