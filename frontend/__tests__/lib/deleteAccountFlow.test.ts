import {
  FINAL_CONFIRM_OPTIONS,
  firstConfirmOptions,
  runDeleteAccountFlow,
} from '../../lib/deleteAccountFlow';
import type { ConfirmOptions } from '../../lib/dialog';

describe('lib/deleteAccountFlow — two-step account deletion (F24: GAP2-02)', () => {
  it('firstConfirmOptions builds honest copy with unsent count only when unsent > 0, and FINAL_CONFIRM_OPTIONS is destructive', () => {
    const clean = firstConfirmOptions(0);
    expect(clean.title).toBe('Hesabını Sil');
    expect(clean.confirmText).toBe('Devam Et');
    expect(clean.destructive).toBe(true);
    expect(clean.message).not.toContain('gönderilmemiş');
    expect(clean.message).toContain('Bu işlem geri alınamaz.');

    const dirty = firstConfirmOptions(3);
    expect(dirty.title).toBe('Hesabını Sil');
    expect(dirty.confirmText).toBe('Devam Et');
    expect(dirty.destructive).toBe(true);
    expect(dirty.message).toContain('3 değişiklik');

    expect(FINAL_CONFIRM_OPTIONS).toEqual({
      title: 'Emin misin?',
      message: 'Son onay. Hesabın kalıcı olarak silinecek ve verilerin geri getirilemeyecek.',
      confirmText: 'Hesabımı Sil',
      destructive: true,
    });
  });

  it('positive: two true confirmations call deleteAccount once, toggle onBusy [true, false], skip notify, and return "deleted"', async () => {
    const seenOpts: ConfirmOptions[] = [];
    const confirmMock = jest.fn(async (opts: ConfirmOptions) => {
      seenOpts.push(opts);
      return true;
    });
    const notifyMock = jest.fn(async () => undefined);
    const deleteAccount = jest.fn(async () => ({ ok: true as const }));
    const busyLog: boolean[] = [];

    const outcome = await runDeleteAccountFlow({
      unsent: 0,
      confirm: confirmMock,
      notify: notifyMock,
      deleteAccount,
      onBusy: (b) => busyLog.push(b),
    });

    expect(outcome).toBe('deleted');
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(seenOpts[0].title).toBe('Hesabını Sil');
    expect(seenOpts[1].title).toBe('Emin misin?');
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(busyLog).toEqual([true, false]);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('negative: cancelling first confirmation stops immediately without asking second confirmation or calling deleteAccount', async () => {
    const confirmMock = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const notifyMock = jest.fn(async () => undefined);
    const deleteAccount = jest.fn(async () => ({ ok: true as const }));
    const onBusy = jest.fn();

    const outcome = await runDeleteAccountFlow({
      unsent: 1,
      confirm: confirmMock,
      notify: notifyMock,
      deleteAccount,
      onBusy,
    });

    expect(outcome).toBe('cancelled_first');
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(onBusy).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('negative: cancelling final confirmation never calls deleteAccount or onBusy', async () => {
    const confirmMock = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const notifyMock = jest.fn(async () => undefined);
    const deleteAccount = jest.fn(async () => ({ ok: true as const }));
    const onBusy = jest.fn();

    const outcome = await runDeleteAccountFlow({
      unsent: 0,
      confirm: confirmMock,
      notify: notifyMock,
      deleteAccount,
      onBusy,
    });

    expect(outcome).toBe('cancelled_final');
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(onBusy).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('failure & throw: reports error via notify("Hesap silinemedi", error) and always resets onBusy(false) in finally', async () => {
    const confirmMock = jest.fn(async () => true);
    const notifyMock = jest.fn(async () => undefined);
    const busyFail: boolean[] = [];

    const outcome = await runDeleteAccountFlow({
      unsent: 0,
      confirm: confirmMock,
      notify: notifyMock,
      deleteAccount: async () => ({ ok: false, error: 'Sunucu yanıt vermedi' }),
      onBusy: (b) => busyFail.push(b),
    });

    expect(outcome).toBe('failed');
    expect(busyFail).toEqual([true, false]);
    expect(notifyMock).toHaveBeenCalledWith('Hesap silinemedi', 'Sunucu yanıt vermedi');

    const busyThrow: boolean[] = [];
    await expect(
      runDeleteAccountFlow({
        unsent: 0,
        confirm: confirmMock,
        notify: notifyMock,
        deleteAccount: async () => {
          throw new Error('beklenmeyen ağ hatası');
        },
        onBusy: (b) => busyThrow.push(b),
      }),
    ).rejects.toThrow('beklenmeyen ağ hatası');
    expect(busyThrow).toEqual([true, false]);
  });
});
