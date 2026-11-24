/**
 * F17 — UI tests for ReminderEditor and NotificationSettingsCard
 * (DOM-18 permission & settings path, GAP2-10 web unsupported state,
 * GAP1-03 failed save keeps editor open & values intact, DOM-15 daily cap UI).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

jest.mock('expo-notifications', () => ({
  __esModule: true,
  ...jest.requireActual('expo-notifications'),
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  scheduleNotificationAsync: jest.fn(async () => 'id-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  dismissNotificationAsync: jest.fn(async () => undefined),
}));

import type { NotificationAccess } from '../../lib/notifications';
import type { ReconcileReport } from '../../services/reminderService';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../../lib/reminderPlan';
import type { Habit } from '../../lib/supabase';

const mockNotificationAccess = jest.fn<Promise<NotificationAccess>, []>();
const mockEnsurePermission = jest.fn<Promise<boolean>, []>();
const mockOpenNotificationSettings = jest.fn<Promise<boolean>, []>();
const mockSyncAllReminders = jest.fn<Promise<void>, [Habit[]]>();

jest.mock('../../lib/notifications', () => ({
  notificationAccess: () => mockNotificationAccess(),
  ensurePermission: () => mockEnsurePermission(),
  openNotificationSettings: () => mockOpenNotificationSettings(),
  syncAllReminders: (h: Habit[]) => mockSyncAllReminders(h),
  hasPermission: jest.fn(async () => true),
}));

const mockLoadReminderSettings = jest.fn<Promise<ReminderSettings>, []>();
const mockSaveReminderSettings = jest.fn<Promise<void>, [ReminderSettings]>();
const mockGetLastReconcileReport = jest.fn<ReconcileReport | null, []>();

jest.mock('../../services/reminderService', () => ({
  loadReminderSettings: () => mockLoadReminderSettings(),
  saveReminderSettings: (s: ReminderSettings) => mockSaveReminderSettings(s),
  getLastReconcileReport: () => mockGetLastReconcileReport(),
}));

import ReminderEditor from '../../components/ReminderEditor';
import NotificationSettingsCard from '../../components/NotificationSettingsCard';

jest.setTimeout(15000);

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'object' && 'children' in n) {
      walk((n as { children?: unknown }).children);
    }
  };
  walk(r.toJSON());
  return out.join(' ');
}

const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];

const flush = () => act(async () => { await new Promise((res) => setTimeout(res, 0)); });

const sampleHabit = {
  id: 'h1',
  name: 'Su İç',
  reminders: { enabled: true, time: '08:00', times: ['08:00'] },
} as Habit;

let appStateListener: ((state: string) => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_evt: string, fn: (s: string) => void) => {
    appStateListener = fn;
    return { remove: jest.fn() };
  }) as never);
  mockNotificationAccess.mockResolvedValue('granted');
  mockEnsurePermission.mockResolvedValue(true);
  mockOpenNotificationSettings.mockResolvedValue(true);
  mockSyncAllReminders.mockResolvedValue(undefined);
  mockLoadReminderSettings.mockResolvedValue({ ...DEFAULT_REMINDER_SETTINGS });
  mockSaveReminderSettings.mockResolvedValue(undefined);
  mockGetLastReconcileReport.mockReturnValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ReminderEditor — GAP1-03 save failure handling & busy guard', () => {
  it('displays alert error, never calls onClose, preserves edited times and re-enables Save when onSave returns { ok: false }', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn(async () => ({ ok: false as const, error: 'Bağlantı yok; değişiklik kaydedilmedi.' }));
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ReminderEditor habit={sampleHabit} permission onClose={onClose} onSave={onSave} />);
    });

    const input = r.root.findAll((n) => n.props?.accessibilityLabel === 'Hatırlatıcı saati 1' && n.props.onChangeText)[0];
    await act(async () => { input.props.onChangeText('09:15'); });
    await act(async () => { await byLabel(r, 'Hatırlatıcıyı kaydet').props.onPress(); });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    const alerts = r.root.findAll((n) => n.props?.accessibilityRole === 'alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(textOf(r)).toContain('Bağlantı yok; değişiklik kaydedilmedi.');

    const updatedInput = r.root.findAll((n) => n.props?.accessibilityLabel === 'Hatırlatıcı saati 1' && n.props.onChangeText)[0];
    expect(updatedInput.props.value).toBe('09:15');

    const saveBtn = byLabel(r, 'Hatırlatıcıyı kaydet');
    expect(saveBtn.props.disabled).toBe(false);
  });

  it('shows no error on { ok: true } or void return, surfaces thrown errors, and blocks double-tap while saving', async () => {
    let rOk!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rOk = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission onClose={() => undefined} onSave={async () => ({ ok: true })} />,
      );
    });
    await act(async () => { await byLabel(rOk, 'Hatırlatıcıyı kaydet').props.onPress(); });
    expect(rOk.root.findAll((n) => n.props?.accessibilityRole === 'alert')).toHaveLength(0);

    let rVoid!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rVoid = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission onClose={() => undefined} onSave={async () => undefined} />,
      );
    });
    await act(async () => { await byLabel(rVoid, 'Hatırlatıcıyı kaydet').props.onPress(); });
    expect(rVoid.root.findAll((n) => n.props?.accessibilityRole === 'alert')).toHaveLength(0);

    // Thrown error + double tap protection
    let release!: () => void;
    const slowSave = jest.fn(() => new Promise<void>((_, reject) => {
      release = () => reject(new Error('Sunucu yanıt vermedi.'));
    }));
    let rThrow!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rThrow = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission onClose={() => undefined} onSave={slowSave} />,
      );
    });

    let p1!: Promise<void>;
    await act(async () => {
      p1 = byLabel(rThrow, 'Hatırlatıcıyı kaydet').props.onPress();
    });
    // Second press while saving is ignored
    await act(async () => {
      void byLabel(rThrow, 'Hatırlatıcıyı kaydet').props.onPress();
    });
    expect(slowSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
      await p1;
    });
    expect(textOf(rThrow)).toContain('Sunucu yanıt vermedi.');
  });
});

describe('ReminderEditor — DOM-18 & GAP2-10 permission access states', () => {
  it('renders Settings button only for blocked, warning for ask/legacy false, web note for unsupported, and nothing for granted', async () => {
    // blocked -> warning + "Ayarları aç"
    let rBlocked!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rBlocked = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission={false} access="blocked" onClose={() => undefined} onSave={async () => undefined} />,
      );
    });
    expect(textOf(rBlocked)).toContain('Bu cihazda bildirim izni kapalı; hatırlatıcılar gönderilemez. İzni cihaz ayarlarından açabilirsin.');
    const openBtn = byLabel(rBlocked, 'Bildirim ayarlarını aç');
    expect(openBtn).toBeDefined();
    await act(async () => { openBtn.props.onPress(); });
    expect(mockOpenNotificationSettings).toHaveBeenCalledTimes(1);

    // ask -> warning, NO "Ayarları aç"
    let rAsk!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rAsk = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission={false} access="ask" onClose={() => undefined} onSave={async () => undefined} />,
      );
    });
    expect(textOf(rAsk)).toContain('Bu cihazda bildirim izni kapalı; hatırlatıcılar gönderilemez.');
    expect(byLabel(rAsk, 'Bildirim ayarlarını aç')).toBeUndefined();

    // granted -> neither warning nor button
    let rGranted!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rGranted = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission access="granted" onClose={() => undefined} onSave={async () => undefined} />,
      );
    });
    expect(textOf(rGranted)).not.toContain('bildirim izni kapalı');
    expect(byLabel(rGranted, 'Bildirim ayarlarını aç')).toBeUndefined();

    // unsupported -> web notice
    let rWeb!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rWeb = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission={false} access="unsupported" onClose={() => undefined} onSave={async () => undefined} />,
      );
    });
    expect(textOf(rWeb)).toContain('Tarayıcıda hatırlatıcı bildirimleri desteklenmiyor');

    // legacy permission={false} without access prop
    let rLegacy!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rLegacy = TestRenderer.create(
        <ReminderEditor habit={sampleHabit} permission={false} onClose={() => undefined} onSave={async () => undefined} />,
      );
    });
    expect(textOf(rLegacy)).toContain('Bu cihazda bildirim izni kapalı; hatırlatıcılar gönderilemez. İzni cihaz ayarlarından açabilirsin.');
  });
});

describe('NotificationSettingsCard — DOM-18, GAP2-10 & DOM-15', () => {
  it('shows blocked Settings button (no İzin iste), ask İzin iste, granted message, and hides non-working controls on web', async () => {
    // blocked
    mockNotificationAccess.mockResolvedValueOnce('blocked');
    let rBlocked!: TestRenderer.ReactTestRenderer;
    await act(async () => { rBlocked = TestRenderer.create(<NotificationSettingsCard />); });
    await flush();
    expect(textOf(rBlocked)).toContain('Sistem izin penceresi bir daha gösterilemiyor.');
    expect(byLabel(rBlocked, 'Bildirim ayarlarını aç')).toBeDefined();
    expect(byLabel(rBlocked, 'Bildirim izni iste')).toBeUndefined();
    await act(async () => { byLabel(rBlocked, 'Bildirim ayarlarını aç').props.onPress(); });
    expect(mockOpenNotificationSettings).toHaveBeenCalledTimes(1);

    // ask -> İzin iste
    mockNotificationAccess.mockResolvedValueOnce('ask').mockResolvedValueOnce('granted');
    let rAsk!: TestRenderer.ReactTestRenderer;
    await act(async () => { rAsk = TestRenderer.create(<NotificationSettingsCard />); });
    await flush();
    expect(byLabel(rAsk, 'Bildirim izni iste')).toBeDefined();
    await act(async () => { await byLabel(rAsk, 'Bildirim izni iste').props.onPress(); });
    expect(mockEnsurePermission).toHaveBeenCalledTimes(1);
    expect(textOf(rAsk)).toContain('Bildirim izni açık.');

    // unsupported -> web message, no quiet/cap chips
    mockNotificationAccess.mockResolvedValueOnce('unsupported');
    let rWeb!: TestRenderer.ReactTestRenderer;
    await act(async () => { rWeb = TestRenderer.create(<NotificationSettingsCard />); });
    await flush();
    expect(textOf(rWeb)).toContain('Tarayıcıda hatırlatıcı bildirimleri desteklenmiyor');
    expect(byLabel(rWeb, 'Günlük en çok 5 hatırlatıcı')).toBeUndefined();
    expect(byLabel(rWeb, 'Sessiz saatler Kapalı')).toBeUndefined();
  });

  it('refreshes notificationAccess when AppState transitions to active (returning from OS settings)', async () => {
    mockNotificationAccess.mockResolvedValueOnce('blocked').mockResolvedValueOnce('granted');
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<NotificationSettingsCard />); });
    await flush();
    expect(textOf(r)).toContain('Bildirim izni kapalı');

    await act(async () => { appStateListener?.('active'); });
    await flush();
    expect(mockNotificationAccess).toHaveBeenCalledTimes(2);
    expect(textOf(r)).toContain('Bildirim izni açık.');
  });

  it('updates daily cap chips (5 and Sınırsız), triggers re-reconcile, renders report lines only when > 0, and drops "ertelenmez" copy', async () => {
    const baseReport: ReconcileReport = {
      permission: true,
      planned: 10,
      added: 0,
      cancelled: 0,
      dropped: 0,
      quieted: 0,
      capped: 4,
      deferred: 0,
      reentry: true,
    };
    mockGetLastReconcileReport
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(baseReport)
      .mockReturnValueOnce({ ...baseReport, capped: 0 });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<NotificationSettingsCard />); });
    await flush();

    // Default 3 chip is selected; quiet-hours copy no longer says "ertelenmez"
    expect(byLabel(r, 'Günlük en çok 3 hatırlatıcı').props.accessibilityState).toEqual({ selected: true });
    expect(textOf(r)).not.toContain('ertelenmez');

    // Tap "5"
    await act(async () => { await byLabel(r, 'Günlük en çok 5 hatırlatıcı').props.onPress(); });
    expect(mockSaveReminderSettings).toHaveBeenCalledWith(expect.objectContaining({ maxPerDay: 5 }));
    expect(mockSyncAllReminders).toHaveBeenCalledTimes(1);
    expect(byLabel(r, 'Günlük en çok 5 hatırlatıcı').props.accessibilityState).toEqual({ selected: true });
    expect(textOf(r)).toContain('4 hatırlatıcı gönderilmeyecek');

    // Tap "Sınırsız" -> capped: 0 hides the capped line
    await act(async () => { await byLabel(r, 'Günlük sınır yok').props.onPress(); });
    expect(mockSaveReminderSettings).toHaveBeenCalledWith(expect.objectContaining({ maxPerDay: null }));
    expect(mockSyncAllReminders).toHaveBeenCalledTimes(2);
    expect(byLabel(r, 'Günlük sınır yok').props.accessibilityState).toEqual({ selected: true });
    expect(textOf(r)).not.toContain('4 hatırlatıcı gönderilmeyecek');
  });
});

describe('lib/notifications — GAP2-10 web guard & DOM-18 OS helpers', () => {
  it('returns unsupported/false/no-op on web without calling expo-notifications, and maps permission states on native', async () => {
    const platformMut = Platform as { OS: string };
    const origOs = platformMut.OS;
    const setHandlerSpy = Notifications.setNotificationHandler as jest.Mock;
    const permSpy = Notifications.getPermissionsAsync as jest.Mock;
    const schedSpy = Notifications.scheduleNotificationAsync as jest.Mock;
    const cancelSpy = Notifications.cancelScheduledNotificationAsync as jest.Mock;
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);

    try {
      setHandlerSpy.mockClear();
      permSpy.mockClear();
      schedSpy.mockClear();
      cancelSpy.mockClear();

      let webNotif!: typeof import('../../lib/notifications');
      jest.isolateModules(() => {
        const rn = jest.requireActual('react-native') as { Platform: { OS: string } };
        rn.Platform.OS = 'web';
        webNotif = jest.requireActual('../../lib/notifications');
      });
      expect(webNotif.REMINDERS_SUPPORTED).toBe(false);
      expect(setHandlerSpy).not.toHaveBeenCalled();
      expect(await webNotif.notificationAccess()).toBe('unsupported');
      expect(await webNotif.openNotificationSettings()).toBe(false);
      expect(await webNotif.ensurePermission()).toBe(false);
      expect(await webNotif.hasPermission()).toBe(false);
      expect(await webNotif.listScheduled()).toEqual([]);
      await webNotif.cancelScheduled(['x']);
      expect(await webNotif.scheduleReentryNudge(new Date(Date.now() + 86_400_000))).toBe(false);
      await webNotif.cancelReentryNudge();
      expect(await webNotif.scheduleFocusEnd({ phase: 'work', endsAtMs: Date.now() + 60_000, plannedSeconds: 1500, withSound: false })).toBe(false);
      await webNotif.cancelFocusEnd();
      expect(permSpy).not.toHaveBeenCalled();
      expect(schedSpy).not.toHaveBeenCalled();
      expect(cancelSpy).not.toHaveBeenCalled();
      expect(openSettingsSpy).not.toHaveBeenCalled();

      let iosNotif!: typeof import('../../lib/notifications');
      jest.isolateModules(() => {
        const rn = jest.requireActual('react-native') as { Platform: { OS: string } };
        rn.Platform.OS = 'ios';
        iosNotif = jest.requireActual('../../lib/notifications');
      });
      expect(iosNotif.REMINDERS_SUPPORTED).toBe(true);
      expect(setHandlerSpy).toHaveBeenCalledTimes(1);

      permSpy.mockResolvedValueOnce({ granted: true, canAskAgain: true });
      expect(await iosNotif.notificationAccess()).toBe('granted');
      permSpy.mockResolvedValueOnce({ granted: false, canAskAgain: false });
      expect(await iosNotif.notificationAccess()).toBe('blocked');
      permSpy.mockResolvedValueOnce({ granted: false, canAskAgain: true });
      expect(await iosNotif.notificationAccess()).toBe('ask');

      expect(await iosNotif.openNotificationSettings()).toBe(true);
      expect(openSettingsSpy).toHaveBeenCalledTimes(1);

      const at = new Date(Date.now() + 86_400_000);
      expect(await iosNotif.scheduleReentryNudge(at, Date.now())).toBe(true);
      expect(schedSpy).toHaveBeenCalledWith(expect.objectContaining({ identifier: iosNotif.REENTRY_ID }));
      await iosNotif.cancelReentryNudge();
      expect(cancelSpy).toHaveBeenCalledWith(iosNotif.REENTRY_ID);
    } finally {
      platformMut.OS = origOs;
      openSettingsSpy.mockRestore();
    }
  });
});
