import type { ConfirmOptions } from './dialog';

export type DeleteAccountOutcome = 'cancelled_first' | 'cancelled_final' | 'deleted' | 'failed';

export type DeleteAccountDeps = {
  /** accountService.unsentChangeCount() — cihazda sunucuya gitmemiş değişiklik sayısı. */
  unsent: number;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (title: string, message?: string) => Promise<void>;
  deleteAccount: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onBusy: (busy: boolean) => void;
};

export function firstConfirmOptions(unsent: number): ConfirmOptions {
  const unsentLine =
    unsent > 0
      ? `\n\nBu cihazda henüz sunucuya gönderilmemiş ${unsent} değişiklik var; hesapla birlikte bunlar da silinecek.`
      : '';
  return {
    title: 'Hesabını Sil',
    message:
      "Hesabın ve Aderyth'te saklanan kişisel verilerin silinecek: alışkanlıkların, kayıtların, görevlerin, notların, günlüğün, hedeflerin, odak seansların ve AI Koç sohbetlerin." +
      unsentLine +
      '\n\nBu işlem geri alınamaz.',
    confirmText: 'Devam Et',
    destructive: true,
  };
}

export const FINAL_CONFIRM_OPTIONS: ConfirmOptions = {
  title: 'Emin misin?',
  message: 'Son onay. Hesabın kalıcı olarak silinecek ve verilerin geri getirilemeyecek.',
  confirmText: 'Hesabımı Sil',
  destructive: true,
};

export async function runDeleteAccountFlow(deps: DeleteAccountDeps): Promise<DeleteAccountOutcome> {
  const first = await deps.confirm(firstConfirmOptions(deps.unsent));
  if (!first) return 'cancelled_first';

  const second = await deps.confirm(FINAL_CONFIRM_OPTIONS);
  if (!second) return 'cancelled_final';

  deps.onBusy(true);
  let res: { ok: true } | { ok: false; error: string };
  try {
    res = await deps.deleteAccount();
  } finally {
    deps.onBusy(false);
  }

  if (!res.ok) {
    void deps.notify('Hesap silinemedi', res.error);
    return 'failed';
  }

  return 'deleted';
}
