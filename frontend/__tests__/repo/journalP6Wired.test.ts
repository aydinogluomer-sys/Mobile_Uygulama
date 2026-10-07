/**
 * R07 wiring: a failed journal save is never shown as saved and the text is
 * kept as a draft; archive filters by tag; the reader renders formatting and
 * links; the review's next action is a real task; migration 031 written,
 * not applied.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const raw = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => stripComments(raw(p));

describe('journal editor', () => {
  const j = code('app/screens/journal.tsx');
  it('shows "saved" only after a confirmed save, and keeps the draft otherwise', () => {
    const fn = j.slice(j.indexOf('async function handleSave('), j.indexOf('function format('));
    expect(fn.indexOf('if (!res.ok)')).toBeLessThan(fn.indexOf('setSaved(true)'));
    expect(fn).toMatch(/if \(!res\.ok\) \{[\s\S]*?return;\s*\}/);
    expect(fn).toMatch(/AsyncStorage\.removeItem\(draftKey\(userId, selectedDate\)\)/);
  });
  it('every edit goes to the device draft', () => {
    expect(j).toMatch(/onChangeText=\{\(t\) => edit\(t, mood\)\}/);
    expect(j).toMatch(/AsyncStorage\.setItem\(key, JSON\.stringify\(draft\)\)/);
  });
  it('dates are parsed as local days', () => {
    expect(j).not.toMatch(/new Date\(d\)/);
  });
  it('the store reports the save outcome', () => {
    expect(code('store/journalStore.ts')).toMatch(/if \(!res\.ok\) return \{ ok: false, error: res\.error \};/);
  });
});

describe('archive, reader, review', () => {
  it('archive filters by tag and shows the mood-habit card', () => {
    const a = code('app/screens/journal-archive.tsx');
    expect(a).toMatch(/withTag\(all, tag\)/);
    expect(a).toMatch(/<MoodHabitCard entries=\{all\} \/>/);
  });
  it('reader renders the formatted body with tag and habit links', () => {
    expect(code('app/screens/journal-reader.tsx')).toMatch(/<JournalBody/);
  });
  it('the next action creates a real task through the task store, for next Monday', () => {
    const n = code('components/NextActionPicker.tsx');
    expect(n).toMatch(/await addTask\(\{ title: t, due_date: nextWeekMonday\(weekKey\), list_type: 'this_week'/);
    expect(code('app/screens/weekly-review.tsx')).toMatch(/<NextActionPicker weekKey=\{weekKey\}/);
  });
});

describe('migration 031', () => {
  const sql = raw('../supabase/migrations/031_moods_and_review_actions.sql');
  it('three owner-only tables; check-ins keep snapshots; one action per week', () => {
    for (const t of ['mood_definitions', 'mood_checkins', 'review_next_actions']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    }
    expect(sql).toMatch(/label\s+text NOT NULL,\s*valence\s+smallint NOT NULL/);
    expect(sql).toMatch(/UNIQUE \(user_id, week_key\)/);
    expect(sql).not.toMatch(/ALTER TABLE public\.journal_entries/);
  });
  it('is recorded as NOT applied', () => {
    expect(sql).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(raw('../supabase/migrations/README.md')).toMatch(/\| 031 \| `031_moods_and_review_actions\.sql` \| \*\*NOT APPLIED\*\*/);
  });
});
