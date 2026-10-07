/**
 * R01.04 — a habit's checklist: steps, a day's instance, and the log the
 * checks lead to.
 */
import {
  currentItems, itemsOn, progressOn, logStepFor, validateItem, nextPosition, progressLabel,
  MAX_CHECKLIST_ITEMS, type ChecklistItem, type ChecklistCheck,
} from '../../lib/habitChecklist';

const item = (id: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id, habit_id: 'h1', title: id, required: true, position: 0,
  created_at: '2026-09-01T08:00:00', archived_at: null, ...over,
});
const tick = (item_id: string, day = '2026-10-07', habit_id = 'h1'): ChecklistCheck => ({ item_id, habit_id, day });

const WARM = item('ısın', { position: 0 });
const SETS = item('3 set', { position: 1 });
const STRETCH = item('esne', { position: 2, required: false });
const ITEMS = [STRETCH, SETS, WARM];

describe('steps and a day\'s instance', () => {
  it('current steps in order, archived ones left out, other habits ignored', () => {
    const other = item('x', { habit_id: 'h2' });
    const gone = item('eski', { archived_at: '2026-10-01T10:00:00' });
    expect(currentItems([...ITEMS, other, gone], 'h1').map((i) => i.id)).toEqual(['ısın', '3 set', 'esne']);
  });

  it('a past day keeps the steps it had: archived later still applies, added later does not', () => {
    const gone = item('eski', { archived_at: '2026-10-05T10:00:00' });
    const fresh = item('yeni', { created_at: '2026-10-06T09:00:00' });
    expect(itemsOn([gone, fresh], 'h1', '2026-10-04').map((i) => i.id)).toEqual(['eski']);
    expect(itemsOn([gone, fresh], 'h1', '2026-10-05').map((i) => i.id)).toEqual([]);
    expect(itemsOn([gone, fresh], 'h1', '2026-10-06').map((i) => i.id)).toEqual(['yeni']);
  });
});

describe('progress -> state', () => {
  it('every required step -> done, optional steps do not matter', () => {
    expect(progressOn(ITEMS, [tick('ısın'), tick('3 set')], 'h1', '2026-10-07').state).toBe('done');
  });

  it('some progress, not every required -> partial', () => {
    expect(progressOn(ITEMS, [tick('ısın')], 'h1', '2026-10-07').state).toBe('partial');
    expect(progressOn(ITEMS, [tick('esne')], 'h1', '2026-10-07').state).toBe('partial');
  });

  it('nothing ticked -> none; ticks of another day do not count', () => {
    expect(progressOn(ITEMS, [], 'h1', '2026-10-07').state).toBe('none');
    expect(progressOn(ITEMS, [tick('ısın', '2026-10-06'), tick('3 set', '2026-10-06')], 'h1', '2026-10-07').state).toBe('none');
  });

  it('only optional steps: any tick is done', () => {
    const opt = [item('a', { required: false }), item('b', { required: false })];
    expect(progressOn(opt, [tick('a')], 'h1', '2026-10-07').state).toBe('done');
  });

  it('counts are reported separately', () => {
    const p = progressOn(ITEMS, [tick('ısın'), tick('esne')], 'h1', '2026-10-07');
    expect(p).toMatchObject({ requiredTotal: 2, requiredDone: 1, optionalTotal: 1, optionalDone: 1 });
    expect(progressLabel(p)).toBe('1/2 zorunlu · 1/1 isteğe bağlı');
  });
});

describe('the log a tick leads to', () => {
  const P = (state: 'done' | 'partial' | 'none') => ({ requiredTotal: 2, requiredDone: 0, optionalTotal: 0, optionalDone: 0, state });

  it('writes the derived state when it differs from the log', () => {
    expect(logStepFor(P('done'), undefined)).toBe('done');
    expect(logStepFor(P('partial'), 'done')).toBe('partial');
    expect(logStepFor(P('done'), 'partial')).toBe('done');
  });

  it('writes nothing when the log already says it', () => {
    expect(logStepFor(P('done'), 'done')).toBeNull();
    expect(logStepFor(P('partial'), 'partial')).toBeNull();
  });

  it('nothing left ticked: miss on a logged day, nothing on an unlogged one', () => {
    expect(logStepFor(P('none'), 'partial')).toBe('miss');
    expect(logStepFor(P('none'), 'done')).toBe('miss');
    expect(logStepFor(P('none'), undefined)).toBeNull();
    expect(logStepFor(P('none'), 'miss')).toBeNull();
  });
});

describe('editing steps', () => {
  it('a step needs a name, within limits, not twice', () => {
    expect(validateItem('  ısınma ', [], 'h1')).toEqual({ ok: true, title: 'ısınma' });
    expect(validateItem('   ', [], 'h1').ok).toBe(false);
    expect(validateItem('x'.repeat(81), [], 'h1').ok).toBe(false);
    expect(validateItem('ISIN', [WARM], 'h1').ok).toBe(false);
  });

  it('at most 12 current steps (archived ones do not count)', () => {
    const full = Array.from({ length: MAX_CHECKLIST_ITEMS }, (_, i) => item(`s${i}`, { position: i }));
    expect(validateItem('bir tane daha', full, 'h1').ok).toBe(false);
    const oneGone = full.map((x, i) => (i === 0 ? { ...x, archived_at: '2026-10-01T00:00:00' } : x));
    expect(validateItem('bir tane daha', oneGone, 'h1').ok).toBe(true);
  });

  it('a new step goes to the end', () => {
    expect(nextPosition([], 'h1')).toBe(0);
    expect(nextPosition(ITEMS, 'h1')).toBe(3);
  });
});
