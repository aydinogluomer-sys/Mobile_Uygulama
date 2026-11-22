import {
  SMART_LISTS,
  dueDay,
  filterSmartList,
  isQuickTask,
  type SmartTaskLike,
} from '../../lib/smartTaskLists';

const TODAY = '2026-11-04';

function makeTask(overrides: Partial<SmartTaskLike> & { id: string; title: string }): SmartTaskLike {
  return {
    description: null,
    due_date: null,
    priority: 'none',
    completed: false,
    status: 'pending',
    ...overrides,
  };
}

describe('SMART_LISTS metadata & calm-tech copy', () => {
  it('exposes today, waiting, quick in order with zero "gecikmiş" shame copy', () => {
    expect(SMART_LISTS.map((l) => l.key)).toEqual(['today', 'waiting', 'quick']);
    for (const def of SMART_LISTS) {
      expect(`${def.label} ${def.hint} ${def.empty}`.toLowerCase()).not.toContain('gecikmiş');
      expect(`${def.label} ${def.hint} ${def.empty}`.toLowerCase()).not.toContain('gecikmis');
    }
  });

  it('dueDay extracts YYYY-MM-DD cleanly from both date strings and timestamptz echoes', () => {
    expect(dueDay('2026-11-04')).toBe('2026-11-04');
    expect(dueDay('2026-11-04T00:00:00+00:00')).toBe('2026-11-04');
    expect(dueDay(null)).toBe('');
    expect(dueDay(undefined)).toBe('');
    expect(dueDay('bozuk')).toBe('');
  });
});

describe('isQuickTask (positive & negative)', () => {
  it('(+) recognizes 1–5 minute tasks in title, description, or estimated_minutes', () => {
    expect(isQuickTask({ title: '5 dk su iç' })).toBe(true);
    expect(isQuickTask({ title: '5dk masa topla' })).toBe(true);
    expect(isQuickTask({ title: '5 dakikalık oku' })).toBe(true);
    expect(isQuickTask({ title: '1 dakika nefes' })).toBe(true);
    expect(
      isQuickTask({
        title: 'Gerekenleri tek bir yere topla — Rapor',
        description: '2 dk · ilk adım · 25 dk blok (1/3)',
      }),
    ).toBe(true);
    expect(isQuickTask({ title: 'Su iç', estimated_minutes: 5 })).toBe(true);
  });

  it('(-) rejects >5 minute durations, 0 minutes, decimals, non-minute units, and bare words', () => {
    expect(isQuickTask({ title: '15 dk yürüyüş' })).toBe(false);
    expect(isQuickTask({ title: '50 dk ders' })).toBe(false);
    expect(isQuickTask({ title: '8 dk kontrol' })).toBe(false);
    expect(isQuickTask({ title: '0 dk boş' })).toBe(false);
    expect(isQuickTask({ title: '2.5 dk deneme' })).toBe(false);
    expect(isQuickTask({ title: 'Taslağı çıkar', description: '25 dk blok (2/3)' })).toBe(false);
    expect(isQuickTask({ title: '5 gün bekle' })).toBe(false);
    expect(isQuickTask({ title: 'dakika tut' })).toBe(false);
    expect(isQuickTask({ title: 'Derin çalışma', estimated_minutes: 25 })).toBe(false);
  });
});

describe('filterSmartList — today, waiting, quick', () => {
  const sample: readonly SmartTaskLike[] = [
    makeTask({ id: 't-today-low', title: 'Bugün düşük', due_date: '2026-11-04', priority: 'low' }),
    makeTask({ id: 't-today-iso', title: 'Bugün timestamptz', due_date: '2026-11-04T00:00:00+00:00', priority: 'high' }),
    makeTask({ id: 't-tomorrow', title: 'Yarın', due_date: '2026-11-05', priority: 'high' }),
    makeTask({ id: 't-wait-old', title: 'Eski bekleyen', due_date: '2026-11-01', priority: 'medium' }),
    makeTask({ id: 't-wait-new', title: 'Yeni bekleyen', due_date: '2026-11-03T00:00:00+00:00', priority: 'medium' }),
    makeTask({ id: 't-wait-high', title: 'Acil bekleyen', due_date: '2026-10-28', priority: 'high' }),
    makeTask({ id: 't-unscheduled', title: 'Tarihsiz 5 dk not', priority: 'none' }),
    makeTask({ id: 't-done', title: '5 dk bitmiş', due_date: '2026-11-03', completed: true, status: 'completed' }),
    makeTask({ id: 't-cancelled', title: '5 dk iptal', due_date: '2026-11-04', status: 'cancelled' }),
  ];

  it('filters "today" to open tasks matching today (including timestamptz) sorted by priority', () => {
    const out = filterSmartList('today', sample, TODAY);
    expect(out.map((t) => t.id)).toEqual(['t-today-iso', 't-today-low']);
  });

  it('filters "waiting" strictly to dueDay < today (excluding today, completed, cancelled) sorted by priority then newest date first', () => {
    const out = filterSmartList('waiting', sample, TODAY);
    expect(out.map((t) => t.id)).toEqual(['t-wait-high', 't-wait-new', 't-wait-old']);
  });

  it('filters "quick" to open 1–5 min tasks without mutating the input array', () => {
    const snapshot = sample.map((t) => ({ ...t }));
    const out = filterSmartList('quick', sample, TODAY);
    expect(out.map((t) => t.id)).toEqual(['t-unscheduled']);
    expect(sample).toEqual(snapshot);
    expect(filterSmartList('quick', [], TODAY)).toEqual([]);
  });
});
