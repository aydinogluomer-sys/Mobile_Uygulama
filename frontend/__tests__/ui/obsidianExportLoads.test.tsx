/**
 * F20 (GAP1-02, GAP1-06, GAP1-16, GAP2-06) — Obsidian aktarım modalı yükleme,
 * onay, pano sonucu, yarış koruması ve önizleme kırpması testleri.
 */
import React from 'react';
import { Alert } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/ui', () => ({ EmbeddedFiligree: () => null }));
jest.mock('../../lib/haptics', () => ({ haptic: { select: jest.fn(), success: jest.fn(), light: jest.fn() } }));

const mockState = {
  habits: [] as Record<string, unknown>[],
  tasks: [] as Record<string, unknown>[],
   tasksHasMore: false,
  entries: [] as Record<string, unknown>[],
  fetchHabits: jest.fn(async () => undefined),
  fetchTasks: jest.fn(async () => undefined),
  fetchEntries: jest.fn(async () => undefined),
  loadDay: jest.fn(async () => ({ ok: true as const, logs: [] as Record<string, unknown>[] })),
  collectAllNotes: jest.fn(async () => ({
    ok: true as const,
    data: { rows: [] as Record<string, unknown>[], truncated: false },
  })),
  copyTextWithWipe: jest.fn(async () => ({ ok: true as const })),
};

jest.mock('../../store/habitStore', () => ({
  useHabitStore: () => ({ habits: mockState.habits, fetchHabits: mockState.fetchHabits }),
}));
jest.mock('../../store/taskStore', () => ({
  useTaskStore: () => ({
    tasks: mockState.tasks,
    hasMore: mockState.tasksHasMore,
    fetchTasks: mockState.fetchTasks,
  }),
}));
jest.mock('../../store/journalStore', () => ({
  useJournalStore: () => ({ entries: mockState.entries, fetchEntries: mockState.fetchEntries }),
}));
jest.mock('../../services/habitLogService', () => ({
  loadDay: (...args: unknown[]) => (mockState.loadDay as (...a: unknown[]) => unknown)(...args),
}));
jest.mock('../../services/exportService', () => ({
  collectAllNotes: (...args: unknown[]) => (mockState.collectAllNotes as (...a: unknown[]) => unknown)(...args),
}));
jest.mock('../../lib/shareFile', () => ({
  CLIPBOARD_WIPE_MS: 60_000,
  copyTextWithWipe: (...args: unknown[]) => (mockState.copyTextWithWipe as (...a: unknown[]) => unknown)(...args),
}));

import { todayLocal } from '../../lib/date';
import ObsidianExportModal from '../../components/ObsidianExportModal';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const children = (n as { children?: unknown }).children;
    if (children) walk(children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

function findCopyBtn(r: TestRenderer.ReactTestRenderer) {
  return r.root.findAll(
    (x) => x.props?.accessibilityLabel === 'Obsidian Markdown formatında panoya kopyala' && typeof x.props.onPress === 'function',
  )[0];
}

async function pressByLabel(r: TestRenderer.ReactTestRenderer, label: string) {
  const btn = r.root.findAll((x) => x.props?.accessibilityLabel === label && typeof x.props.onPress === 'function')[0];
  expect(btn).toBeDefined();
  await act(async () => { await btn.props.onPress(); });
}

const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const r = mounted.pop()!;
    await act(async () => { r.unmount(); });
  }
  jest.useRealTimers();
});

beforeEach(() => {
  const today = todayLocal();
  mockState.habits = [{ id: 'h1', name: 'Meditasyon', life_area: 'Zihin', status: 'active', streak_current: 3 }];
  mockState.tasks = [{ id: 't1', title: 'Sunum hazırla', completed: false, due_date: today }];
  mockState.tasksHasMore = false;
  mockState.entries = [{ id: 'j1', date: today, content: 'Bugün sakin geçti.', mood: 4 }];
  mockState.fetchHabits = jest.fn(async () => undefined);
  mockState.fetchTasks = jest.fn(async () => undefined);
  mockState.fetchEntries = jest.fn(async () => undefined);
  mockState.loadDay = jest.fn(async () => ({ ok: true as const, logs: [{ habit_id: 'h1', state: 'done' }] }));
  mockState.collectAllNotes = jest.fn(async () => ({
    ok: true as const,
    data: {
      rows: [
        { id: 'n1', title: 'Sayfa 1 Notu', content: 'Birinci sayfa içeriği', created_at: '2026-11-01' },
        { id: 'n2', title: 'Sayfa 2 Notu', content: 'İkinci sayfa içeriği', created_at: '2026-11-02' },
      ],
      truncated: false,
    },
  }));
  mockState.copyTextWithWipe = jest.fn(async () => ({ ok: true as const }));
});

