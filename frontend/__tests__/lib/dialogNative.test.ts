import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as crashReporting from '../../lib/crashReporting';
import {
  actionSheet,
  confirm,
  dismissAllDialogs,
  getCurrentDialog,
  notify,
  registerDialogHost,
  settleDialog,
} from '../../lib/dialog';

describe('lib/dialog — native platform contract (F24: GAP2-01, NAV-03)', () => {
  const originalOS = Platform.OS;
  const originalIsPad = 'isPad' in Platform ? Platform.isPad : undefined;

  function setOS(os: 'ios' | 'android' | 'web', isPad = false) {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    Object.defineProperty(Platform, 'isPad', { value: isPad, configurable: true });
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    dismissAllDialogs();
  });

  afterEach(() => {
    dismissAllDialogs();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'isPad', { value: originalIsPad, configurable: true });
  });

  it('iOS confirm: passes cancel + destructive buttons, cancelable + onDismiss, resolves once, never uses host queue', async () => {
    setOS('ios');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const pAccept = confirm({
      title: 'Notu Sil',
      message: '"Özet" silinsin mi?',
      confirmText: 'Sil',
      destructive: true,
    });
    expect(getCurrentDialog()).toBeNull();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    const [title, message, buttons, options] = alertSpy.mock.calls[0];
    expect(title).toBe('Notu Sil');
    expect(message).toBe('"Özet" silinsin mi?');
    expect(buttons).toHaveLength(2);
    expect(buttons?.[0]).toEqual(expect.objectContaining({ text: 'Vazgeç', style: 'cancel' }));
    expect(buttons?.[1]).toEqual(expect.objectContaining({ text: 'Sil', style: 'destructive' }));
    expect(options?.cancelable).toBe(true);
    expect(typeof options?.onDismiss).toBe('function');

    // Confirm press resolves true; a second press or late cancel does not flip the outcome
    buttons?.[1]?.onPress?.();
    buttons?.[0]?.onPress?.();
    expect(await pAccept).toBe(true);

    // Cancel press resolves false; non-destructive uses 'default' style
    alertSpy.mockClear();
    const pCancel = confirm({ title: 'Arayı bitir', confirmText: 'Bitir' });
    const [, , buttons2] = alertSpy.mock.calls[0];
    expect(buttons2?.[1]).toEqual(expect.objectContaining({ text: 'Bitir', style: 'default' }));
    buttons2?.[0]?.onPress?.();
    buttons2?.[1]?.onPress?.();
    expect(await pCancel).toBe(false);
  });

  it('Android confirm & notify: back-button onDismiss resolves false; identical concurrent notify coalesces into one Alert', async () => {
    setOS('android');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const pBack = confirm({ title: 'Görevi Sil', confirmText: 'Sil', destructive: true });
    const [, , , opts] = alertSpy.mock.calls[0];
    expect(opts?.cancelable).toBe(true);
    expect(typeof opts?.onDismiss).toBe('function');
    opts?.onDismiss?.();
    expect(await pBack).toBe(false);

    // Identical concurrent notify -> single Alert.alert, both callers resolve together
    alertSpy.mockClear();
    const n1 = notify('Kaydedilemedi', 'Bağlantı kesildi');
    const n2 = notify('Kaydedilemedi', 'Bağlantı kesildi');
    const n3 = notify('Kaydedilemedi', 'Farklı hata');
    expect(alertSpy).toHaveBeenCalledTimes(2);

    const [, , okButtons1] = alertSpy.mock.calls[0];
    const [, , okButtons2] = alertSpy.mock.calls[1];
    expect(okButtons1).toHaveLength(1);
    expect(okButtons1?.[0]?.text).toBe('Tamam');
    okButtons1?.[0]?.onPress?.();
    okButtons2?.[0]?.onPress?.();
    await expect(Promise.all([n1, n2, n3])).resolves.toEqual([undefined, undefined, undefined]);
  });

  it('NAV-03 Android actionSheet: NEVER calls Alert.alert for 5 options; routes all 5 to DialogHost, or reports constant context when unmounted', async () => {
    setOS('android');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const reportSpy = jest.spyOn(crashReporting, 'reportError').mockImplementation(() => undefined);

    const fiveOptions = [
      { id: 'focus', label: 'Odağa geç' },
      { id: 'weekly', label: 'Haftayı değerlendir' },
      { id: 'recovery', label: 'Denge planı' },
      { id: 'projects', label: 'Projeler' },
      { id: 'notes', label: 'Notlar' },
    ] as const;

    // Without host mounted -> resolves null, logs constant context without user labels
    const noHostPick = await actionSheet({ title: 'Diğer Özel Başlık', options: fiveOptions });
    expect(noHostPick).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy.mock.calls[0][2]).toBe('dialog-no-host');
    expect(JSON.stringify(reportSpy.mock.calls[0])).not.toContain('Diğer Özel Başlık');
    expect(JSON.stringify(reportSpy.mock.calls[0])).not.toContain('Notlar');

    // With host mounted -> all 5 options reach host intact, never truncated to 3
    const unregister = registerDialogHost();
    try {
      const pickPromise = actionSheet({ title: 'Diğer', options: fiveOptions });
      await Promise.resolve();
      expect(alertSpy).not.toHaveBeenCalled();
      const req = getCurrentDialog();
      expect(req).not.toBeNull();
      expect(req?.kind).toBe('sheet');
      if (req?.kind === 'sheet') {
        expect(req.options).toHaveLength(5);
        expect(req.options.map((o) => o.id)).toEqual(['focus', 'weekly', 'recovery', 'projects', 'notes']);
        settleDialog(req, 'notes');
      }
      expect(await pickPromise).toBe('notes');
    } finally {
      unregister();
    }
  });

  it('iOS actionSheet: uses ActionSheetIOS on iPhone with exact cancel/destructive/disabled indices, and falls back to DialogHost on iPad', async () => {
    setOS('ios', false);
    const iosSpy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);

    const opts = [
      { id: 'open', label: 'Aç' },
      { id: 'edit', label: 'Düzenle', disabled: true },
      { id: 'remove', label: 'Sil', destructive: true },
    ] as const;

    const pPick = actionSheet({ title: 'Seçenekler', message: 'Bir eylem seç', options: opts });
    expect(iosSpy).toHaveBeenCalledTimes(1);
    const [sheetConfig, callback] = iosSpy.mock.calls[0];
    expect(sheetConfig.options).toEqual(['Aç', 'Düzenle', 'Sil', 'Vazgeç']);
    expect(sheetConfig.cancelButtonIndex).toBe(3);
    expect(sheetConfig.destructiveButtonIndex).toEqual([2]);
    expect(sheetConfig.disabledButtonIndices).toEqual([1]);
    callback(1);
    expect(await pPick).toBe('edit');

    const pCancel = actionSheet({ title: 'Seçenekler', options: opts });
    iosSpy.mock.calls[1][1](3);
    expect(await pCancel).toBeNull();

    // iPad: ActionSheetIOS requires an anchor rect, so it routes to DialogHost instead
    iosSpy.mockClear();
    setOS('ios', true);
    const unregister = registerDialogHost();
    try {
      const pPad = actionSheet({ title: 'Seçenekler', options: opts });
      await Promise.resolve();
      expect(iosSpy).not.toHaveBeenCalled();
      const req = getCurrentDialog();
      expect(req?.kind).toBe('sheet');
      if (req) settleDialog(req, 'open');
      expect(await pPad).toBe('open');
    } finally {
      unregister();
    }
  });

  it('Account boundary: dismissAllDialogs() invalidates an in-flight native confirm even if its Sil button is tapped afterwards', async () => {
    setOS('ios');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const pStale = confirm({ title: 'Hesabını Sil', confirmText: 'Sil', destructive: true });
    const [, , staleButtons] = alertSpy.mock.calls[0];

    // Account signs out while native Alert is still on screen
    dismissAllDialogs();

    // Late tap on destructive "Sil" must resolve false
    staleButtons?.[1]?.onPress?.();
    expect(await pStale).toBe(false);

    // Subsequent confirm in the new epoch resolves normally
    alertSpy.mockClear();
    const pFresh = confirm({ title: 'Hesabını Sil', confirmText: 'Sil', destructive: true });
    const [, , freshButtons] = alertSpy.mock.calls[0];
    freshButtons?.[1]?.onPress?.();
    expect(await pFresh).toBe(true);
  });
});
