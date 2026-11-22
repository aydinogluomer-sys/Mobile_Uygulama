/**
 * Task Decomposition Service V2 tests.  (Phase 3, CODER-L, plan §15 / Gate D + F30 verb families & parent link)
 *
 * Pure domain tests, no I/O, no Supabase, no store. Every hostile/malformed
 * input class is asserted alongside F30 verb-family step derivation, 2-min
 * starter descriptions, emoji-safe topic truncation, and parent linkage.
 */
import {
  validateSubtaskProposal,
  buildLocalSplitProposal,
  toSplitTaskInputs,
  deriveSplitSteps,
  shortTopic,
  STEP_FAMILIES,
  GENERIC_STEPS,
  MAX_TOPIC_LENGTH,
  MAX_SUBTASKS_PER_PROPOSAL,
  MAX_SUBTASK_TITLE_LENGTH,
  MAX_SUBTASK_DESCRIPTION_LENGTH,
  type SubtaskDecompositionProposal,
} from '../../lib/taskDecomposition';

function validRaw(): SubtaskDecompositionProposal {
  return {
    subtasks: [
      { title: 'Gerekenleri tek bir yere topla — Rapor', description: '2 dk · ilk adım · 15 dk blok (1/3)' },
      { title: 'İlk taslağı 10 dakikada çıkar — Rapor', description: '15 dk blok (2/3)' },
      { title: 'Gözden geçir ve bitir — Rapor', description: '15 dk blok (3/3)' },
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
    expect(result.proposal.subtasks[0]).toEqual({
      title: 'Gerekenleri tek bir yere topla — Rapor',
      description: '2 dk · ilk adım · 15 dk blok (1/3)',
    });
  });

  it('trims title/description', () => {
    const raw = validRaw();
    raw.subtasks[0].title = '  Gerekenleri tek bir yere topla — Rapor  ';
    raw.subtasks[0].description = '  2 dk · ilk adım · 15 dk blok (1/3)  ';
    const result = validateSubtaskProposal(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.proposal.subtasks[0].title).toBe('Gerekenleri tek bir yere topla — Rapor');
    expect(result.proposal.subtasks[0].description).toBe('2 dk · ilk adım · 15 dk blok (1/3)');
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
// F30 (INT-15) -- Verb-family concrete steps, 2-min starter, and safe length
// ---------------------------------------------------------------------------

describe('deriveSplitSteps, shortTopic & buildLocalSplitProposal (F30)', () => {
  it('derives concrete Turkish action steps from the trailing task verb and falls back to GENERIC_STEPS', () => {
    const prep = buildLocalSplitProposal('Vergi beyannamesini hazırla', 25);
    const rPrep = validateSubtaskProposal(prep);
    expect(rPrep.ok).toBe(true);
    if (!rPrep.ok) throw new Error('expected ok:true');
    expect(rPrep.proposal.subtasks.map((s) => s.title)).toEqual([
      'Gerekenleri tek bir yere topla — Vergi beyannamesini hazırla',
      'İlk taslağı 10 dakikada çıkar — Vergi beyannamesini hazırla',
      'Gözden geçir ve bitir — Vergi beyannamesini hazırla',
    ]);
    expect(rPrep.proposal.subtasks[0].description).toMatch(/^2 dk/);
    expect(rPrep.proposal.subtasks[1].description).toBe('25 dk blok (2/3)');
    expect(rPrep.proposal.subtasks[2].description).toBe('25 dk blok (3/3)');

    expect(deriveSplitSteps('Mutfağı topla')[0]).toBe('Tek bir köşe seç');
    expect(deriveSplitSteps('Doktoru ara')[0]).toBe('Numarayı ya da formu bul');
    expect(deriveSplitSteps('E-postayı gönder')[0]).toBe('Göndereceğin şeyi hazır et');
    expect(deriveSplitSteps('Faturayı öde')[0]).toBe('Ödeme bilgisini bul');
    expect(deriveSplitSteps('Makaleyi oku')[0]).toBe('Kaynağı aç');
    expect(deriveSplitSteps(' Dönem sonu sunumu ')).toEqual(GENERIC_STEPS);
  });

  it('keeps every step <= 45 chars, omits generic Devam/Bitiş/Pomodoro labels, and validates 140+, 1000-char, and emoji titles', () => {
    for (const fam of STEP_FAMILIES) {
      for (const step of fam.steps) {
        expect(step.length).toBeLessThanOrEqual(45);
        expect(step).not.toMatch(/\b(?:Devam|Bitiş|Pomodoro)\b/);
      }
    }
    for (const step of GENERIC_STEPS) {
      expect(step.length).toBeLessThanOrEqual(45);
    }

    const long140 = 'Çok uzun bir proje planlama görevi '.repeat(5).trim();
    expect(long140.length).toBeGreaterThanOrEqual(140);
    expect(validateSubtaskProposal(buildLocalSplitProposal(long140, 45)).ok).toBe(true);

    const long1000 = 'x'.repeat(1000);
    expect(validateSubtaskProposal(buildLocalSplitProposal(long1000, 15)).ok).toBe(true);

    const emojiTitle = `${'🔥🎯✨'.repeat(30)} hazırla`;
    const rEmoji = validateSubtaskProposal(buildLocalSplitProposal(emojiTitle, 25));
    expect(rEmoji.ok).toBe(true);
    // Surrogate pairs are never sliced in half (no lone surrogates)
    expect(shortTopic(emojiTitle, MAX_TOPIC_LENGTH)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(shortTopic(emojiTitle, MAX_TOPIC_LENGTH)).not.toContain('...');
    expect(shortTopic(emojiTitle, MAX_TOPIC_LENGTH)).not.toContain('…');
  });
});

// ---------------------------------------------------------------------------
// Assembly -- toSplitTaskInputs inherits parent context + parent_task_id / is_subtask
// ---------------------------------------------------------------------------

describe('toSplitTaskInputs', () => {
  const parent = {
    id: 'parent-99',
    priority: 'high' as const,
    due_date: '2026-09-01',
    project_id: 'proj-1',
    list_type: 'this_week' as const,
  };

  it('inherits status/priority/due_date/project_id/list_type/completed AND sets parent_task_id + is_subtask:true', () => {
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
      expect(row.parent_task_id).toBe('parent-99');
      expect(row.is_subtask).toBe(true);
    }
    expect(rows[0].title).toBe('Gerekenleri tek bir yere topla — Rapor');
    expect(rows[0].description).toBe('2 dk · ilk adım · 15 dk blok (1/3)');
  });

  it('a null proposal description becomes "" -- a structural default for a non-nullable DB column', () => {
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
    const rows = toSplitTaskInputs(result.proposal, {
      id: 'parent-empty',
      priority: 'none',
      due_date: null,
      project_id: null,
      list_type: 'inbox',
    });
    expect(rows[0].due_date).toBeNull();
    expect(rows[0].project_id).toBeNull();
    expect(rows[0].parent_task_id).toBe('parent-empty');
    expect(rows[0].is_subtask).toBe(true);
  });
});
