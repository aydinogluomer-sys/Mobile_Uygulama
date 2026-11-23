/**
 * R07.01 / R07.02 / R07.05 / R07.06 — journal text, moods, the mood-habit
 * relation and the review's next action.
 */
import {
  extractTags, normalizeTag, tagForName, linkedHabits, withTag, tagCounts, parseBlocks, parseInline,
  wrapSelection, toggleListLine, draftDiffers,
} from '../../lib/journalText';
import {
  BUILT_IN_MOODS, legacyMoodId, validateDefinition, editDefinition, makeCheckin, checkinLabel, dailyMoods, allMoods,
  latestEnergyOn, lowEnergySuggested, withEnergy,
  type MoodDefinition,
} from '../../lib/moods';
import { moodHabitRelation, relationSentence, MIN_DAYS, MIN_PER_GROUP } from '../../lib/moodHabitRelation';
import { nextWeekMonday, taskTitleFrom, upsertAction, actionFor, previousWeekKey, actionOutcome } from '../../lib/reviewActions';
import { addDaysLocal, ymd } from '../../lib/date';
import type { Habit } from '../../lib/supabase';

describe('R07.01 — tags and habit links', () => {
  it('finds #tags, Turkish-case-folded, unique, not headings', () => {
    expect(extractTags('# Başlık\nBugün #İş yoğundu, #iş #Spor-1 (#okuma) a#b')).toEqual(['iş', 'spor-1', 'okuma']);
    expect(normalizeTag('İSTANBUL')).toBe('istanbul');
  });
  it('a habit name as a tag links the habit', () => {
    const habits = [{ id: 'h1', name: 'Su iç' }, { id: 'h2', name: 'Kitap Oku' }];
    expect(tagForName('Su iç')).toBe('su-iç');
    expect(linkedHabits('Sabah #su-iç yaptım', habits).map((h) => h.id)).toEqual(['h1']);
  });
  it('filters and counts by tag', () => {
    const es = [{ content: '#a #b' }, { content: '#a' }, { content: null }];
    expect(withTag(es, 'A')).toHaveLength(2);
    expect(tagCounts(es)).toEqual([{ tag: 'a', count: 2 }, { tag: 'b', count: 1 }]);
  });
});

describe('R07.01 — light formatting', () => {
  it('headings, list items, bold and italic; unmatched markers stay text', () => {
    const b = parseBlocks('# Gün\n- **iyi** bir _gün_\n\nnormal **açık');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'item', 'blank', 'para']);
    expect(parseInline('a **b** _c_')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }]);
    expect(parseInline('normal **açık')).toEqual([{ text: 'normal **açık' }]);
  });
  it('the toolbar wraps a selection and toggles a list line', () => {
    expect(wrapSelection('merhaba dünya', 0, 7, '**')).toEqual({ text: '**merhaba** dünya', cursor: 11 });
    expect(toggleListLine('a\nb', 2).text).toBe('a\n- b');
    expect(toggleListLine('a\n- b', 4).text).toBe('a\nb');
  });
});

describe('R07.01 — offline draft', () => {
  it('a draft is restored only while it differs from what was saved', () => {
    const d = { date: '2026-10-07', content: 'yazdım', mood: 3, savedAt: 1 };
    expect(draftDiffers(d, undefined)).toBe(true);
    expect(draftDiffers(d, { content: 'yazdım', mood: 3 })).toBe(false);
    expect(draftDiffers(d, { content: 'yazdım', mood: null })).toBe(true);
    expect(draftDiffers(null, undefined)).toBe(false);
  });
});

