/**
 * R05.01 / R05.02 / R05.04 / R05.07 — templates, versions, a session's
 * snapshot, and the rules a running session keeps.
 */
import {
  BUILT_IN_TEMPLATES, startSession, currentStep, completeStep, skipStep, backStep, editMark, finishSession,
  pauseSession, resumeSession, timeUp, addStep, removeStep, moveStep, setDuration, applySessionToTemplate,
  latestVersion, versionOf, summarize, habitLogsToWrite, validateStep, stepActiveMs,
  type RoutineTemplate,
} from '../../lib/routineRunner';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const TPL: RoutineTemplate = {
  id: 't1', name: 'Test', builtIn: false,
  versions: [{ version: 1, createdAt: 'x', steps: [
    { id: 'a', title: 'Isın', kind: 'timed', durationSec: 300, habitId: null },
    { id: 'b', title: 'Su iç', kind: 'check', habitId: 'h-water' },
    { id: 'c', title: 'Esne', kind: 'timed', durationSec: 600, habitId: 'h-stretch' },
  ] }],
};

describe('template, version, snapshot', () => {
  it('a session copies the latest version\'s steps; editing the session leaves the template alone', () => {
    let s = startSession(TPL, 's1', T0);
    expect(s.templateVersion).toBe(1);
    s = addStep(s, 'x', { title: 'Ekstra', kind: 'check' });
    s = removeStep(s, 'b', T0);
    expect(s.steps.map((p) => p.id)).toEqual(['a', 'c', 'x']);
    expect(s.edited).toBe(true);
    expect(latestVersion(TPL).steps.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('applying a session makes a NEW version; the old one stays for past sessions', () => {
    let s = startSession(TPL, 's1', T0);
    s = moveStep(s, 'c', -1);
    const t2 = applySessionToTemplate(TPL, s, '2026-10-07T10:00:00Z');
    expect(t2.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(latestVersion(t2).steps.map((p) => p.id)).toEqual(['a', 'c', 'b']);
    expect(versionOf(t2, 1)!.steps.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(TPL.versions).toHaveLength(1);
  });

  it('built-in templates exist for morning, evening and work, each valid', () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).toEqual(['builtin-morning', 'builtin-evening', 'builtin-work']);
    for (const t of BUILT_IN_TEMPLATES) for (const p of latestVersion(t).steps) expect(validateStep(p).ok).toBe(true);
  });
});

describe('running a session', () => {
  it('complete and skip move on; a skipped step is not done', () => {
    let s = startSession(TPL, 's1', T0);
    s = completeStep(s, T0 + MIN);
    expect(currentStep(s)?.id).toBe('b');
    s = skipStep(s, T0 + MIN);
    expect(currentStep(s)?.id).toBe('c');
    expect(s.results.a.mark).toBe('done');
    expect(s.results.b.mark).toBe('skipped');
    expect(summarize(s)).toMatchObject({ done: 1, skipped: 1, open: 1 });
  });

  it('the time running out does not complete a step', () => {
    const s = startSession(TPL, 's1', T0);
    expect(timeUp(s, T0 + 5 * MIN)).toBe(true);
    expect(s.results.a).toBeUndefined();
    expect(currentStep(s)?.id).toBe('a');
  });

  it('a pause is not activity: 4 min work + 3 min pause + 1 min work = 5 min', () => {
    let s = startSession(TPL, 's1', T0);
    s = pauseSession(s, T0 + 4 * MIN);
    s = resumeSession(s, T0 + 7 * MIN);
    expect(stepActiveMs(s, T0 + 8 * MIN)).toBe(5 * MIN);
    s = completeStep(s, T0 + 8 * MIN);
    expect(s.results.a.activeMs).toBe(5 * MIN);
    expect(timeUp(startSession(TPL, 'z', T0), T0 + 4 * MIN)).toBe(false);
  });

  it('back returns to the previous step with its mark kept; any mark can be changed', () => {
    let s = startSession(TPL, 's1', T0);
    s = completeStep(s, T0 + MIN);
    s = backStep(s, T0 + MIN);
    expect(currentStep(s)?.id).toBe('a');
    expect(s.results.a.mark).toBe('done');
    s = editMark(s, 'a', 'skipped', T0 + MIN);
    expect(s.results.a.mark).toBe('skipped');
    s = editMark(s, 'a', null, T0 + MIN);
    expect(s.results.a).toBeUndefined();
  });

  it('after a completion the next OPEN step is current, not one already marked', () => {
    let s = startSession(TPL, 's1', T0);
    s = editMark(s, 'b', 'done', T0);
    s = completeStep(s, T0 + MIN);
    expect(currentStep(s)?.id).toBe('c');
  });

  it('finishing leaves unmarked steps unmarked', () => {
    let s = startSession(TPL, 's1', T0);
    s = completeStep(s, T0 + MIN);
    s = finishSession(s, T0 + 2 * MIN);
    expect(s.status).toBe('finished');
    expect(summarize(s)).toMatchObject({ done: 1, open: 2 });
    expect(completeStep(s, T0 + 3 * MIN)).toBe(s);
  });
});

describe('editing the running session', () => {
  it('re-timing the current step keeps its elapsed time', () => {
    let s = startSession(TPL, 's1', T0);
    s = setDuration(s, 'a', 180);
    expect(s.steps[0].durationSec).toBe(180);
    expect(stepActiveMs(s, T0 + MIN)).toBe(MIN);
    expect(timeUp(s, T0 + 2 * MIN)).toBe(false);
    expect(timeUp(s, T0 + 3 * MIN)).toBe(true);
  });

  it('invalid steps are refused; the last step cannot be removed', () => {
    const s = startSession(TPL, 's1', T0);
    expect(addStep(s, 'x', { title: '  ', kind: 'check' })).toBe(s);
    expect(addStep(s, 'x', { title: 'kısa', kind: 'timed', durationSec: 5 })).toBe(s);
    let one = removeStep(removeStep(s, 'a', T0), 'b', T0);
    expect(one.steps).toHaveLength(1);
    one = removeStep(one, 'c', T0);
    expect(one.steps).toHaveLength(1);
  });

  it('removing the current step moves to the next; removing an earlier one keeps the current', () => {
    let s = startSession(TPL, 's1', T0);
    s = completeStep(s, T0);           // now at b
    const r1 = removeStep(s, 'a', T0);
    expect(currentStep(r1)?.id).toBe('b');
    const r2 = removeStep(s, 'b', T0);
    expect(currentStep(r2)?.id).toBe('c');
  });
});

describe('R05.07 — habits, once', () => {
  it('each completed linked habit is logged once, skipped ones never', () => {
    let s = startSession(TPL, 's1', T0);
    s = completeStep(s, T0);           // a (no habit)
    s = completeStep(s, T0);           // b -> h-water
    s = skipStep(s, T0);               // c -> h-stretch skipped
    expect(habitLogsToWrite(s, [])).toEqual(['h-water']);
    expect(habitLogsToWrite(s, ['h-water'])).toEqual([]);
  });
});
