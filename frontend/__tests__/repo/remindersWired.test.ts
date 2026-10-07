/**
 * R04 — wiring: no DAILY trigger is created any more, the Android channel
 * does not depend on the permission path, the root layout registers the
 * reconciler and handles buttons, and no deferred trigger is offered.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { parseAction, handledKey, rememberHandled, DEFAULT_ACTION, MAX_HANDLED } from '../../lib/notificationActions';

const ROOT = join(__dirname, '..', '..');
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

describe('lib/notifications', () => {
  const lib = code('lib/notifications.ts');
  it('creates no repeating DAILY trigger (KD-04)', () => {
    expect(lib).not.toMatch(/SchedulableTriggerInputTypes\.DAILY/);
  });
  it('ensures the Android channel before reading permission (R04.04)', () => {
    const fn = lib.slice(lib.indexOf('export async function ensurePermission('));
    expect(fn.indexOf('await ensureChannel();')).toBeGreaterThan(-1);
    expect(fn.indexOf('await ensureChannel();')).toBeLessThan(fn.indexOf('getPermissionsAsync'));
  });
  it('the old names ask for a re-plan instead of scheduling', () => {
    expect(lib).toMatch(/export async function scheduleHabitReminder\(_habit: Habit\): Promise<void> \{ await requestReconcile\(\); \}/);
  });
  it('hidden titles reach the lock screen', () => {
    expect(lib).toMatch(/title: reminderTitle\(habit\.name, settings\)/);
  });
});

describe('root layout', () => {
  const layout = code('app/_layout.tsx');
  it('registers the reconciler, re-plans on log and habit changes and on foreground, handles buttons', () => {
    expect(layout).toMatch(/registerReminderReconciler\(run\);/);
    expect(layout).toMatch(/useLogStore\.subscribe\(\(s, prev\) => \{ if \(s\.logs !== prev\.logs\) void run\(\); \}\)/);
    expect(layout).toMatch(/useHabitStore\.subscribe\(\(s, prev\) => \{ if \(s\.habits !== prev\.habits\) void run\(\); \}\)/);
    expect(layout).toMatch(/addNotificationResponseReceivedListener/);
    expect(layout).toMatch(/getLastNotificationResponseAsync/);
    expect(layout).toMatch(/if \(next === 'active'\) \{[\s\S]*?reconcileReminders\(/);
  });
});

describe('R04.06 — no deferred trigger is offered', () => {
  it('reminder UI has no location / NFC / chain option', () => {
    for (const p of ['components/ReminderEditor.tsx', 'components/NotificationSettingsCard.tsx', 'components/HabitOnboarding.tsx']) {
      expect(code(p)).not.toMatch(/konum|NFC|location|geofence/i);
    }
  });
});

describe('notification actions', () => {
  const r = (a: string, data: Record<string, unknown> | null = { habitId: 'h', day: '2026-10-05' }) => ({
    actionIdentifier: a, notification: { request: { identifier: 'n', content: { data } } },
  });
  it('parses the four buttons and the default tap; anything else is not ours', () => {
    expect(parseAction(r('done'))).toEqual({ kind: 'done', habitId: 'h', day: '2026-10-05' });
    expect(parseAction(r('measure'))?.kind).toBe('measure');
    expect(parseAction(r('snooze'))?.kind).toBe('snooze');
    expect(parseAction(r('skip'))?.kind).toBe('skip');
    expect(parseAction(r(DEFAULT_ACTION))?.kind).toBe('open');
    expect(parseAction(r('weird'))).toBeNull();
    expect(parseAction(r('done', { habitId: 'h' }))).toBeNull();
    expect(parseAction(r('done', null))).toBeNull();
  });
  it('one response, one key; the handled list is bounded', () => {
    expect(handledKey(r('done'))).toBe('n|done');
    let list: string[] = [];
    for (let i = 0; i < MAX_HANDLED + 10; i++) list = rememberHandled(list, `k${i}`);
    expect(list).toHaveLength(MAX_HANDLED);
    expect(list[0]).toBe(`k${MAX_HANDLED + 9}`);
  });
});