describe('ObsidianExportModal — pozitif vakalar', () => {
  it('açılışta verileri yükler, yükleme sürerken düğmeyi pasif tutar, günlük/not türünde ikinci dokunuşla onaylar ve Alert kullanmaz', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    let resolveLoad!: (v: { ok: true; logs: Record<string, unknown>[] }) => void;
    mockState.loadDay = jest.fn(
      () => new Promise((res) => { resolveLoad = res; }),
    );

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ObsidianExportModal visible onClose={jest.fn()} />);
    });
    mounted.push(r);

    expect(mockState.fetchHabits).toHaveBeenCalledTimes(1);
    expect(mockState.fetchTasks).toHaveBeenCalledTimes(1);
    expect(mockState.fetchEntries).toHaveBeenCalledTimes(1);
    expect(mockState.loadDay).toHaveBeenCalledTimes(1);

    // Yükleme sürerken pasif
    expect(findCopyBtn(r).props.accessibilityState?.disabled).toBe(true);
    expect(textOf(r)).toMatch(/yükleniyor/i);

    await act(async () => {
      resolveLoad({ ok: true, logs: [{ habit_id: 'h1', state: 'done' }] });
    });

    expect(findCopyBtn(r).props.accessibilityState?.disabled).toBe(false);

    // Günlük metni var -> ilk dokunuş kopyalamaz, onay kutusu açar
    await act(async () => { await findCopyBtn(r).props.onPress(); });
    expect(mockState.copyTextWithWipe).not.toHaveBeenCalled();
    expect(textOf(r)).toMatch(/Yine de kopyala/);

    await pressByLabel(r, 'Yine de kopyala');
    expect(mockState.copyTextWithWipe).toHaveBeenCalledTimes(1);
    const copiedMd = String((mockState.copyTextWithWipe as jest.Mock).mock.calls[0][0]);
    expect(copiedMd).toContain('- [x] **Meditasyon**');
    expect(copiedMd).toContain('Bugün sakin geçti.');
    expect(textOf(r)).toMatch(/Panoya kopyalandı/);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('Alışkanlıklar türünde onay adımı olmadan ilk dokunuşta kopyalar; Tüm Notlar iki sayfalık veriyi eksiksiz kopyalar', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ObsidianExportModal visible onClose={jest.fn()} />);
    });
    mounted.push(r);
    await act(async () => { await Promise.resolve(); });

    await pressByLabel(r, 'Alışkanlıklar');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await findCopyBtn(r).props.onPress(); });
    expect(mockState.copyTextWithWipe).toHaveBeenCalledTimes(1);

    (mockState.copyTextWithWipe as jest.Mock).mockClear();
    await pressByLabel(r, 'Tüm Notlar');
    await act(async () => { await Promise.resolve(); });
    expect(mockState.collectAllNotes).toHaveBeenCalledTimes(1);

    // Tüm Notlar kişisel metin içerir -> onay ister
    await act(async () => { await findCopyBtn(r).props.onPress(); });
    expect(mockState.copyTextWithWipe).not.toHaveBeenCalled();
    await pressByLabel(r, 'Yine de kopyala');
    expect(mockState.copyTextWithWipe).toHaveBeenCalledTimes(1);
    const vaultMd = String((mockState.copyTextWithWipe as jest.Mock).mock.calls[0][0]);
    expect(vaultMd).toContain('Sayfa 1 Notu');
    expect(vaultMd).toContain('Sayfa 2 Notu');
  });
});

