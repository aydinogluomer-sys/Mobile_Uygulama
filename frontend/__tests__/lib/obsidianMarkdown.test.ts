/**
 * F20 (GAP1-02, GAP1-06, GAP1-09, GAP1-16) — saf Obsidian Markdown üreticileri.
 */
import {
  MD_MAX_PENDING_TASKS,
  MD_PREVIEW_CHARS,
  buildDailyNote,
  buildHabitsCatalog,
  buildNotesVault,
  containsPersonalText,
  escapeMdCell,
  escapeMdInline,
  isMarkdownEmpty,
  previewOf,
  type MdHabit,
  type MdTask,
} from '../../lib/obsidianMarkdown';

describe('buildDailyNote, buildHabitsCatalog ve buildNotesVault — pozitif vakalar', () => {
  it('alışkanlık işaretlerini todayLogs durumlarından (done, partial, diğer) üretir', () => {
    const habits: MdHabit[] = [
      { id: 'h1', name: 'Su İç', streak_current: 4 },
      { id: 'h2', name: 'Kitap', streak_current: 2 },
      { id: 'h3', name: 'Yürüyüş', streak_current: 0 },
    ];
    const md = buildDailyNote({
      today: '2026-11-02',
      habits,
      todayLogs: [
        { habit_id: 'h1', state: 'done' },
        { habit_id: 'h2', state: 'partial' },
      ],
      tasks: [],
      tasksComplete: true,
      journal: null,
    });

    expect(md).toContain('- [x] **Su İç** 🔥 4 gün');
    expect(md).toContain('- [/] **Kitap** 🔥 2 gün');
    expect(md).toContain('- [ ] **Yürüyüş**');
  });

  it('Europe/Istanbul saat diliminde gece yarısı sonrası tamamlanan görevi doğru yerel güne koyar', () => {
    // 2026-11-01T22:30:00.000Z -> UTC+3'te 2026-11-02 01:30
    const md = buildDailyNote({
      today: '2026-11-02',
      habits: [],
      todayLogs: [],
      tasks: [
        { id: 't1', title: 'Gece Raporu', completed: true, completed_at: '2026-11-01T22:30:00.000Z' },
      ],
      tasksComplete: true,
      journal: null,
    });
    expect(md).toContain('- [x] Gece Raporu');
  });

  it('alışkanlık adındaki | karakterini katalog tablosunda kaçışlar ve hücre sayısını bozmaz', () => {
    expect(escapeMdCell('Su | Maden\nSuyu')).toBe('Su \\| Maden Suyu');
    expect(escapeMdInline('A*B_C')).toBe('A\\*B\\_C');
    const catalog = buildHabitsCatalog({
      nowIso: '2026-11-02T10:00:00.000Z',
      habits: [{ id: 'h1', name: 'Su | Maden', life_area: 'Sağlık | Spor', status: 'active', streak_current: 5 }],
    });
    const tableRow = catalog.split('\n').find((l) => l.includes('Su \\| Maden'))!;
    expect(tableRow).toBeDefined();
    // Kaçışsız | sayısı tam 5 olmalı (| c1 | c2 | c3 | c4 |)
    expect(tableRow.replace(/\\\|/g, '').match(/\|/g)).toHaveLength(5);
  });

  it('bekleyen görevleri due_date <= today ile sınırlar, en çok 10 satır ve +N görev daha yazar; eksik yükleme notlarını ekler', () => {
    const overdueTasks: MdTask[] = Array.from({ length: 14 }, (_, i) => ({
      id: `t-${i}`,
      title: `Görev ${i + 1}`,
      completed: false,
      due_date: '2026-11-01',
    }));

    const md = buildDailyNote({
      today: '2026-11-02',
      habits: [],
      todayLogs: [],
      tasks: overdueTasks,
      tasksComplete: false,
      journal: null,
    });

    const pendingLines = md.split('\n').filter((l) => l.startsWith('- [ ] '));
    expect(pendingLines).toHaveLength(MD_MAX_PENDING_TASKS);
    expect(md).toContain('*+4 görev daha*');
    expect(md).toContain('*Not: görev listesi tam yüklenmedi; ilk görevler gösteriliyor.*');

    const vault = buildNotesVault({
      today: '2026-11-02',
      notes: [{ id: 'n1', title: 'Not 1', content: 'Gövde', created_at: '2026-11-01T10:00:00Z' }],
      complete: false,
    });
    expect(vault).toContain('*Not: bazı notlar yüklenemedi; bu dosya eksik.*');
  });

  it('previewOf 5000 karakterde keser ve kalan karakter sayısını doğru döner', () => {
    const longText = 'a'.repeat(MD_PREVIEW_CHARS + 320);
    const p = previewOf(longText);
    expect(p.text).toHaveLength(MD_PREVIEW_CHARS);
    expect(p.hiddenChars).toBe(320);
    expect(previewOf('kısa')).toEqual({ text: 'kısa', hiddenChars: 0 });
  });
});

describe('Obsidian Markdown — negatif vakalar', () => {
  it('due_date yarın olan bekleyen görevi ve başka güne ait tamamlanmış görevi günlük nota dahil etmez', () => {
    const md = buildDailyNote({
      today: '2026-11-02',
      habits: [],
      todayLogs: [],
      tasks: [
        { id: 't-tomorrow', title: 'Yarının Görevi', completed: false, due_date: '2026-11-03' },
        { id: 't-old-done', title: 'Eski Tamamlanan', completed: true, completed_at: '2026-10-30T10:00:00.000Z' },
      ],
      tasksComplete: true,
      journal: null,
    });

    expect(md).not.toContain('Yarının Görevi');
    expect(md).not.toContain('Eski Tamamlanan');
    expect(md).toContain('*Bugün için kayıtlı görev yok.*');
  });

  it('not ve günlük gövdelerindeki | ve * karakterlerini kaçışlamaz; boşluk ve kişisel metin kontrolleri doğrudur', () => {
    const body = 'Tablo | satırı ve *vurgu* ile [[bağlantı]]';
    const daily = buildDailyNote({
      today: '2026-11-02',
      habits: [],
      todayLogs: [],
      tasks: [],
      tasksComplete: true,
      journal: { date: '2026-11-02', content: body, mood: 4 },
    });
    expect(daily).toContain(body);

    const vault = buildNotesVault({
      today: '2026-11-02',
      notes: [{ id: 'n1', title: 'Başlık', content: body, created_at: '2026-11-02' }],
      complete: true,
    });
    expect(vault).toContain(body);

    expect(isMarkdownEmpty('notes_vault', { habits: [], notes: [] })).toBe(true);
    expect(isMarkdownEmpty('all_habits', { habits: [], notes: [] })).toBe(true);
    expect(isMarkdownEmpty('daily', { habits: [], notes: [] })).toBe(false);

    expect(containsPersonalText('all_habits', { journal: { date: '2026-11-02', content: 'x' }, notes: [] })).toBe(false);
    expect(containsPersonalText('daily', { journal: null, notes: [] })).toBe(false);
    expect(containsPersonalText('daily', { journal: { date: '2026-11-02', content: 'günlük' }, notes: [] })).toBe(true);
    expect(containsPersonalText('notes_vault', { journal: null, notes: [{ id: 'n1', content: 'not' }] })).toBe(true);
  });
});
