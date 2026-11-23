import React from 'react';
import { Alert, Modal, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

type RegisteredScope = { name: string; onReset?: (reason: string) => void };

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../lib/accountScope', () => ({
  registerAccountScoped: jest.fn(),
}));

import { registerAccountScoped } from '../../lib/accountScope';
import ActionSheet from '../../components/ui/ActionSheet';
import DialogHost from '../../components/ui/DialogHost';
import { runDeleteAccountFlow } from '../../lib/deleteAccountFlow';
import { actionSheet, confirm, dismissAllDialogs, getCurrentDialog, notify } from '../../lib/dialog';

const mockRegister = registerAccountScoped as unknown as jest.Mock<void, [RegisteredScope]>;
const registeredAtImport: RegisteredScope[] = mockRegister.mock.calls.map(([arg]) => arg);

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
    walk((n as { children?: unknown }).children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>((acc, item) => ({ ...acc, ...flattenStyle(item) }), {});
  }
  if (typeof style === 'object') return style as Record<string, unknown>;
  return {};
}

function findButton(r: TestRenderer.ReactTestRenderer, label: string): TestRenderer.ReactTestInstance {
  const found = r.root
    .findAllByType(TouchableOpacity)
    .find((b) => b.props?.accessibilityLabel === label && typeof b.props?.onPress === 'function');
  if (!found) throw new Error(`Button "${label}" not found`);
  return found;
}

