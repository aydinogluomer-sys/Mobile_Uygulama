/**
 * R04 / F17 — wiring: no DAILY trigger is created any more, the Android channel
 * does not depend on the permission path, system settings path exists without
 * nag priorities, the root layout guards web, gates subscriptions on
 * hasReminderHabits with debounce, refreshes the horizon on launch and
 * foreground, and no deferred trigger is offered.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { HABIT_ONBOARDING_FILES } from '../helpers/habitOnboardingSource';
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
  it('offers openNotificationSettings via Linking.openSettings without timeSensitive/interruptionLevel (DOM-18)', () => {
    expect(lib).toContain('export async function openNotificationSettings(');
    expect(lib).toContain('Linking.openSettings()');
    expect(lib).not.toMatch(/interruptionLevel|timeSensitive/);
  });
});

describe('root layout', () => {
  const layout = code('app/_layout.tsx');
  it('guards web, registers the reconciler, debounces gated store changes, flushes on boot and foreground, and awaits habits for taps', () => {
    expect(layout.indexOf('!REMINDERS_SUPPORTED')).toBeGreaterThan(-1);
    expect(layout.indexOf('!REMINDERS_SUPPORTED')).toBeLessThan(layout.indexOf('addNotificationResponseReceivedListener'));
    expect(layout).toMatch(/registerReminderReconciler\(run\);/);
    expect(layout).toMatch(/void whenHabitsLoaded\(\)\.then\(\(\) => trigger\.flushNow\(\)\)/);
    expect(layout).toMatch(
      /useLogStore\.subscribe\(\(s, prev\) => \{ if \(s\.logs !== prev\.logs && hasReminderHabits\(useHabitStore\.getState\(\)\.habits\)\) trigger\.schedule\(\); \}\)/,
    );
    expect(layout).toMatch(
      /useHabitStore\.subscribe\(\(s, prev\) => \{ if \(s\.habits !== prev\.habits && \(hasReminderHabits\(s\.habits\) \|\| hasReminderHabits\(prev\.habits\)\)\) trigger\.schedule\(\); \}\)/,
    );
    expect(layout).toMatch(
      /AppState\.addEventListener\('change', \(next: AppStateStatus\) => \{ if \(next === 'active'\) void trigger\.flushNow\(\); \}\)/,
    );
    expect(layout).toMatch(/whenHabitsReady: \(\) => whenHabitsLoaded\(\)/);
    expect(layout).toMatch(/addNotificationResponseReceivedListener/);
    expect(layout).toMatch(/getLastNotificationResponseAsync/);
    expect(layout).not.toContain('reconcileReminders(() => useHabitStore');
  });
});

describe('R04.06 — no deferred trigger is offered', () => {
  it('reminder UI has no location / NFC / chain option', () => {
    for (const p of ['components/ReminderEditor.tsx', 'components/NotificationSettingsCard.tsx', ...HABIT_ONBOARDING_FILES]) {
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

describe('F36 time-support wiring', () => {
  it('routes all three F36 schedulers to TIME_SUPPORT_CHANNEL on Android and stops follow-ups before scheduling snooze', () => {
    const lib = code('lib/notifications.ts');
    for (const fnName of ['scheduleTaskReminder', 'scheduleEveningClose', 'scheduleFollowUp']) {
      const start = lib.indexOf(`export async function ${fnName}(`);
      expect(start).toBeGreaterThan(-1);
      const nextExport = lib.indexOf('export ', start + 10);
      const slice = nextExport > -1 ? lib.slice(start, nextExport) : lib.slice(start);
      expect(slice).toContain("Platform.OS === 'android' ? { channelId: TIME_SUPPORT_CHANNEL }");
    }

    const svc = code('services/reminderService.ts');
    const snoozeIdx = svc.indexOf("case 'snooze':");
    expect(snoozeIdx).toBeGreaterThan(-1);
    const snoozeSlice = svc.slice(snoozeIdx, svc.indexOf('break;', snoozeIdx));
    const stopIdx = snoozeSlice.indexOf('stopFollowUps(');
    const schedIdx = snoozeSlice.indexOf('scheduleSnooze(');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(schedIdx).toBeGreaterThan(stopIdx);
  });
});
