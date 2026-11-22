/**
 * R03.02 — the light day is wired as promised: explicit choice, today only,
 * `skip` only, and the sheet tells the user what it does and does not change.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { readSources } from '../helpers/readSources';
import { stripComments } from '../helpers/sourceText';

const raw = readSources([
  'app/tabs/today.tsx',
  'hooks/useTodayModel.ts',
  'lib/todaySelectors.ts',
  'components/today/HabitSection.tsx',
]);
const src = stripComments(raw);

describe('R03.02 — light day', () => {
  it('writes skip, for today, for the chosen habits only', () => {
    expect(src).toMatch(/for \(const id of lightDayPick\) \{/);
    expect(src).toMatch(/await logHabit\(\{ habitId: id, date: new Date\(\), state: 'skip' \}\);/);
    // no other state is written from the light-day path
    const fn = src.slice(src.indexOf('async function confirmLightDay('), src.indexOf('return (', src.indexOf('async function confirmLightDay(')));
    expect(fn.match(/state: '/g)).toHaveLength(1);
  });

  it('nothing is set aside without a choice: confirm is disabled until something is picked', () => {
    expect(src).toMatch(/disabled=\{!lightDayPick \|\| lightDayPick\.size === 0 \|\| lightDaySaving\}/);
    expect(src).toMatch(/if \(!lightDayPick \|\| lightDayPick\.size === 0\) return;/);
  });

  it('the list is fed the light-day set, and the set comes from today\'s skip logs', () => {
    expect(src).toMatch(/const lightDayIds = setAsideIds\(habits, \(id\) => getLogForHabit\(id\)\?\.state\);/);
    expect(src).toMatch(/selectTodayHabits\(habits, todayDate, periodLogs, lightDayIds\)/);
  });

  it('the sheet says what changes and what does not, and that capacity is an estimate', () => {
    // R03.07: the sentence moved to the shared flow copy; the sheet renders it.
    const copy = readFileSync(join(__dirname, '..', '..', 'lib/flowCopy.ts'), 'utf8');
    expect(raw).toMatch(/\{FLOW_COPY\.lighten\}/);
    expect(copy).toMatch(/hedeflerin ve takvimin değişmez/);
    expect(copy).toMatch(/serin bozulmaz — ama bugün uzamaz da/);
    expect(raw).toMatch(/Bir sağlık ölçümü ya da kesin bir irade bütçesi değildir\./);
  });

  it('set-aside habits stay visible and tappable', () => {
    expect(src).toMatch(/title="BUGÜN HAFİFLETİLDİ"/);
    expect(src).toMatch(/setAsideHabits\.map\(\(h\) => \(/);
  });
});
