/**
 * R01.06-b — the Today screen actually loads the period's logs and hands them
 * to the selectors. The selectors are tested in lib/todayPeriodDone.test.ts;
 * without this guard the screen could keep calling them with no logs and every
 * one of those tests would still pass.
 */
import { readSources } from '../helpers/readSources';
import { stripComments } from '../helpers/sourceText';

const src = stripComments(
  readSources([
    'app/tabs/today.tsx',
    'hooks/useTodayModel.ts',
    'lib/todaySelectors.ts',
    'components/today/HabitSection.tsx',
  ]),
);

describe('R01.06-b — Today is wired to the period logs', () => {
  it('loads the week+month window through the review service', () => {
    expect(src).toMatch(/logsForPeriod\(\{ start: periodWindowStart\(/);
    expect(src).toMatch(/loadPeriodLogs\(\)\]\);/);   // part of the screen's load
  });
  it('a failed load is null (fail-open), never an empty list', () => {
    expect(src).toMatch(/setPeriodLogs\(res\.ok \? res\.data : null\);/);
  });
  it('both groups are selected from the same logs', () => {
    // R03.02 added a fourth argument (the light-day set) to the list selector;
    // the period logs are still what both groups are computed from.
    expect(src).toMatch(/const todayHabits = selectTodayHabits\(habits, todayDate, periodLogs, lightDayIds\);/);
    expect(src).toMatch(/const periodDoneHabits = selectPeriodDoneHabits\(habits, todayDate, periodLogs\);/);
  });
  it('the period-done group is rendered, dimmed, and still tappable', () => {
    expect(src).toMatch(/title="BU DÖNEM TAMAM"/);
    expect(src).toMatch(/style=\{\[s\.habitRow, s\.habitRowPeriodDone\]\}/);
    expect(src).toMatch(/periodDoneHabits\.map\(\(h\) => \(/);
  });
});
