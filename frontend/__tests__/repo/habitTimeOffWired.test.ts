/**
 * R01.05 — the migration is written (not applied), the client is fail-open
 * only on a missing table, in-memory fields never reach a habits write, and
 * the screens are wired.
 */
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
import { readFileSync } from 'fs';
import { join } from 'path';
import { rendersKey } from '../helpers/catalog';
import { readSources } from '../helpers/readSources';
import { stripComments } from '../helpers/sourceText';
import { isMissingTable } from '../../repositories/habitPauseRepository';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => stripComments(read(p));

describe('R01.05 — migration 028', () => {
  const sql = read('../supabase/migrations/028_habit_pauses_and_goal_versions.sql');

  it('both tables, RLS on, owner-only policies', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.habit_pauses/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.habit_goal_versions/);
    expect(sql).toMatch(/ALTER TABLE public\.habit_pauses ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/ALTER TABLE public\.habit_goal_versions ENABLE ROW LEVEL SECURITY;/);
    expect((sql.match(/\(SELECT auth\.uid\(\)\) = user_id/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it('a holiday has no habit, a pause has one; dates are ordered; one version per day', () => {
    expect(sql).toMatch(/\(kind = 'holiday' AND habit_id IS NULL\) OR \(kind = 'pause' AND habit_id IS NOT NULL\)/);
    expect(sql).toMatch(/CHECK \(end_date IS NULL OR end_date >= start_date\)/);
    expect(sql).toMatch(/UNIQUE \(habit_id, effective_from\)/);
  });

  it('is recorded as NOT applied', () => {
    expect(sql).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(read('../supabase/migrations/README.md')).toMatch(/\| 028 \| `028_habit_pauses_and_goal_versions\.sql` \| \*\*NOT APPLIED\*\*/);
  });
});

describe('R01.05 — fail-open only on a missing table', () => {
  it('PGRST205 / 42P01 are "not migrated"; anything else is an error', () => {
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ code: '42501' })).toBe(false);
    expect(isMissingTable({ code: '' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe('R01.05 — in-memory fields never reach a habits write', () => {
  const repo = code('repositories/habitRepository.ts');
  it('update and insert strip them', () => {
    expect(repo).toMatch(/patch: stripTimeOff\(updates\) as Record<string, unknown>/);
    expect(repo).toMatch(/\.insert\(\{ \.\.\.stripTimeOff\(habit\), user_id: u\.userId \}\)/);
  });
});

describe('R01.05 — screens', () => {
  const today = stripComments(
    readSources([
      'app/tabs/today.tsx',
      'hooks/useTodayModel.ts',
      'lib/todaySelectors.ts',
      'components/today/HabitSection.tsx',
    ]),
  );
  const detail = code('app/screens/habit-detail.tsx');
  const sheet = read('components/TimeOffSheet.tsx');

  it('Today: a habit on a break is not today\'s work, and is shown apart', () => {
    expect(today).toMatch(/&& !isPausedOn\(h, date\)\s*&& \(isEligibleOn\(h, date\) \|\| isScheduleAmbiguous\(h\)\)/);
    expect(rendersKey(today, 'today.onBreak.overline', 'ARADA')).toBe(true);
    expect(rendersKey(today, 'today.holiday.overline', 'TATİL MODU')).toBe(true);
    expect(today).toMatch(/addTimeOff\(null, draft\)/);
  });

  it('habit detail: a break for this habit; the frequency edit says which days it judges', () => {
    expect(detail).toMatch(/addTimeOff\(habit\.id, draft\)/);
    expect(detail).toMatch(/Yeni sıklık bugünden itibaren geçerli; geçmiş günler eski hedefle/);
  });

  it('the sheet cannot save while the server update is pending, and says so', () => {
    expect(sheet).toMatch(/disabled=\{!available \|\| saving\}/);
    expect(sheet).toMatch(/sunucu güncellemesini bekliyor/);
    expect(sheet).toMatch(/YALNIZ BİR GÜN İÇİNSE/);
  });
});