describe('R07.02 — moods with identity', () => {
  const custom: MoodDefinition = { id: 'c1', name: 'Huzurlu', icon: '🌿', valence: 4, builtIn: false, archived: false };
  it('legacy numbers are pinned built-in ids', () => {
    expect(legacyMoodId(2)).toBe('builtin-2');
    expect(legacyMoodId(0)).toBeNull();
    expect(BUILT_IN_MOODS.map((m) => m.valence)).toEqual([1, 2, 3, 4, 5]);
  });
  it('validation: name, one emoji, valence 1..5, no duplicate names', () => {
    expect(validateDefinition({ id: 'x', name: ' Sakin ', icon: '😌', valence: 4 }, []).ok).toBe(true);
    expect(validateDefinition({ id: 'x', name: '', icon: '😌', valence: 4 }, []).ok).toBe(false);
    expect(validateDefinition({ id: 'x', name: 'A', icon: '', valence: 4 }, []).ok).toBe(false);
    expect(validateDefinition({ id: 'x', name: 'A', icon: '😌', valence: 6 }, []).ok).toBe(false);
    expect(validateDefinition({ id: 'x', name: 'iyi', icon: '😌', valence: 4 }, []).ok).toBe(false); // built-in 'İyi'
  });
  it('a rename keeps the id; past check-ins keep what they recorded', () => {
    const c = makeCheckin(custom, { id: 'k', at: new Date(2026, 9, 7, 9), day: '2026-10-07', intensity: 2 });
    const renamed = editDefinition([custom], { ...custom, name: 'Dingin', valence: 5 });
    expect(renamed[0].id).toBe('c1');
    expect(c).toMatchObject({ moodId: 'c1', label: 'Huzurlu', valence: 4 });
    expect(checkinLabel(c, renamed)).toBe('Huzurlu (şimdi: Dingin)');
    expect(editDefinition(BUILT_IN_MOODS, { ...BUILT_IN_MOODS[0], name: 'X' })[0].name).toBe(BUILT_IN_MOODS[0].name);
  });
  it('archived moods are not offered', () => {
    expect(allMoods([{ ...custom, archived: true }])).toHaveLength(5);
  });
  it('a day\'s mood: mean of its check-ins, else the journal mood', () => {
    const k = (day: string, valence: number) => makeCheckin({ ...custom, valence }, { id: day + valence, at: new Date(), day, intensity: 1 });
    const out = dailyMoods([k('2026-10-07', 2), k('2026-10-07', 4)], [{ date: '2026-10-07', mood: 1 }, { date: '2026-10-06', mood: 5 }]);
    expect(out.find((d) => d.date === '2026-10-07')?.mood).toBe(3);
    expect(out.find((d) => d.date === '2026-10-06')?.mood).toBe(5);
  });
  it('F37 — latestEnergyOn picks newest energized check-in of that day; lowEnergySuggested & dailyMoods behave cleanly', () => {
    const cLowEarly = makeCheckin(custom, { id: 'e1', at: new Date('2026-10-07T08:00:00.000Z'), day: '2026-10-07', intensity: 2, energy: 'low' });
    const cNoEnergyLater = makeCheckin(custom, { id: 'e2', at: new Date('2026-10-07T11:00:00.000Z'), day: '2026-10-07', intensity: 2 });
    const cHighLater = makeCheckin(custom, { id: 'e3', at: new Date('2026-10-07T15:00:00.000Z'), day: '2026-10-07', intensity: 2, energy: 'high' });
    const cOtherDayLow = makeCheckin(custom, { id: 'e4', at: new Date('2026-10-06T20:00:00.000Z'), day: '2026-10-06', intensity: 2, energy: 'low' });

    // Newer check-in without energy does not erase earlier energy on the same day
    expect(latestEnergyOn([cNoEnergyLater, cLowEarly], '2026-10-07')).toBe('low');
    expect(lowEnergySuggested([cNoEnergyLater, cLowEarly], '2026-10-07')).toBe(true);

    // Later high energy overrides earlier low energy regardless of array order
    expect(latestEnergyOn([cLowEarly, cHighLater, cNoEnergyLater], '2026-10-07')).toBe('high');
    expect(lowEnergySuggested([cLowEarly, cHighLater, cNoEnergyLater], '2026-10-07')).toBe(false);

    // Other day's low energy or no energy -> false
    expect(lowEnergySuggested([cOtherDayLow, cNoEnergyLater], '2026-10-07')).toBe(false);
    expect(lowEnergySuggested([], '2026-10-07')).toBe(false);

    // withEnergy(c, null) strips energy without mutating input; dailyMoods ignores energy
    const stripped = withEnergy(cLowEarly, null);
    expect('energy' in stripped).toBe(false);
    expect(cLowEarly.energy).toBe('low');
    expect(dailyMoods([cLowEarly, cHighLater], [])).toEqual(dailyMoods([stripped, withEnergy(cHighLater, null)], []));
  });
});

