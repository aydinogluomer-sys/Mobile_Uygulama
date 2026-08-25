/**
 * Task Decomposition Service V2 tests.  (Phase 3, CODER-L, plan §15 / Gate D)
 *
 * Same instrument as `__tests__/lib/routineProposal.test.ts`: pure domain
 * tests, no I/O, no Supabase, no store. Every hostile/malformed input class
 * named in this task's brief gets its own assertion, and the happy path is
 * proven to still match the OLD hard-coded template exactly (preserving
 * existing behaviour/Turkish copy, per the brief).
 */
import {
  validateSubtaskProposal,
  buildLocalSplitProposal,
  toSplitTaskInputs,
  SPLIT_LABELS,
  MAX_SUBTASKS_PER_PROPOSAL,
  MAX_SUBTASK_TITLE_LENGTH,
  MAX_SUBTASK_DESCRIPTION_LENGTH,
  type SubtaskDecompositionProposal,
} from '../../lib/taskDecomposition';

function validRaw(): SubtaskDecompositionProposal {
  return {
    subtasks: [
      { title: 'Rapor — Başlangıç', description: '15 dk blok (1/3)' },
      { title: 'Rapor — Devam', description: '15 dk blok (2/3)' },
      { title: 'Rapor — Bitiş', description: '15 dk blok (3/3)' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('validateSubtaskProposal -- the happy path', () => {
  it('accepts a well-formed proposal', () => {
    const result = validateSubtaskProposal(validRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks).toHaveLength(3);
    expect(result.proposal.subtasks[0]).toEqual({ title: 'Rapor — Başlangıç', description: '15 dk blok (1/3)' });
  });

  it('trims title/description', () => {
    const raw = validRaw();
    raw.subtasks[0].title = '  Rapor — Başlangıç  ';
    raw.subtasks[0].description = '  15 dk blok (1/3)  ';
    const result = validateSubtaskProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks[0].title).toBe('Rapor — Başlangıç');
    expect(result.proposal.subtasks[0].description).toBe('15 dk blok (1/3)');
  });

  it('accepts a null description -- "no description supplied" is a valid, real state', () => {
    const result = validateSubtaskProposal({ subtasks: [{ title: 'Tek adım', description: null }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks[0].description).toBeNull();
  });

  it('accepts a proposal that omits description entirely', () => {
    const result = validateSubtaskProposal({ subtasks: [{ title: 'Tek adım' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks[0].description).toBeNull();
  });

  it('the ok:false branch never carries a usable "proposal" field', () => {
    const result = validateSubtaskProposal({ subtasks: [] });
    expect(result.ok).toBe(false);
    expect('proposal' in result).toBe(false);
  });

  it('accumulates every error in one pass instead of failing fast', () => {
    const raw = { subtasks: [{ title: '', description: null }, { title: 123, description: null }] };
    const result = validateSubtaskProposal(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.errors.some((e) => e.path === 'subtasks[0].title')).toBe(true);
    expect(result.errors.some((e) => e.path === 'subtasks[1].title')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hostile input -- every class named in this task's brief
// ---------------------------------------------------------------------------

describe('validateSubtaskProposal -- hostile input', () => {
  it('rejects null', () => {
    expect(validateSubtaskProposal(null).ok).toBe(false);
  });

  it('rejects undefined', () => {
    expect(validateSubtaskProposal(undefined).ok).toBe(false);
  });

  it('rejects a bare string', () => {
    expect(validateSubtaskProposal('not an object').ok).toBe(false);
  });

  it('rejects a bare number', () => {
    expect(validateSubtaskProposal(42).ok).toBe(false);
  });

  it('rejects an array at the root (not a plain object)', () => {
    expect(validateSubtaskProposal([]).ok).toBe(false);
  });

  it('rejects an empty object (missing subtasks)', () => {
    expect(validateSubtaskProposal({}).ok).toBe(false);
  });

  it('rejects subtasks: null', () => {
    const r = validateSubtaskProposal({ subtasks: null });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/expected an array/);
  });

  it('rejects subtasks: "nope" (wrong type)', () => {
    expect(validateSubtaskProposal({ subtasks: 'nope' }).ok).toBe(false);
  });

  it('rejects an empty subtasks array', () => {
    const r = validateSubtaskProposal({ subtasks: [] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/at least one subtask/);
  });

  it(`rejects an absurd subtask count (> ${MAX_SUBTASKS_PER_PROPOSAL})`, () => {
    const subtasks = Array.from({ length: MAX_SUBTASKS_PER_PROPOSAL + 1 }, (_, i) => ({ title: `Adım ${i}`, description: null }));
    const r = validateSubtaskProposal({ subtasks });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/exceeds max/);
  });

  it('rejects a genuinely absurd count (500 subtasks)', () => {
    const subtasks = Array.from({ length: 500 }, (_, i) => ({ title: `Adım ${i}`, description: null }));
    expect(validateSubtaskProposal({ subtasks }).ok).toBe(false);
  });

  it('rejects a non-string title (number)', () => {
    const r = validateSubtaskProposal({ subtasks: [{ title: 123, description: null }] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors.some((e) => e.path === 'subtasks[0].title')).toBe(true);
  });

  it('rejects a null title', () => {
    expect(validateSubtaskProposal({ subtasks: [{ title: null, description: null }] }).ok).toBe(false);
  });

  it('rejects an empty-string title', () => {
    expect(validateSubtaskProposal({ subtasks: [{ title: '   ', description: null }] }).ok).toBe(false);
  });

  it(`rejects a title exceeding ${MAX_SUBTASK_TITLE_LENGTH} characters`, () => {
    const r = validateSubtaskProposal({ subtasks: [{ title: 'x'.repeat(MAX_SUBTASK_TITLE_LENGTH + 1), description: null }] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/exceeds max length/);
  });

  it(`rejects a description exceeding ${MAX_SUBTASK_DESCRIPTION_LENGTH} characters`, () => {
    const r = validateSubtaskProposal({ subtasks: [{ title: 'ok', description: 'x'.repeat(MAX_SUBTASK_DESCRIPTION_LENGTH + 1) }] });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-string, non-null description', () => {
    expect(validateSubtaskProposal({ subtasks: [{ title: 'ok', description: 42 }] }).ok).toBe(false);
  });

  it('rejects duplicate titles (case-insensitive)', () => {
    const r = validateSubtaskProposal({
      subtasks: [{ title: 'Aynı Görev', description: null }, { title: 'aynı görev', description: null }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/duplicate subtask title/);
  });

  it('rejects an unexpected top-level field', () => {
    expect(validateSubtaskProposal({ subtasks: [{ title: 'ok', description: null }], extra: 'nope' }).ok).toBe(false);
  });

  it('rejects an unexpected per-subtask field', () => {
    expect(validateSubtaskProposal({ subtasks: [{ title: 'ok', description: null, status: 'archived' }] }).ok).toBe(false);
  });

  it('a subtask cannot smuggle in a status/priority field that would bypass parent-task inheritance', () => {
    const r = validateSubtaskProposal({ subtasks: [{ title: 'ok', description: null, priority: 'high' }] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/unexpected field/);
  });

  it('rejects a __proto__ key on the root object, arriving via real JSON.parse (not just an object literal)', () => {
    const json = '{"subtasks":[{"title":"x","description":null}],"__proto__":{"polluted":true}}';
    const parsed = JSON.parse(json);
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
    const r = validateSubtaskProposal(parsed);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/forbidden key/);
  });

  it('rejects a constructor key inside a subtask, via real JSON.parse', () => {
    const json = '{"subtasks":[{"title":"x","description":null,"constructor":{"polluted":true}}]}';
    const r = validateSubtaskProposal(JSON.parse(json));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/forbidden key/);
  });

  it('rejects a non-object subtask entry inside an otherwise-valid array', () => {
    const r = validateSubtaskProposal({ subtasks: ['not an object'] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected ok:false');
    expect(r.errors[0].message).toMatch(/expected an object/);
  });
});

// ---------------------------------------------------------------------------
// Preserving existing behaviour -- buildLocalSplitProposal matches the OLD
// component's hard-coded template table exactly.
// ---------------------------------------------------------------------------

describe('buildLocalSplitProposal -- preserves the original ADHDTaskSplitter behaviour/copy', () => {
  it('15-minute preset uses the original Turkish labels', () => {
    const raw = buildLocalSplitProposal('Rapor Hazırla', 15);
    const result = validateSubtaskProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks.map((s) => s.title)).toEqual([
      'Rapor Hazırla — Başlangıç',
      'Rapor Hazırla — Devam',
      'Rapor Hazırla — Bitiş',
    ]);
    expect(result.proposal.subtasks.map((s) => s.description)).toEqual([
      '15 dk blok (1/3)',
      '15 dk blok (2/3)',
      '15 dk blok (3/3)',
    ]);
  });

  it('25-minute preset uses the original Pomodoro labels', () => {
    const raw = buildLocalSplitProposal('Rapor Hazırla', 25);
    const result = validateSubtaskProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks.map((s) => s.title)).toEqual([
      'Rapor Hazırla — 1. Pomodoro',
      'Rapor Hazırla — 2. Pomodoro',
      'Rapor Hazırla — 3. Pomodoro',
    ]);
  });

  it('45-minute preset uses the original Deep Work labels', () => {
    const raw = buildLocalSplitProposal('Rapor Hazırla', 45);
    const result = validateSubtaskProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks.map((s) => s.title)).toEqual([
      'Rapor Hazırla — Hazırlık & Araştırma',
      'Rapor Hazırla — Ana Çalışma',
      'Rapor Hazırla — Gözden Geçirme',
    ]);
  });

  it('an unknown duration falls back to the original generic "Parça N" labels', () => {
    const raw = buildLocalSplitProposal('Bir Görev', 99);
    const result = validateSubtaskProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks.map((s) => s.title)).toEqual([
      'Bir Görev — Parça 1',
      'Bir Görev — Parça 2',
      'Bir Görev — Parça 3',
    ]);
  });

  it('SPLIT_LABELS is exported and matches the three original presets', () => {
    expect(SPLIT_LABELS[15]).toEqual(['Başlangıç', 'Devam', 'Bitiş']);
    expect(SPLIT_LABELS[25]).toEqual(['1. Pomodoro', '2. Pomodoro', '3. Pomodoro']);
    expect(SPLIT_LABELS[45]).toEqual(['Hazırlık & Araştırma', 'Ana Çalışma', 'Gözden Geçirme']);
  });

  it('every real preset the app offers survives validation (never rejected by construction)', () => {
    for (const minutes of [15, 25, 45]) {
      const result = validateSubtaskProposal(buildLocalSplitProposal('Herhangi Bir Görev', minutes));
      expect(result.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Assembly -- toSplitTaskInputs only runs on already-validated input, never
// invents a field the AI/local schema does not cover.
// ---------------------------------------------------------------------------

describe('toSplitTaskInputs', () => {
  const parent = { priority: 'high' as const, due_date: '2026-09-01', project_id: 'proj-1', list_type: 'this_week' as const };

  it('inherits status/priority/due_date/project_id/list_type/completed from the PARENT task, never the proposal', () => {
    const result = validateSubtaskProposal(validRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    const rows = toSplitTaskInputs(result.proposal, parent);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('pending');
      expect(row.priority).toBe('high');
      expect(row.due_date).toBe('2026-09-01');
      expect(row.project_id).toBe('proj-1');
      expect(row.list_type).toBe('this_week');
      expect(row.completed).toBe(false);
    }
    expect(rows[0].title).toBe('Rapor — Başlangıç');
    expect(rows[0].description).toBe('15 dk blok (1/3)');
  });

  it('a null proposal description becomes "" -- a structural default for a non-nullable DB column, not an invented fact', () => {
    const result = validateSubtaskProposal({ subtasks: [{ title: 'Tek adım', description: null }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    const rows = toSplitTaskInputs(result.proposal, parent);
    expect(rows[0].description).toBe('');
  });

  it('a null parent due_date/project_id passes through as null, not a guessed value', () => {
    const result = validateSubtaskProposal({ subtasks: [{ title: 'Tek adım', description: null }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    const rows = toSplitTaskInputs(result.proposal, { priority: 'none', due_date: null, project_id: null, list_type: 'inbox' });
    expect(rows[0].due_date).toBeNull();
    expect(rows[0].project_id).toBeNull();
  });
});
