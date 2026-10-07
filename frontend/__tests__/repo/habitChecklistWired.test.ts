/**
 * R01.04 — migration 029 is written (not applied), the checklist is not task
 * subtasks, and the screens route a habit with steps to its checklist.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => stripComments(read(p));

describe('R01.04 — migration 029', () => {
  const sql = read('../supabase/migrations/029_habit_checklists.sql');

  it('two tables, RLS on both, owner-only', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.habit_checklist_items/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.habit_checklist_checks/);
    expect(sql).toMatch(/ALTER TABLE public\.habit_checklist_items\s+ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/ALTER TABLE public\.habit_checklist_checks ENABLE ROW LEVEL SECURITY;/);
  });

  it('a step is ticked once a day; steps are archived, never deleted', () => {
    expect(sql).toMatch(/UNIQUE \(item_id, day\)/);
    expect(sql).not.toMatch(/CREATE POLICY habit_checklist_items_delete/);
    expect(sql).toMatch(/archived_at\s+timestamptz NULL/);
  });

  it('a check must point at the owner\'s step of the same habit', () => {
    expect(sql).toMatch(/i\.id = item_id AND i\.habit_id = habit_checklist_checks\.habit_id AND i\.user_id = \(SELECT auth\.uid\(\)\)/);
  });

  it('is recorded as NOT applied', () => {
    expect(sql).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(read('../supabase/migrations/README.md')).toMatch(/\| 029 \| `029_habit_checklists\.sql` \| \*\*NOT APPLIED\*\*/);
  });
});

describe('R01.04 — not task subtasks', () => {
  it('the checklist model and its repository never touch tasks', () => {
    for (const p of ['lib/habitChecklist.ts', 'repositories/habitChecklistRepository.ts', 'components/ChecklistSheet.tsx', 'components/ChecklistEditor.tsx']) {
      expect(code(p)).not.toMatch(/subtask|taskStore|taskRepository|from\('tasks'\)/i);
    }
  });
});

describe('R01.04 — screens', () => {
  const today = code('app/tabs/today.tsx');
  const sheet = code('components/ChecklistSheet.tsx');
  const editor = code('components/ChecklistEditor.tsx');

  it('Today opens the checklist for a habit with steps today, before any one-tap toggle', () => {
    const fn = today.slice(today.indexOf('async function onHabitTap('));
    const open = fn.indexOf('if (itemsOn(checklistItems, h.id, today).length > 0) {');
    const toggle = fn.indexOf("state: done ? 'miss' : 'done'");
    expect(open).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(open);
  });

  it('the sheet writes the log the checks lead to, after the check was accepted', () => {
    expect(sheet).toMatch(/const res = await toggleCheck\(habit\.id, itemId, day\);\s*if \(!res\.ok\)/);
    expect(sheet).toMatch(/const step = logStepFor\(res\.progress, getLogForHabit\(habit\.id, day\)\?\.state\);/);
  });

  it('the editor archives steps; it has no delete', () => {
    expect(editor).toMatch(/archiveChecklistItem\(id\)/);
    expect(editor).not.toMatch(/deleteChecklist|removeChecklist/);
  });
});