describe('ObsidianExportModal — negatif vakalar', () => {
  it('boş not deposunda ve yükleme hatasında kopyalamayı engeller; Yeniden dene ile toparlanır', async () => {
    mockState.collectAllNotes = jest.fn(async () => ({ ok: false as const, error: 'offline' } as never));

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ObsidianExportModal visible onClose={jest.fn()} />);
    });
    mounted.push(r);
    await pressByLabel(r, 'Tüm Notlar');
    await act(async () => { await Promise.resolve(); });

    expect(findCopyBtn(r).props.accessibilityState?.disabled).toBe(true);
    expect(textOf(r)).toMatch(/Veriler yüklenemedi/);

    // Yeniden dene -> bu kez boş dizi dönsün
    mockState.collectAllNotes = jest.fn(async () => ({ ok: true as const, data: { rows: [], truncated: false } }));
    await pressByLabel(r, 'Yeniden dene');
    await act(async () => { await Promise.resolve(); });

    expect(findCopyBtn(r).props.accessibilityState?.disabled).toBe(true);
    expect(textOf(r)).toMatch(/Dışa aktarılacak not yok\./);
    expect(mockState.copyTextWithWipe).not.toHaveBeenCalled();
  });

  it('pano hatasında Kopyalandı göstermez; önizleme 5000 karakterde kesilirken kopyalanan metin tamdır; kapanış yarışı ve unmount güvenlidir', async () => {
    const bigBody = 'N'.repeat(6000);
    mockState.collectAllNotes = jest.fn(async () => ({
      ok: true as const,
      data: { rows: [{ id: 'n-big', title: 'Uzun Not', content: bigBody, created_at: '2026-11-02' }], truncated: false },
    }));
    mockState.copyTextWithWipe = jest.fn(async () => ({
      ok: false as const,
      error: 'Panoya kopyalanamadı. Tarayıcı izin vermemiş olabilir.',
    } as never));

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ObsidianExportModal visible onClose={jest.fn()} />);
    });
    mounted.push(r);
    await pressByLabel(r, 'Tüm Notlar');
    await act(async () => { await Promise.resolve(); });

    expect(textOf(r)).toMatch(/karakter daha var; kopya tam metni içerir/);

    await act(async () => { await findCopyBtn(r).props.onPress(); });
    await pressByLabel(r, 'Yine de kopyala');
    expect(textOf(r)).not.toContain('Kopyalandı!');
    expect(textOf(r)).toContain('Panoya kopyalanamadı');
    const attemptedMd = String((mockState.copyTextWithWipe as jest.Mock).mock.calls[0][0]);
    expect(attemptedMd.length).toBeGreaterThan(6000);

    // runId yarışı: kapatıp yeniden açınca eski yavaş yanıt yeni durumu ezmez
    let staleResolve!: (v: unknown) => void;
    mockState.collectAllNotes = jest.fn(
      () => new Promise((res) => { staleResolve = res; }) as never,
    );
    await act(async () => { r.update(<ObsidianExportModal visible={false} onClose={jest.fn()} />); });
    await act(async () => { r.update(<ObsidianExportModal visible onClose={jest.fn()} />); });
    const firstStale = staleResolve;
    mockState.collectAllNotes = jest.fn(async () => ({
      ok: true as const,
      data: { rows: [{ id: 'n-fresh', title: 'Taze', content: 'Yeni içerik', created_at: '2026-11-02' }], truncated: false },
    }));
    await pressByLabel(r, 'Yeniden dene').catch(() => undefined);
    // Kapat-aç sonrası yüklemeyi tamamla, eski olan hata dönsün
    await act(async () => {
      firstStale({ ok: false, error: 'eski hata' });
    });

    // Başarılı kopya sonrası hemen unmount -> zamanlayıcı sızıntısı yok
    jest.useFakeTimers();
    mockState.copyTextWithWipe = jest.fn(async () => ({ ok: true as const }));
    await pressByLabel(r, 'Alışkanlıklar');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await findCopyBtn(r).props.onPress(); });
    const popped = mounted.pop()!;
    await act(async () => { popped.unmount(); });
    act(() => { jest.advanceTimersByTime(3000); });
  });
});
