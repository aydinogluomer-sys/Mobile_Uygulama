import type { SupabaseClient } from '@supabase/supabase-js';
import { createMockDb, makeSupabaseMock } from './supabaseMock';

const clientFor = (db: ReturnType<typeof createMockDb>): SupabaseClient =>
  makeSupabaseMock(db) as unknown as SupabaseClient;

describe('supabaseMock — realistic filters, range, and unique constraints (TST-12)', () => {
  it('filters select rows with .in(), .gte(), .lte(), .gt(), .lt(), and excludes NULL on comparisons', async () => {
    const db = createMockDb();
    const supabase = clientFor(db);
    db.rows.habit_logs = [
      { id: '1', state: 'done', completed_at: '2026-01-01' },
      { id: '2', state: 'partial', completed_at: '2026-01-15' },
      { id: '3', state: 'done', completed_at: '2026-01-31' },
      { id: '4', state: 'miss', completed_at: '2026-01-20' },
      { id: '5', state: 'done', completed_at: '2026-02-01' },
      { id: '6', state: 'done', completed_at: null },
    ];

    const inRes = await supabase
      .from('habit_logs')
      .select('*')
      .in('state', ['done', 'partial']);
    expect(inRes.error).toBeNull();
    expect((inRes.data ?? []).map((r: { id: string }) => r.id)).toEqual(['1', '2', '3', '5', '6']);

    const inclusiveWindow = await supabase
      .from('habit_logs')
      .select('*')
      .in('state', ['done', 'partial'])
      .gte('completed_at', '2026-01-01')
      .lte('completed_at', '2026-01-31T23:59:59');
    expect((inclusiveWindow.data ?? []).map((r: { id: string }) => r.id)).toEqual(['1', '2', '3']);

    const exclusiveWindow = await supabase
      .from('habit_logs')
      .select('*')
      .gt('completed_at', '2026-01-01')
      .lt('completed_at', '2026-01-31');
    expect((exclusiveWindow.data ?? []).map((r: { id: string }) => r.id)).toEqual(['2', '4']);
  });

  it('slices ordered rows via .range(from, to) inclusively', async () => {
    const db = createMockDb();
    const supabase = clientFor(db);
    db.rows.items = [
      { id: 'a', seq: 1 },
      { id: 'b', seq: 2 },
      { id: 'c', seq: 3 },
      { id: 'd', seq: 4 },
    ];

    const res = await supabase
      .from('items')
      .select('*')
      .order('seq', { ascending: true })
      .range(1, 2);
    expect((res.data ?? []).map((r: { id: string }) => r.id)).toEqual(['b', 'c']);
  });

  it('applies .in() and range predicates on update() and delete()', async () => {
    const db = createMockDb();
    const supabase = clientFor(db);
    db.rows.tasks = [
      { id: 'a', title: 'one', score: 1 },
      { id: 'b', title: 'two', score: 2 },
      { id: 'c', title: 'three', score: 3 },
      { id: 'n', title: 'four', score: 4 },
    ];

    await supabase
      .from('tasks')
      .update({ title: 'x' })
      .in('id', ['a', 'b']);
    expect(db.rows.tasks.map((r) => [r.id, r.title])).toEqual([
      ['a', 'x'],
      ['b', 'x'],
      ['c', 'three'],
      ['n', 'four'],
    ]);

    await supabase
      .from('tasks')
      .delete()
      .gt('id', 'm');
    expect(db.rows.tasks.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns 23505 (status 409) on duplicate explicit id without mutating rows, and keeps batch inserts atomic', async () => {
    const db = createMockDb();
    const supabase = clientFor(db);

    const okSingle = await supabase
      .from('goals')
      .insert({ id: 'g-1', title: 'First' })
      .select('*')
      .single();
    expect(okSingle.error).toBeNull();
    expect(okSingle).not.toHaveProperty('status');
    expect(db.rows.goals).toHaveLength(1);

    const dupSingle = await supabase
      .from('goals')
      .insert({ id: 'g-1', title: 'Duplicate' })
      .select('*')
      .single();
    expect(dupSingle).toMatchObject({
      data: null,
      error: { code: '23505' },
      status: 409,
    });
    expect(db.rows.goals).toHaveLength(1);
    expect(db.rows.goals[0].title).toBe('First');

    // Batch insert: second item collides with g-1 -> neither g-2 nor the duplicate is added
    const batchDup = await supabase
      .from('goals')
      .insert([
        { id: 'g-2', title: 'New' },
        { id: 'g-1', title: 'Collides' },
      ]);
    expect(batchDup).toMatchObject({
      data: null,
      error: { code: '23505' },
      status: 409,
    });
    expect(db.rows.goals.map((r) => r.id)).toEqual(['g-1']);
  });

  it('never collides on auto-generated ids, allows duplicates without uniqueKeys, and enforces opt-in composite uniqueKeys', async () => {
    const db = createMockDb();
    const supabase = clientFor(db);

    await supabase.from('journal_entries').insert({ user_id: 'u1', date: '2026-10-08', content: 'a' });
    const secondWithoutConstraint = await supabase
      .from('journal_entries')
      .insert({ user_id: 'u1', date: '2026-10-08', content: 'b' });
    expect(secondWithoutConstraint.error).toBeNull();
    expect(secondWithoutConstraint).not.toHaveProperty('status');
    expect(db.rows.journal_entries).toHaveLength(2);

    // Opt-in composite constraint
    const constrainedDb = createMockDb();
    constrainedDb.uniqueKeys = { journal_entries: [['user_id', 'date']] };
    const constrainedClient = clientFor(constrainedDb);

    await constrainedClient
      .from('journal_entries')
      .insert({ user_id: 'u1', date: '2026-10-08', content: 'first' });
    const compositeDup = await constrainedClient
      .from('journal_entries')
      .insert({ user_id: 'u1', date: '2026-10-08', content: 'second' })
      .select('*')
      .single();
    expect(compositeDup).toMatchObject({
      data: null,
      error: { code: '23505' },
      status: 409,
    });
    expect(constrainedDb.rows.journal_entries).toHaveLength(1);
  });
});
