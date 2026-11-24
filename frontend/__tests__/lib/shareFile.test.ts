/**
 * F20 (GAP2-05, GAP1-06, GAP2-06) — platformlar arası paylaşım/indirme ve zamanlı pano temizliği.
 */
import {
  CLIPBOARD_WIPE_MS,
  NATIVE_SHARE_MAX_CHARS,
  browserDownload,
  cancelClipboardWipe,
  copyTextWithWipe,
  shareOrDownload,
} from '../../lib/shareFile';

afterEach(() => {
  cancelClipboardWipe();
});

describe('shareOrDownload ve browserDownload — pozitif vakalar', () => {
  it('web ortamında indirme başarılıysa downloaded döner ve share çağrılmaz', async () => {
    const share = jest.fn();
    const download = jest.fn(() => true);
    const out = await shareOrDownload(
      { filename: 'veri.json', mime: 'application/json', content: '{}' },
      { os: 'web', share, download },
    );
    expect(out).toBe('downloaded');
    expect(download).toHaveBeenCalledWith('veri.json', 'application/json', '{}');
    expect(share).not.toHaveBeenCalled();
  });

  it('native ortamda paylaşım sonucunu shared ve cancelled olarak doğru sınıflandırır', async () => {
    await expect(
      shareOrDownload(
        { filename: 'veri.json', mime: 'application/json', content: '{}', title: 'Başlık' },
        { os: 'ios', share: async () => ({ action: 'sharedAction' }), download: () => false },
      ),
    ).resolves.toBe('shared');

    await expect(
      shareOrDownload(
        { filename: 'veri.json', mime: 'application/json', content: '{}' },
        { os: 'android', share: async () => ({ action: 'dismissedAction' }), download: () => false },
      ),
    ).resolves.toBe('cancelled');

    const abortErr = Object.assign(new Error('User cancelled'), { name: 'AbortError' });
    await expect(
      shareOrDownload(
        { filename: 'veri.json', mime: 'application/json', content: '{}' },
        { os: 'ios', share: async () => { throw abortErr; }, download: () => false },
      ),
    ).resolves.toBe('cancelled');
  });

  it('browserDownload DOM mevcutken bağlantıyı tıklar ve URL kaynağını serbest bırakır', () => {
    const g = globalThis as Record<string, unknown>;
    const prevDoc = g.document;
    const prevBlob = g.Blob;
    const prevUrl = g.URL;
    const click = jest.fn();
    const remove = jest.fn();
    const appendChild = jest.fn();
    const revokeObjectURL = jest.fn();

    try {
      g.Blob = class FakeBlob {
        parts: unknown[];
        constructor(parts: unknown[]) { this.parts = parts; }
      };
      g.URL = { createObjectURL: () => 'blob:test', revokeObjectURL };
      g.document = {
        createElement: () => ({ href: '', download: '', click, remove }),
        body: { appendChild },
      };
      expect(browserDownload('rapor.csv', 'text/csv', 'a,b')).toBe(true);
      expect(appendChild).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    } finally {
      g.document = prevDoc;
      g.Blob = prevBlob;
      g.URL = prevUrl;
    }
  });
});

describe('shareOrDownload — negatif vakalar', () => {
  it('web indirmesi başarısızsa DOWNLOAD_UNAVAILABLE fırlatır; native hata ve boyut sınırını yutmaz', async () => {
    await expect(
      shareOrDownload(
        { filename: 'veri.json', mime: 'application/json', content: '{}' },
        { os: 'web', download: () => false, share: jest.fn() },
      ),
    ).rejects.toThrow('DOWNLOAD_UNAVAILABLE');

    await expect(
      shareOrDownload(
        { filename: 'veri.json', mime: 'application/json', content: '{}' },
        { os: 'android', share: async () => { throw new Error('gerçek hata'); }, download: () => true },
      ),
    ).rejects.toThrow('gerçek hata');

    const share = jest.fn();
    const huge = 'x'.repeat(NATIVE_SHARE_MAX_CHARS + 1);
    await expect(
      shareOrDownload(
        { filename: 'veri.json', mime: 'application/json', content: huge },
        { os: 'android', share, download: () => true },
      ),
    ).resolves.toBe('too_large');
    expect(share).not.toHaveBeenCalled();
  });
});

describe('copyTextWithWipe — pozitif ve negatif vakalar', () => {
  it('panoya yazar ve süre sonunda pano hâlâ aynı metni tutuyorsa temizler', async () => {
    let clip = '';
    let scheduledFn: (() => void) | null = null;
    const set = jest.fn(async (t: string) => { clip = t; });
    const get = jest.fn(async () => clip);

    const res = await copyTextWithWipe(
      'gizli günlük',
      { wipeAfterMs: CLIPBOARD_WIPE_MS },
      {
        set,
        get,
        setTimer: (fn) => { scheduledFn = fn; return 'h1'; },
        clearTimer: jest.fn(),
      },
    );

    expect(res).toEqual({ ok: true });
    expect(clip).toBe('gizli günlük');
    expect(scheduledFn).not.toBeNull();

    await scheduledFn!();
    expect(set).toHaveBeenLastCalledWith('');
    expect(clip).toBe('');
  });

  it('kullanıcı arada başka bir metin kopyaladıysa veya pano okunamazsa panoya dokunmaz', async () => {
    let clip = '';
    const callbacks: (() => void)[] = [];
    const set = jest.fn(async (t: string) => { clip = t; });

    await copyTextWithWipe(
      'ilk metin',
      { wipeAfterMs: 1000 },
      {
        set,
        get: async () => clip,
        setTimer: (fn) => { callbacks.push(fn); return 'h-other'; },
        clearTimer: jest.fn(),
      },
    );
    clip = 'kullanıcının yeni kopyası';
    set.mockClear();

    await callbacks[0]();
    expect(set).not.toHaveBeenCalled();
    expect(clip).toBe('kullanıcının yeni kopyası');

    // get() reddederse set('') çağrılmaz ve istisna dışarı sızmaz
    await copyTextWithWipe(
      'ikinci metin',
      { wipeAfterMs: 1000 },
      {
        set,
        get: async () => { throw new Error('NotAllowedError'); },
        setTimer: (fn) => { callbacks.push(fn); return 'h-deny'; },
        clearTimer: jest.fn(),
      },
    );
    set.mockClear();
    await expect(callbacks[1]()).resolves.toBeUndefined();
    expect(set).not.toHaveBeenCalled();
  });

  it('yazma hatasında Türkçe hata döner ve zamanlayıcı kurmaz; ikinci kopya ilk zamanlayıcıyı iptal eder', async () => {
    const setTimer = jest.fn(() => 'timer-1');
    const clearTimer = jest.fn();

    const failed = await copyTextWithWipe(
      'metin',
      {},
      {
        set: async () => { throw new Error('Document is not focused'); },
        get: async () => '',
        setTimer,
        clearTimer,
      },
    );

    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatch(/Panoya kopyalanamadı/);
    }
    expect(setTimer).not.toHaveBeenCalled();

    // İkinci başarılı kopya birincinin zamanlayıcısını iptal eder
    let timerSeq = 0;
    await copyTextWithWipe('bir', {}, {
      set: async () => undefined,
      get: async () => 'bir',
      setTimer: () => `t-${++timerSeq}`,
      clearTimer,
    });
    await copyTextWithWipe('iki', {}, {
      set: async () => undefined,
      get: async () => 'iki',
      setTimer: () => `t-${++timerSeq}`,
      clearTimer,
    });
    expect(clearTimer).toHaveBeenCalledWith('t-1');
  });
});
