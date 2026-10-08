/**
 * R09.02 / R09.03 — the four places an action type lives agree, and every
 * coach write checks its target first.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { V2_ACTION_TYPES } from '../../lib/coachActionsV2';

const ROOT = join(__dirname, '..', '..');
const raw = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => stripComments(raw(p));

describe('four places, one list', () => {
  const edge = raw('../supabase/functions/generate-routine/index.ts');
  const sql = raw('../supabase/migrations/032_coach_actions_v2.sql');
  const repo = code('repositories/aiConversationRepository.ts');

  it('the edge tool schema offers exactly the client\'s types', () => {
    const enums = [...edge.matchAll(/type: \{ type: 'string', enum: \['([a-z_]+)'\] \}/g)].map((m) => m[1]);
    expect(enums).toEqual(['propose_habit', 'propose_habit_plan', 'log_habit', ...V2_ACTION_TYPES]);
  });
  // R09.02 (reminder action): migration 034 restates the constraint with the
  // full list; 032 stays as written (historic, its own five). The CURRENT
  // definition -- the latest migration that adds the constraint -- must equal
  // the client's list.
  const checkList = (text: string) => /CHECK \(action_type IN \(([\s\S]*?)\)\)/.exec(text)![1].match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1));
  it('the database CHECK allows exactly them (latest definition: migration 034, not applied)', () => {
    const latest = raw('../supabase/migrations/034_coach_reminder_action.sql');
    expect(checkList(latest)).toEqual(['propose_habit', 'propose_habit_plan', 'log_habit', ...V2_ACTION_TYPES]);
    expect(latest).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(raw('../supabase/migrations/README.md')).toMatch(/\| 034 \| `034_coach_reminder_action\.sql` \| \*\*NOT APPLIED\*\*/);
    // 032 is not edited: it still holds the first five of the second set
    expect(checkList(sql)).toEqual(['propose_habit', 'propose_habit_plan', 'log_habit', ...V2_ACTION_TYPES.filter((t) => t !== 'edit_reminder_time')]);
    expect(sql).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(raw('../supabase/migrations/README.md')).toMatch(/\| 032 \| `032_coach_actions_v2\.sql` \| \*\*NOT APPLIED\*\*/);
  });
  it('the repository row type names them', () => {
    expect(repo).toMatch(/action_type: 'propose_habit' \| 'propose_habit_plan' \| 'log_habit' \| V2ActionType;/);
  });
  it('the gate is a new, false gate; existing gates untouched', () => {
    const g = code('lib/featureGates.ts');
    expect(g).toMatch(/export const COACH_ACTIONS_V2_ENABLED = false;/);
    for (const n of ['SPOTIFY_OAUTH_ENABLED', 'NOTION_INTEGRATION_ENABLED', 'GOOGLE_CALENDAR_INTEGRATION_ENABLED', 'PAID_SUBSCRIPTIONS_ENABLED', 'PUBLIC_SITE_URLS_LIVE']) {
      expect(g).toMatch(new RegExp(`export const ${n} = false;`));
    }
  });
});

describe('every coach write checks its target first (R09.03)', () => {
  const card = code('components/coach/CoachActionCardV2.tsx');
  const coach = code('app/screens/ai-coach.tsx');

  it('the v2 card compares fingerprints before each command', () => {
    const fn = card.slice(card.indexOf('async function confirm('));
    const checkHabit = fn.indexOf('staleness(target.fp, cur, habitFingerprint)');
    const checkTask = fn.indexOf('staleness(target.fp, cur, taskFingerprint)');
    expect(checkHabit).toBeGreaterThan(-1);
    expect(checkTask).toBeGreaterThan(-1);
    expect(fn.indexOf('updateHabit(')).toBeGreaterThan(checkHabit);
    expect(fn.indexOf('addTimeOff(')).toBeGreaterThan(checkHabit);
    expect(fn.indexOf('updateTask(')).toBeGreaterThan(checkTask);
    expect(fn.indexOf('startSmallStep(')).toBeGreaterThan(checkTask);
  });
  it('a gone or changed target returns before any write, in both branches', () => {
    const fn = card.slice(card.indexOf('async function confirm('));
    const habitBranch = fn.slice(fn.indexOf("if (target.kind === 'habit')"), fn.indexOf("if (target.kind === 'task')"));
    const taskBranch = fn.slice(fn.indexOf("if (target.kind === 'task')"), fn.indexOf("if (action.type === 'lighten_today')"));
    for (const br of [habitBranch, taskBranch]) {
      expect(br).toMatch(/if \(st === 'gone'\) \{.*?return; \}/);
      expect(br).toMatch(/if \(st === 'changed'\) \{.*?return; \}/);
    }
  });

  it('each action uses the app\'s own command', () => {
    expect(card).toMatch(/frequencyEditPatch\(cur!, action\.frequency_config\)/);
    expect(card).toMatch(/addTimeOff\(cur!\.id, \{ kind: 'pause', start_date: action\.from, end_date: action\.until \}\)/);
    expect(card).toMatch(/updateTask\(cur!\.id, \{ due_date: action\.date \}\)/);
    expect(card).toMatch(/logHabit\(\{ habitId: id, date: new Date\(\), state: 'skip' \}\)/);
    expect((card.match(/state: '/g) ?? []).length).toBe(1);
  });
  it('the existing log path re-checks the habit before writing', () => {
    const fn = coach.slice(coach.indexOf("if (staged.kind === 'log' || staged.kind === 'unitMismatch') {"));
    expect(fn.indexOf('staleness(habitFingerprint(staged.habit), live, habitFingerprint)')).toBeGreaterThan(-1);
    expect(fn.indexOf('staleness(')).toBeLessThan(fn.indexOf('await logHabitWrite('));
  });
});
