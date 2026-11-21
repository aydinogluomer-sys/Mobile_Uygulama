/**
 * F20 (GAP2-05, GAP1-06, GAP2-06) — metnin uygulamadan çıkış kapısı:
 * tarayıcı dosya indirme, native paylaşım sayfası ve zamanlı pano temizliği.
 */
import * as Clipboard from 'expo-clipboard';
import { Platform, Share } from 'react-native';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'too_large';

export type ShareFilePayload = {
  filename: string;
  mime: string;
  content: string;
  title?: string;
};

export type ShareFileEnv = {
  os: string;
  share: (opts: { message: string; title?: string }) => Promise<{ action: string }>;
  download: (filename: string, mime: string, content: string) => boolean;
};

/** Native Share.share'e verilen metin bundan büyükse denenmez ('too_large'): Android Binder sınırı. */
export const NATIVE_SHARE_MAX_CHARS = 3_000_000;

/** Tarayıcıda Blob + <a download>. Belge/Blob yoksa false. */
export function browserDownload(filename: string, mime: string, content: string): boolean {
  try {
    const g = globalThis as Record<string, unknown>;
    const doc = g?.document as
      | {
          createElement: (tag: string) => { href: string; download: string; click: () => void; remove: () => void };
          body?: { appendChild: (el: unknown) => void };
        }
      | undefined;
    const BlobCtor = g?.Blob as (new (parts: unknown[], opts: { type: string }) => unknown) | undefined;
    const urlApi = g?.URL as { createObjectURL?: (b: unknown) => string; revokeObjectURL?: (u: string) => void } | undefined;
    if (!doc?.body || !BlobCtor || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL) return false;
    const url = urlApi.createObjectURL(new BlobCtor([content], { type: mime }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    urlApi.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * web: indirir ('downloaded'); indirme mümkün değilse `Error('DOWNLOAD_UNAVAILABLE')` fırlatır.
 * native: Share.share; kullanıcı kapatırsa 'cancelled'; AbortError de 'cancelled'; diğer hatalar fırlar.
 */
export async function shareOrDownload(
  file: ShareFilePayload,
  env: Partial<ShareFileEnv> = {},
): Promise<ShareOutcome> {
  const os = env.os ?? Platform.OS;
  if (os === 'web') {
    const ok = (env.download ?? browserDownload)(file.filename, file.mime, file.content);
    if (!ok) throw new Error('DOWNLOAD_UNAVAILABLE');
    return 'downloaded';
  }
  if (file.content.length > NATIVE_SHARE_MAX_CHARS) return 'too_large';
  try {
    const shareFn = env.share ?? ((opts: { message: string; title?: string }) => Share.share(opts));
    const r = await shareFn({ message: file.content, title: file.title });
    return r?.action === 'dismissedAction' ? 'cancelled' : 'shared';
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

export type CopyResult = { ok: true } | { ok: false; error: string };

export type ClipboardEnv = {
  set: (text: string) => Promise<void>;
  get: () => Promise<string>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export const CLIPBOARD_WIPE_MS = 60_000;

let wipeHandle: unknown = null;
let wipeClear: ((handle: unknown) => void) | null = null;

export function cancelClipboardWipe(): void {
  if (wipeHandle !== null && wipeClear) {
    wipeClear(wipeHandle);
  }
  wipeHandle = null;
  wipeClear = null;
}

/**
 * Panoya yazar; hata yutulmaz, Türkçe `{ ok: false, error }` döner. Yazma başarılıysa `wipeAfterMs` sonra
 * pano HÂLÂ aynı metni içeriyorsa boşaltır; kullanıcı arada başka şey kopyaladıysa dokunmaz.
 */
export async function copyTextWithWipe(
  text: string,
  opts: { wipeAfterMs?: number } = {},
  env: Partial<ClipboardEnv> = {},
): Promise<CopyResult> {
  const set = env.set ?? (async (val: string) => { await Clipboard.setStringAsync(val); });
  const get = env.get ?? (() => Clipboard.getStringAsync());
  const setTimer = env.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = env.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  try {
    await set(text);
  } catch {
    return {
      ok: false,
      error: 'Panoya kopyalanamadı. Tarayıcı izin vermemiş olabilir; metni önizlemeden seçip kopyalayabilirsin.',
    };
  }

  cancelClipboardWipe();
  wipeClear = clearTimer;
  wipeHandle = setTimer(async () => {
    wipeHandle = null;
    wipeClear = null;
    try {
      if ((await get()) === text) {
        await set('');
      }
    } catch {
      /* pano okunamıyorsa dokunma */
    }
  }, opts.wipeAfterMs ?? CLIPBOARD_WIPE_MS);

  return { ok: true };
}
