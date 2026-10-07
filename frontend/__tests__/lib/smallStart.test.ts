/**
 * R03.03 — start small: the step is its own thing, separate from its task.
 */
import {
  validateSmallStep, draftFor, stepPlaceholder, isSmallStep,
  DEFAULT_SMALL_STEP_MINUTES, MAX_SMALL_STEP_MINUTES, MAX_STEP_TITLE, type SmallStepParent,
} from '../../lib/smallStart';
import { snapshotOf, parseSnapshot, startClock } from '../../lib/focusTimer';

const PARENT: SmallStepParent = { kind: 'task', id: 't1', title: 'Tez giriş bölümünü yaz' };

describe('R03.03 — the draft', () => {
  it('starts empty at 10 minutes: the user writes the step', () => {
    expect(draftFor(PARENT)).toEqual({ title: '', minutes: DEFAULT_SMALL_STEP_MINUTES });
  });
  it('the placeholder names the task', () => {
    expect(stepPlaceholder(PARENT)).toContain('Tez giriş bölümünü yaz');
    expect(stepPlaceholder({ ...PARENT, title: 'x'.repeat(80) }).length).toBeLessThan(70);
  });
});

describe('R03.03 — validating a step', () => {
  it('a named step in range is accepted, trimmed', () => {
    const r = validateSmallStep(PARENT, { title: '  ilk paragrafı yaz ', minutes: 5 });
    expect(r).toEqual({ ok: true, step: { title: 'ilk paragrafı yaz', minutes: 5, parent: PARENT } });
  });

  it('a blank step is refused: it would just be the task under a shorter timer', () => {
    expect(validateSmallStep(PARENT, { title: '   ', minutes: 5 }).ok).toBe(false);
  });

  it('length and title limits', () => {
    expect(validateSmallStep(PARENT, { title: 'a', minutes: 0 }).ok).toBe(false);
    expect(validateSmallStep(PARENT, { title: 'a', minutes: 2.5 }).ok).toBe(false);
    expect(validateSmallStep(PARENT, { title: 'a', minutes: MAX_SMALL_STEP_MINUTES + 1 }).ok).toBe(false);
    expect(validateSmallStep(PARENT, { title: 'a', minutes: MAX_SMALL_STEP_MINUTES }).ok).toBe(true);
    expect(validateSmallStep(PARENT, { title: 'a'.repeat(MAX_STEP_TITLE + 1), minutes: 5 }).ok).toBe(false);
  });

  it('the step carries a copy of its parent, never the parent object itself', () => {
    const r = validateSmallStep(PARENT, { title: 'a', minutes: 5 });
    if (!r.ok) throw new Error('expected ok');
    expect(r.step.parent).toEqual(PARENT);
    expect(r.step.parent).not.toBe(PARENT);
  });
});

describe('R03.03 — a running step survives an app kill', () => {
  const step = { title: 'ilk paragraf', minutes: 5, parent: PARENT };
  const base = { phase: 'work' as const, clock: startClock(300, 0), sessionStartedAt: 'x', sessionsCompleted: 0, now: 0 };

  it('round-trips with the step', () => {
    const s = snapshotOf({ ...base, step });
    expect(parseSnapshot(JSON.stringify(s))?.step).toEqual(step);
  });
  it('a plain session has no step', () => {
    expect(parseSnapshot(JSON.stringify(snapshotOf(base)))?.step).toBeUndefined();
  });
  it('a malformed step drops the whole snapshot', () => {
    const s = { ...snapshotOf(base), step: { title: '', minutes: 5, parent: PARENT } };
    expect(parseSnapshot(JSON.stringify(s))).toBeNull();
    expect(isSmallStep({ ...step, parent: { ...PARENT, kind: 'habit' } })).toBe(false);
  });
});
