/**
 * W2 wiring (task Phase-1 CODER-F): the habits.tsx / timeline.tsx capacity
 * modal must render `capacityAdvice`'s plan §10 worked shape ("74 + 18 ->
 * 92") -- current load, this habit's contribution, and the projected
 * verdict -- not just the legacy "irade"/"slot" stats it showed before.
 *
 * Two halves:
 *  - a SOURCE check (style of rule4NoDirectDbInUi.test.ts): both screens
 *    must actually call `dailyLoad(`/`capacityAdvice(`. Genuinely red before
 *    W2 (0 occurrences of either today).
 *  - a LOGIC check pinning the exact plan example through the SAME pipeline
 *    the modal uses -- `dailyLoad({ habits: activeHabits })` feeding
 *    `capacityAdvice` -- not just `capacityAdvice` handed a hand-picked
 *    number (already covered in isolation by `__tests__/lib/capacity.test.ts`).
 *    This half is not tied to the W1/W2 code change (lib/capacity.ts already
 *    exists) and is expected to pass already; it exists to pin the exact
 *    composition the UI relies on.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { dailyLoad, capacityAdvice, type HabitLoadInput } from '../../lib/capacity';

const ROOT = join(__dirname, '..', '..');
// F28 (NAV-09): app/tabs/habits.tsx reduced to a <Redirect href="/tabs/timeline" /> stub;
//app/tabs/timeline.tsx is now the single canonical habit screen & capacity modal owner.
const FILES: [string, string][] = [
  ['app/tabs/timeline.tsx', join(ROOT, 'app', 'tabs', 'timeline.tsx')],
];

describe('W2 source -- capacity modal calls dailyLoad(/capacityAdvice(', () => {
  it('scans a non-empty list of habit screen sources', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });
  it.each(FILES)('%s calls capacityAdvice(', (_name, path) => {
    expect(readFileSync(path, 'utf8')).toMatch(/\bcapacityAdvice\(/);
  });
  it.each(FILES)('%s calls dailyLoad(', (_name, path) => {
    expect(readFileSync(path, 'utf8')).toMatch(/\bdailyLoad\(/);
  });
});

describe("W2 logic -- dailyLoad(activeHabits) -> capacityAdvice reproduces the plan's 74 + 18 -> 92", () => {
  const HEAVY: HabitLoadInput = { difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: null };
  // 4 heavy (18 pts each = 72) + one small daily habit (~1.99 pts) rounds to 74.
  const SMALL: HabitLoadInput = { difficulty: 1, estimated_minutes: 3, frequency_config: { kind: 'daily' }, impact_level: null };
  const activeHabits: HabitLoadInput[] = [HEAVY, HEAVY, HEAVY, HEAVY, SMALL];

  it('the fixture activeHabits list produces currentLoad 74 via dailyLoad, exactly as the modal computes it', () => {
    expect(dailyLoad({ habits: activeHabits }).normalised).toBe(74);
  });

  it('feeding that currentLoad + a HEAVY incoming habit into capacityAdvice projects 92, an "aşırı" verdict', () => {
    const currentLoad = dailyLoad({ habits: activeHabits }).normalised;
    const advice = capacityAdvice({ currentLoad, incomingHabit: HEAVY });
    expect(advice.projected).toBe(92);
    expect(advice.incomingPoints).toBeCloseTo(18, 10);
    expect(advice.verdict).toBe('unsustainable');
    expect(advice.message).toBe('Bu rutini şimdi başlatmak sürdürülebilir olmayabilir.');
  });
});