describe('DialogHost & ActionSheet on Web (F24: AC-D01..AC-D09)', () => {
  const { Platform } = jest.requireActual('react-native') as typeof import('react-native');
  const originalOS = Platform.OS;
  const winHolder = globalThis as { window?: { confirm?: unknown; alert?: unknown } };
  const originalConfirm = winHolder.window?.confirm;
  const originalAlert = winHolder.window?.alert;
  let hostRenderer: TestRenderer.ReactTestRenderer | null = null;

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function mountHost(): Promise<TestRenderer.ReactTestRenderer> {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<DialogHost />);
    });
    hostRenderer = r;
    return r;
  }

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    dismissAllDialogs();
    if (!winHolder.window) winHolder.window = {};
    winHolder.window.confirm = undefined;
    winHolder.window.alert = undefined;
  });

  afterEach(async () => {
    if (hostRenderer) {
      const toUnmount = hostRenderer;
      hostRenderer = null;
      await act(async () => {
        toUnmount.unmount();
      });
    }
    await act(async () => {
      dismissAllDialogs();
    });
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    if (winHolder.window) {
      winHolder.window.confirm = originalConfirm;
      winHolder.window.alert = originalAlert;
    }
    jest.restoreAllMocks();
  });

  it('AC-D01: renders title & message on web, orders [Vazgeç, Sil] so Enter cannot trigger destructive first, resolves true and unmounts Modal', async () => {
    const r = await mountHost();
    expect(r.toJSON()).toBeNull();

    let p!: Promise<boolean>;
    await act(async () => {
      p = confirm({
        title: 'Notu Sil',
        message: '"x" silinsin mi?',
        confirmText: 'Sil',
        destructive: true,
      });
    });
    await flush();

    expect(textOf(r)).toContain('Notu Sil');
    expect(textOf(r)).toContain('"x" silinsin mi?');

    const buttons = r.root.findAllByType(TouchableOpacity);
    const labels = buttons.map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual(['Vazgeç', 'Sil']);

    await act(async () => {
      buttons[1].props.onPress();
    });
    expect(await p).toBe(true);
    expect(r.toJSON()).toBeNull();
  });

  it('AC-D02: Vazgeç, Modal.onRequestClose and backdrop Pressable all resolve false; late onRequestClose is a no-op and never wipes the next queued dialog', async () => {
    const r = await mountHost();

    // 1. Vazgeç button -> false
    let p1!: Promise<boolean>;
    await act(async () => {
      p1 = confirm({ title: 'Sil 1', confirmText: 'Sil', destructive: true });
    });
    await flush();
    await act(async () => {
      findButton(r, 'Vazgeç').props.onPress();
    });
    expect(await p1).toBe(false);

    // 2. Modal.onRequestClose (Esc / hardware back) -> false
    let p2!: Promise<boolean>;
    await act(async () => {
      p2 = confirm({ title: 'Sil 2', confirmText: 'Sil', destructive: true });
    });
    await flush();
    const modal2 = r.root.findByType(Modal);
    await act(async () => {
      modal2.props.onRequestClose();
    });
    expect(await p2).toBe(false);

    // 3. Backdrop Pressable -> false
    let p3!: Promise<boolean>;
    await act(async () => {
      p3 = confirm({ title: 'Sil 3', confirmText: 'Sil', destructive: true });
    });
    await flush();
    const backdrop = r.root.findAll(
      (n) => n.props?.accessible === false && n.props?.focusable === false && typeof n.props?.onPress === 'function',
    )[0];
    expect(backdrop).toBeDefined();
    await act(async () => {
      backdrop.props.onPress();
    });
    expect(await p3).toBe(false);

    // 4. Stale onRequestClose after Sil press neither changes p4 nor clobbers queued p5 (guards settleDialog current !== req)
    let p4!: Promise<boolean>;
    let p5!: Promise<boolean>;
    await act(async () => {
      p4 = confirm({ title: 'Birinci Onay', confirmText: 'Sil', destructive: true });
      p5 = confirm({ title: 'İkinci Onay', confirmText: 'Onayla' });
    });
    await flush();
    const staleClose = r.root.findByType(Modal).props.onRequestClose as () => void;
    await act(async () => {
      findButton(r, 'Sil').props.onPress();
    });
    expect(await p4).toBe(true);
    await flush();

    expect(getCurrentDialog()?.title).toBe('İkinci Onay');
    await act(async () => {
      expect(() => staleClose()).not.toThrow();
    });
    expect(getCurrentDialog()?.title).toBe('İkinci Onay');
    expect(textOf(r)).toContain('İkinci Onay');

    await act(async () => {
      findButton(r, 'Onayla').props.onPress();
    });
    expect(await p5).toBe(true);
  });

  it('AC-D03: queues distinct notify calls in FIFO order and coalesces identical notify calls into a single dialog', async () => {
    const r = await mountHost();

    let nA1!: Promise<void>;
    let nA2!: Promise<void>;
    let nB!: Promise<void>;
    await act(async () => {
      nA1 = notify('Hata A', 'İlk ileti');
      nA2 = notify('Hata A', 'İlk ileti');
      nB = notify('Hata B', 'İkinci ileti');
    });
    await flush();

    expect(textOf(r)).toContain('Hata A');
    expect(textOf(r)).not.toContain('Hata B');

    let a1Done = false;
    let a2Done = false;
    void nA1.then(() => { a1Done = true; });
    void nA2.then(() => { a2Done = true; });

    await act(async () => {
      findButton(r, 'Tamam').props.onPress();
    });
    await flush();
    expect(a1Done).toBe(true);
    expect(a2Done).toBe(true);

    expect(textOf(r)).toContain('Hata B');
    await act(async () => {
      findButton(r, 'Tamam').props.onPress();
    });
    await Promise.all([nA1, nA2, nB]);
    expect(r.toJSON()).toBeNull();
  });

  it('AC-D04: double-tap on identical confirm immediately resolves the second call to false and renders only one dialog', async () => {
    const r = await mountHost();

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => {
      first = confirm({ title: 'Görevi Sil', message: '"Rapor" silinsin mi?', confirmText: 'Sil', destructive: true });
      second = confirm({ title: 'Görevi Sil', message: '"Rapor" silinsin mi?', confirmText: 'Sil', destructive: true });
    });

    expect(await second).toBe(false);
    await flush();

    await act(async () => {
      findButton(r, 'Sil').props.onPress();
    });
    expect(await first).toBe(true);
    await flush();
    expect(r.toJSON()).toBeNull();
  });

  it('AC-D05: dismissAllDialogs() settles the visible confirm to false, skips queued confirms without rendering them, and allows fresh confirms afterwards', async () => {
    const r = await mountHost();
    let renderedSecond = false;

    let p1!: Promise<boolean>;
    let p2!: Promise<boolean>;
    await act(async () => {
      p1 = confirm({ title: 'Açık Onay', confirmText: 'Sil', destructive: true });
      p2 = confirm({ title: 'Kuyruktaki Onay', confirmText: 'Sil', destructive: true });
    });
    await flush();
    expect(textOf(r)).toContain('Açık Onay');

    await act(async () => {
      dismissAllDialogs();
    });
    if (textOf(r).includes('Kuyruktaki Onay')) renderedSecond = true;
    await flush();
    if (textOf(r).includes('Kuyruktaki Onay')) renderedSecond = true;

    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
    expect(renderedSecond).toBe(false);
    expect(r.toJSON()).toBeNull();

    let p3!: Promise<boolean>;
    await act(async () => {
      p3 = confirm({ title: 'Yeni Hesap Onayı', confirmText: 'Onayla' });
    });
    await flush();
    expect(textOf(r)).toContain('Yeni Hesap Onayı');
    await act(async () => {
      findButton(r, 'Onayla').props.onPress();
    });
    expect(await p3).toBe(true);
  });

  it('AC-D06: actionSheet renders 5 options + 1 cancel row (6 buttons, never Alert.alert), enforces minHeight >= 44, respects disabled, and resolves id or null', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = await mountHost();

    const fiveOptions = [
      { id: 'focus', label: 'Odağa geç', icon: 'timer-outline' },
      { id: 'weekly', label: 'Haftayı değerlendir', icon: 'calendar-outline' },
      { id: 'recovery', label: 'Denge planı', icon: 'leaf-outline' },
      { id: 'projects', label: 'Projeler', icon: 'folder-outline', disabled: true },
      { id: 'notes', label: 'Notlar', icon: 'document-text-outline' },
    ] as const;

    let pPick!: Promise<string | null>;
    await act(async () => {
      pPick = actionSheet({ title: 'Diğer', options: fiveOptions });
    });
    await flush();

    expect(alertSpy).not.toHaveBeenCalled();
    const rows = r.root.findAllByType(TouchableOpacity);
    expect(rows).toHaveLength(6); // 5 items + 1 Vazgeç row (not 7)
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'Odağa geç',
      'Haftayı değerlendir',
      'Denge planı',
      'Projeler',
      'Notlar',
      'Vazgeç',
    ]);

    for (const row of rows) {
      const flat = flattenStyle(row.props.style);
      expect(Number(flat.minHeight ?? 0)).toBeGreaterThanOrEqual(44);
    }

    // Disabled row (index 3) does not settle the sheet
    let settled = false;
    void pPick.then(() => { settled = true; });
    await act(async () => {
      rows[3].props.onPress?.();
    });
    await flush();
    expect(settled).toBe(false);

    // Third row (index 2: 'recovery') resolves its id
    await act(async () => {
      rows[2].props.onPress();
    });
    expect(await pPick).toBe('recovery');

    // Cancel row -> null
    let pCancel!: Promise<string | null>;
    await act(async () => {
      pCancel = actionSheet({ title: 'Diğer', options: fiveOptions });
    });
    await flush();
    await act(async () => {
      findButton(r, 'Vazgeç').props.onPress();
    });
    expect(await pCancel).toBeNull();

    // Modal.onRequestClose -> null
    let pEsc!: Promise<string | null>;
    await act(async () => {
      pEsc = actionSheet({ title: 'Diğer', options: fiveOptions });
    });
    await flush();
    await act(async () => {
      r.root.findByType(Modal).props.onRequestClose();
    });
    expect(await pEsc).toBeNull();
  });

  it('AC-D07: web fallback uses window.confirm/window.alert ONLY when no DialogHost is mounted, never when mounted, and never calls Alert.alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const winConfirm = jest.fn(() => true);
    const winAlert = jest.fn();
    if (!winHolder.window) winHolder.window = {};
    winHolder.window.confirm = winConfirm;
    winHolder.window.alert = winAlert;

    // No host mounted -> window fallback
    expect(await confirm({ title: 'Yedek Onay', message: 'Devam edilsin mi?' })).toBe(true);
    expect(winConfirm).toHaveBeenCalledTimes(1);
    expect(winConfirm).toHaveBeenCalledWith('Yedek Onay\n\nDevam edilsin mi?');

    await notify('Yedek Bildirim', 'Bilgi');
    expect(winAlert).toHaveBeenCalledTimes(1);
    expect(winAlert).toHaveBeenCalledWith('Yedek Bildirim\n\nBilgi');
    expect(alertSpy).not.toHaveBeenCalled();

    // Host mounted -> window.* NEVER called
    winConfirm.mockClear();
    winAlert.mockClear();
    const r = await mountHost();
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirm({ title: 'Uygulama İçi Onay', confirmText: 'Evet' });
    });
    await flush();
    expect(winConfirm).not.toHaveBeenCalled();
    await act(async () => {
      findButton(r, 'Evet').props.onPress();
    });
    expect(await p).toBe(true);
    expect(winConfirm).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('AC-D08: registers "dialogs" in accountScope and cancels open dialogs when onReset("signed_out") runs', async () => {
    expect(registeredAtImport).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'dialogs' })]),
    );
    const entry = registeredAtImport.find((arg) => arg.name === 'dialogs');
    expect(entry).toBeDefined();
    expect(typeof entry?.onReset).toBe('function');

    const r = await mountHost();
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirm({ title: 'Hesap A Silme Onayı', confirmText: 'Sil', destructive: true });
    });
    await flush();
    expect(textOf(r)).toContain('Hesap A Silme Onayı');

    await act(async () => {
      entry?.onReset?.('signed_out');
    });
    expect(await p).toBe(false);
    expect(r.toJSON()).toBeNull();
  });

  it('AC-D09: ActionSheet honours reduceMotion ("none" vs "slide") and renders no rows when visible={false}', async () => {
    let rReduced!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rReduced = TestRenderer.create(
        <ActionSheet
          visible
          title="Menü"
          items={[{ id: 'a', label: 'Seçenek A' }]}
          reduceMotion={true}
          onSelect={() => undefined}
          onCancel={() => undefined}
        />,
      );
    });
    expect(rReduced.root.findByType(Modal).props.animationType).toBe('none');
    await act(async () => {
      rReduced.unmount();
    });

    let rNormal!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rNormal = TestRenderer.create(
        <ActionSheet
          visible
          title="Menü"
          items={[{ id: 'a', label: 'Seçenek A' }]}
          reduceMotion={false}
          onSelect={() => undefined}
          onCancel={() => undefined}
        />,
      );
    });
    expect(rNormal.root.findByType(Modal).props.animationType).toBe('slide');
    await act(async () => {
      rNormal.unmount();
    });

    let rHidden!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rHidden = TestRenderer.create(
        <ActionSheet
          visible={false}
          title="Menü"
          items={[{ id: 'a', label: 'Seçenek A' }]}
          onSelect={() => undefined}
          onCancel={() => undefined}
        />,
      );
    });
    expect(rHidden.root.findAllByType(TouchableOpacity)).toHaveLength(0);
    await act(async () => {
      rHidden.unmount();
    });
  });

  it('GAP2-02 integrated web flow: two-step deleteAccountFlow renders two sequential modals on DialogHost and invokes deleteAccount once', async () => {
    const r = await mountHost();
    const deleteAccount = jest.fn(async () => ({ ok: true as const }));
    const busyStates: boolean[] = [];

    let flowPromise!: Promise<string>;
    await act(async () => {
      flowPromise = runDeleteAccountFlow({
        unsent: 2,
        confirm,
        notify,
        deleteAccount,
        onBusy: (b) => busyStates.push(b),
      });
    });
    await flush();

    // Step 1 modal
    expect(textOf(r)).toContain('Hesabını Sil');
    expect(textOf(r)).toContain('2 değişiklik');
    await act(async () => {
      findButton(r, 'Devam Et').props.onPress();
    });
    await flush();

    // Step 2 modal
    expect(textOf(r)).toContain('Emin misin?');
    expect(deleteAccount).not.toHaveBeenCalled();
    await act(async () => {
      findButton(r, 'Hesabımı Sil').props.onPress();
    });

    expect(await flowPromise).toBe('deleted');
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(busyStates).toEqual([true, false]);
  });
});
