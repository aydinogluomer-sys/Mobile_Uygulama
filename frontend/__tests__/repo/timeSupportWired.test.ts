/**
 * F36 — Kaynak bağlantısı, saflık, erişilebilirlik ve kapsam bekçisi (`timeSupportWired`)
 * + `NotificationSettingsCard` zaman desteği kontrollerinin davranışsal doğrulaması.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { rendersKey } from '../helpers/catalog';
import { stripComments } from '../helpers/sourceText';

const mockEnsurePermission = jest.fn(async () => true);
const mockNotificationAccess = jest.fn(async () => 'granted' as const);
const mockSyncAllReminders = jest.fn(async () => undefined);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../lib/notifications', () => ({
  ...jest.requireActual('../../lib/notifications'),
  ensurePermission: () => mockEnsurePermission(),
  notificationAccess: () => mockNotificationAccess(),
  openNotificationSettings: jest.fn(async () => true),
  syncAllReminders: () => mockSyncAllReminders(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import NotificationSettingsCard from '../../components/NotificationSettingsCard';
import { saveReminderSettings } from '../../services/reminderService';
import { DEFAULT_REMINDER_SETTINGS } from '../../lib/reminderPlan';

const ROOT = join(__dirname, '..', '..');
const raw = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string): string => stripComments(raw(p));

function walkAppRoutes(dir: string, rel = 'app'): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const nextRel = `${rel}/${name}`;
    if (statSync(abs).isDirectory()) out.push(...walkAppRoutes(abs, nextRel));
    else if (/\.tsx?$/.test(name)) out.push(nextRel);
  }
  return out;
}

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object' && 'children' in (n as Record<string, unknown>)) {
      walk((n as { children?: unknown }).children);
    }
  };
  walk(r.toJSON());
  return out.join(' ');
}

describe('F36 timeSupportWired — static wiring, purity & scope invariants', () => {
  it('(+) taskRepository TASK_COLS selects time_block_start and time_block_end', () => {
    const repo = code('repositories/taskRepository.ts');
    expect(repo).toMatch(/TASK_COLS\s*=\s*['"][^'"]*time_block_start[^'"]*time_block_end[^'"]*['"]/);
  });

  it('(+) lib/notifications.ts exports F36 schedulers on TIME_SUPPORT_CHANNEL without DAILY or nag priorities', () => {
    const notif = code('lib/notifications.ts');
    expect(notif).not.toMatch(/SchedulableTriggerInputTypes\.DAILY/);
    expect(notif).not.toMatch(/interruptionLevel|timeSensitive/);
    expect(notif).not.toMatch(/AndroidImportance\.(?:HIGH|MAX)/);
    expect(notif).toContain("export const TIME_SUPPORT_CHANNEL = 'time-support';");
    expect(notif).toContain('export async function scheduleTaskReminder(');
    expect(notif).toContain('export async function scheduleEveningClose(');
    expect(notif).toContain('export async function scheduleFollowUp(');
  });

  it('(+) lib/reminderPlan.ts classifyScheduled union stays habit | legacy-habit | other', () => {
    const plan = code('lib/reminderPlan.ts');
    expect(plan).toContain("kind: 'habit' | 'legacy-habit' | 'other'");
    expect(plan).not.toMatch(/kind:\s*'habit'\s*\|\s*'legacy-habit'\s*\|\s*'other'\s*\|/);
  });

  it('(+) lib/nextBlock.ts, lib/taskReminderPlan.ts, and DayTimeStrip.tsx stay pure and animation-free', () => {
    for (const rel of ['lib/nextBlock.ts', 'lib/taskReminderPlan.ts']) {
      const src = code(rel);
      expect(src).not.toMatch(/from\s+['"](?:react|react-native)['"]/);
      expect(src).not.toMatch(/from\s+['"][^'"]*(?:store|services|repositories)\//);
      expect(src).not.toMatch(/supabase|AsyncStorage/);
      expect(src).not.toMatch(/\b(?:Animated|Easing)\b/);
    }
    expect(code('components/calendar/DayTimeStrip.tsx')).not.toMatch(/\b(?:Animated|Easing)\b/);
  });

  it('(+) calendar.tsx mounts DayTimeStrip while preserving seasonal motion invariants, and NextUpStrip keeps SIRADA/dueLabel', () => {
    const cal = code('app/screens/calendar.tsx');
    expect(cal).toContain('DayTimeStrip');
    expect(cal).toContain('active={isFocused}');
    expect(cal).toContain('<Animated.View style={pageStyle}>');
    expect(cal).toContain('function animatePage(');

    const nextUp = code('components/today/NextUpStrip.tsx');
    expect(rendersKey(nextUp, 'today.nextUp.overline', 'AKIŞ / SIRADA')).toBe(true);
    expect(nextUp).toContain('dueLabel');
  });

  it('(+) NotificationSettingsCard.tsx has zero deferred location/NFC triggers and enforces minHeight: 44', () => {
    const card = code('components/NotificationSettingsCard.tsx');
    expect(card).not.toMatch(/konum|NFC|location|geofence/i);
    expect(card).toContain('minHeight: 44');
  });

  it('(+) app/_layout.tsx subscribes to taskStore and focusStore and passes F36 ctx to reconcileReminders', () => {
    const layout = code('app/_layout.tsx');
    expect(layout).toContain('useTaskStore.subscribe(');
    expect(layout).toContain('useFocusStore.subscribe(');
    expect(layout).toMatch(/reconcileReminders\(\s*habitsNow\s*,\s*undefined\s*,\s*ctx\s*\)/);
  });

  it('(-) zero app/ route files end with clinic|klinik|therapy|terapi', () => {
    expect(existsSync(join(ROOT, 'app'))).toBe(true);
    const routes = walkAppRoutes(join(ROOT, 'app'));
    expect(routes.length).toBeGreaterThan(10);
    const banned = /\/(clinic|klinik|therapy|terapi)\.tsx?$/i;
    expect(routes.filter((r) => banned.test(r))).toEqual([]);
  });
});

describe('F36 NotificationSettingsCard — opt-in time-support UI & quiet conflict warning', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('(+) renders all three controls OFF by default, asks permission when enabling, and warns on evening quiet-hours conflict', async () => {
    await saveReminderSettings({
      ...DEFAULT_REMINDER_SETTINGS,
      quietStart: '20:00',
      quietEnd: '07:00',
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(React.createElement(NotificationSettingsCard));
    });
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });

    const eveningSwitch = r.root.findAll(
      (n) => n.props?.accessibilityRole === 'switch' && n.props?.accessibilityLabel === 'Akşam kapanış hatırlatıcısı',
    )[0];
    const followUpSwitch = r.root.findAll(
      (n) => n.props?.accessibilityRole === 'switch' && n.props?.accessibilityLabel === 'Sınırlı takip',
    )[0];
    const leadOffChip = r.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Görev erken hatırlatıcısı Kapalı' && typeof n.props.onPress === 'function',
    )[0];

    expect(eveningSwitch.props.accessibilityState).toEqual({ checked: false });
    expect(followUpSwitch.props.accessibilityState).toEqual({ checked: false });
    expect(leadOffChip.props.accessibilityState).toEqual({ selected: true });

    // Toggle evening close ON -> requests permission, shows 21:00 quiet-hour conflict warning
    await act(async () => {
      await eveningSwitch.props.onPress();
    });
    expect(mockEnsurePermission).toHaveBeenCalledTimes(1);
    expect(textOf(r)).toContain('Bu saat sessiz saatlerine denk geliyor; bildirim gönderilmez.');

    // Switch evening time to 19:00 (outside 20:00-07:00) -> warning disappears
    const chip19 = r.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Akşam kapanış saati 19:00' && typeof n.props.onPress === 'function',
    )[0];
    await act(async () => {
      await chip19.props.onPress();
    });
    expect(textOf(r)).not.toContain('Bu saat sessiz saatlerine denk geliyor; bildirim gönderilmez.');

    await act(async () => {
      r.unmount();
    });
  });
});