describe('R07.05 — mood and a habit, described, not explained', () => {
  const habit = { id: 'h1', status: 'active', behavior_type: 'positive', frequency_config: { kind: 'daily' }, created_at: '2026-01-01T00:00:00', end_condition: null } as unknown as Habit;
  const from = new Date(2026, 8, 1);
  const days = (n: number) => Array.from({ length: n }, (_, i) => ymd(addDaysLocal(from, i)));

  it('below the thresholds it says so, with the counts', () => {
    const ds = days(10);
    const r = moodHabitRelation({ habit, logs: ds.map((d) => ({ habit_id: 'h1', completed_at: d, state: 'done' })), moods: ds.map((d) => ({ date: d, mood: 4 })), from, to: addDaysLocal(from, 9) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(new RegExp(`en az ${MIN_DAYS}`));
    const ds2 = days(20);
    const r2 = moodHabitRelation({ habit, logs: ds2.slice(0, 17).map((d) => ({ habit_id: 'h1', completed_at: d, state: 'done' })), moods: ds2.map((d) => ({ date: d, mood: 3 })), from, to: addDaysLocal(from, 19) });
    expect(!r2.ok && r2.reason).toMatch(new RegExp(`en az ${MIN_PER_GROUP}`));
  });

  it('with enough paired days it compares means; skips and mood-less days are out', () => {
    const ds = days(24);
    const logs = ds.map((d, i) => ({ habit_id: 'h1', completed_at: d, state: i < 12 ? 'done' : i < 20 ? 'miss' : 'skip' }));
    const moods = ds.map((d, i) => ({ date: d, mood: i < 12 ? 4 : 2 }));
    const r = moodHabitRelation({ habit, logs, moods: [...moods, { date: '2026-09-30', mood: null }], from, to: addDaysLocal(from, 23) });
    expect(r).toMatchObject({ ok: true, didDays: 12, didNotDays: 8, didMean: 4, didNotMean: 2, diff: 2 });
    const text = relationSentence('Yürüyüş', r);
    expect(text).toMatch(/birlikte görülme/);
    expect(text).not.toMatch(/çünkü|sayesinde|yol açar\b|neden olur/);
  });

  it('a negative habit with no log is unknown, not "did not"', () => {
    const neg = { ...habit, behavior_type: 'negative' } as Habit;
    const ds = days(20);
    const r = moodHabitRelation({ habit: neg, logs: [], moods: ds.map((d) => ({ date: d, mood: 3 })), from, to: addDaysLocal(from, 19) });
    expect(r).toMatchObject({ didDays: 0, didNotDays: 0 });
  });
});

describe('R07.06 — next action', () => {
  it('next week starts on the following Monday; a task title comes from the first line', () => {
    expect(nextWeekMonday('2026-10-05')).toBe('2026-10-12');
    expect(taskTitleFrom('\n- Sabah yürüyüşünü 07:00\'ye al\nikinci satır')).toBe("Sabah yürüyüşünü 07:00'ye al");
  });
  it('one action per week; last week is found; outcome says what happened', () => {
    const a = { weekKey: '2026-10-05', kind: 'task' as const, taskId: 't1', label: 'Yürüyüş', createdAt: 'x' };
    const list = upsertAction(upsertAction([], a), { ...a, label: 'Yeni' });
    expect(list).toHaveLength(1);
    expect(actionFor(list, '2026-10-05')?.label).toBe('Yeni');
    expect(previousWeekKey('2026-10-12')).toBe('2026-10-05');
    expect(actionOutcome(a, { taskCompleted: () => true })).toBe('Yürüyüş — yapıldı');
    expect(actionOutcome(a, { taskCompleted: () => false })).toBe('Yürüyüş — henüz yapılmadı');
    expect(actionOutcome(a, { taskCompleted: () => undefined })).toBe('Yürüyüş — görev bulunamadı');
  });
});
