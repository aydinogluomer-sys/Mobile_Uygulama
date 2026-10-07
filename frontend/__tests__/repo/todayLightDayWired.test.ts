/**
 * R03.02 — the light day is wired as promised: explicit choice, today only,
 * `skip` only, and the sheet tells the user what it does and does not change.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const raw = readFileSync(join(__dirname, '..', '..', 'app/tabs/today.tsx'), 'utf8');
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
    expect(raw).toMatch(/hedeflerin ve takvimin değişmez/);
    expect(raw).toMatch(/serin bozulmaz — ama bugün uzamaz da/);
    expect(raw).toMatch(/Bir sağlık ölçümü ya da kesin bir irade bütçesi değildir\./);
  });

  it('set-aside habits stay visible and tappable', () => {
    expect(src).toMatch(/title="BUGÜN HAFİFLETİLDİ"/);
    expect(src).toMatch(/setAsideHabits\.map\(\(h\) => \(/);
  });
});
