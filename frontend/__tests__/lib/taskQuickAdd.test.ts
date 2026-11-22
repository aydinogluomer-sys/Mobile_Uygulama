import {
  foldTr,
  formatChipDate,
  formatTimeBlock,
  parseQuickAdd,
  quickAddToTaskInput,
  type QuickAddContext,
  type QuickAddProject,
} from '../../lib/taskQuickAdd';
import { ymd } from '../../lib/date';

// Fixed reference clock: 2026-11-04 Wednesday 10:00 local
const NOW = new Date(2026, 10, 4, 10, 0, 0, 0);
const TODAY = '2026-11-04';

const PROJECTS: readonly QuickAddProject[] = [
  { id: 'p1', name: 'Sağlık' },
  { id: 'p2', name: 'Ev Düzeni' },
  { id: 'p3', name: 'Spor' },
];

const CTX: QuickAddContext = { now: NOW, projects: PROJECTS };

describe('foldTr & pure formatting helpers', () => {
  it('folds Turkish dotted/dotless I and diacritics deterministically without ICU drift', () => {
    expect(foldTr('İSTANBUL ISIK Çarşamba')).toBe('istanbul isik carsamba');
    expect(foldTr('ĞÜŞİÖÇ ğüşiöç ıI')).toBe('gusioc gusioc ii');
  });

  it('formatTimeBlock pads valid 24h times and returns null for invalid hours/minutes', () => {
    expect(formatTimeBlock(9, 5)).toBe('09:05');
    expect(formatTimeBlock(0, 0)).toBe('00:00');
    expect(formatTimeBlock(23, 59)).toBe('23:59');
    expect(formatTimeBlock(24, 0)).toBeNull();
    expect(formatTimeBlock(25, 0)).toBeNull();
    expect(formatTimeBlock(-1, 0)).toBeNull();
    expect(formatTimeBlock(12, 60)).toBeNull();
    expect(formatTimeBlock(12, -5)).toBeNull();
    expect(formatTimeBlock(12.5, 0)).toBeNull();
  });

  it('formatChipDate renders Bugün, Yarın, and Intl-free Turkish weekday+month labels', () => {
    expect(formatChipDate('2026-11-04', TODAY)).toBe('Bugün');
    expect(formatChipDate('2026-11-05', TODAY)).toBe('Yarın');
    expect(formatChipDate('2026-11-06', TODAY)).toBe('Cum 6 Kas');
    expect(formatChipDate('2026-11-10', TODAY)).toBe('Sal 10 Kas');
  });
});

describe('parseQuickAdd — Turkish dates (positive & negative)', () => {
  it('parses bugün, yarın, öbür gün, weekdays, dative suffixes, haftaya, N gün sonra, and DD Ay', () => {
    const r1 = parseQuickAdd('yarın marketten süt al', CTX);
    expect(r1.title).toBe('marketten süt al');
    expect(r1.fields.dueDate).toBe('2026-11-05');
    expect(r1.tokens[0]?.label).toBe('Yarın');

    expect(parseQuickAdd('bugün fatura kontrol', CTX).fields.dueDate).toBe('2026-11-04');
    expect(parseQuickAdd('öbür gün kargo ver', CTX)).toMatchObject({
      title: 'kargo ver',
      fields: { dueDate: '2026-11-06' },
    });
    expect(parseQuickAdd('cuma rapor teslim', CTX).fields.dueDate).toBe('2026-11-06');
    expect(parseQuickAdd('salıya rapor', CTX)).toMatchObject({
      title: 'rapor',
      fields: { dueDate: '2026-11-10' },
    });
    // Wednesday on a Wednesday -> next Wednesday (+7, never +0)
    expect(parseQuickAdd('çarşamba toplantı', CTX).fields.dueDate).toBe('2026-11-11');
    expect(parseQuickAdd('haftaya kontrol', CTX).fields.dueDate).toBe('2026-11-11');
    // Plain "cuma" is 2026-11-06, whereas "haftaya cuma" is next calendar week's Friday (2026-11-13)
    expect(parseQuickAdd('haftaya cuma sunum', CTX).fields.dueDate).toBe('2026-11-13');
    expect(parseQuickAdd('haftaya salı görüşme', CTX).fields.dueDate).toBe('2026-11-10');
    expect(parseQuickAdd('pazar günü kahvaltı', CTX)).toMatchObject({
      title: 'kahvaltı',
      fields: { dueDate: '2026-11-08' },
    });
    expect(parseQuickAdd('haftaya pazar yürüyüş', CTX)).toMatchObject({
      title: 'yürüyüş',
      fields: { dueDate: '2026-11-15' },
    });
    expect(parseQuickAdd('3 gün sonra dişçi', CTX)).toMatchObject({
      title: 'dişçi',
      fields: { dueDate: '2026-11-07' },
    });
    expect(parseQuickAdd('15 Kasım kira', CTX)).toMatchObject({
      title: 'kira',
      fields: { dueDate: '2026-11-15' },
    });
    expect(parseQuickAdd('12 Mart vergi', CTX)).toMatchObject({
      title: 'vergi',
      fields: { dueDate: '2027-03-12' },
    });
  });

  it('is case- and diacritic-insensitive and handles year-end, leap-day, and DST boundaries', () => {
    expect(parseQuickAdd('YARIN süt al', CTX).fields.dueDate).toBe('2026-11-05');
    expect(parseQuickAdd('Yarın süt al', CTX).fields.dueDate).toBe('2026-11-05');
    expect(parseQuickAdd('yarin süt al', CTX).fields.dueDate).toBe('2026-11-05');
    expect(parseQuickAdd('ÇARŞAMBA kontrol', CTX).fields.dueDate).toBe('2026-11-11');

    // Year end rollover
    const dec31 = new Date(2026, 11, 31, 23, 30, 0, 0);
    expect(parseQuickAdd('yarın kutlama', { now: dec31, projects: [] }).fields.dueDate).toBe('2027-01-01');

    // Leap day
    const feb28Leap = new Date(2028, 1, 28, 0, 30, 0, 0);
    expect(parseQuickAdd('yarın kontrol', { now: feb28Leap, projects: [] }).fields.dueDate).toBe('2028-02-29');

    // Near local midnight (00:15 and 23:45) — must never drift via UTC toISOString()
    const earlyLocal = new Date(2026, 2, 29, 0, 15, 0, 0);
    const lateLocal = new Date(2026, 10, 1, 23, 45, 0, 0);
    expect(ymd(earlyLocal)).toBe('2026-03-29');
    expect(parseQuickAdd('yarın yürüyüş', { now: earlyLocal, projects: [] }).fields.dueDate).toBe('2026-03-30');
    expect(parseQuickAdd('yarın yürüyüş', { now: lateLocal, projects: [] }).fields.dueDate).toBe('2026-11-02');
  });

  it('(-) rejects bare pazar/pazara, derived words like yarınki, invalid calendar days, and keeps second date in title', () => {
    const rPazar = parseQuickAdd('pazara git', CTX);
    expect(rPazar).toEqual({ title: 'pazara git', fields: {}, tokens: [] });

    const rPazarBare = parseQuickAdd('pazar alışverişi', CTX);
    expect(rPazarBare).toEqual({ title: 'pazar alışverişi', fields: {}, tokens: [] });

    const rDerived = parseQuickAdd('yarınki toplantı', CTX);
    expect(rDerived).toEqual({ title: 'yarınki toplantı', fields: {}, tokens: [] });

    const rInvalidDay = parseQuickAdd('31 Şubat kontrol', CTX);
    expect(rInvalidDay).toEqual({ title: '31 Şubat kontrol', fields: {}, tokens: [] });

    const rTwoDates = parseQuickAdd('yarın cuma doktor', CTX);
    expect(rTwoDates.fields.dueDate).toBe('2026-11-05');
    expect(rTwoDates.title).toBe('cuma doktor');
    expect(rTwoDates.tokens).toHaveLength(1);
  });
});

describe('parseQuickAdd — times, ranges, and durations (positive & negative)', () => {
  it('parses HH:mm, H:mm, saat H, saat H.mm, suffixes, time ranges, and durations', () => {
    expect(parseQuickAdd('15:00 toplantı', CTX)).toMatchObject({
      title: 'toplantı',
      fields: { time: '15:00' },
    });
    expect(parseQuickAdd('9:05 ilaç', CTX).fields.time).toBe('09:05');
    expect(parseQuickAdd('saat 9 kahve', CTX)).toMatchObject({
      title: 'kahve',
      fields: { time: '09:00' },
    });
    expect(parseQuickAdd('saat 9.30 ders', CTX)).toMatchObject({
      title: 'ders',
      fields: { time: '09:30' },
    });
    expect(parseQuickAdd("15:00'te sunum", CTX)).toMatchObject({
      title: 'sunum',
      fields: { time: '15:00' },
    });
    expect(parseQuickAdd('14:00-15:00 derin çalışma', CTX)).toMatchObject({
      title: 'derin çalışma',
      fields: { time: '14:00', timeEnd: '15:00' },
    });
    expect(parseQuickAdd('25dk kitap oku', CTX)).toMatchObject({
      title: 'kitap oku',
      fields: { durationMinutes: 25 },
    });
    expect(parseQuickAdd('1 saat yürüyüş', CTX)).toMatchObject({
      title: 'yürüyüş',
      fields: { durationMinutes: 60 },
    });
  });

  it('(-) rejects out-of-range times and decimal prices; time without date does not set fields.dueDate directly', () => {
    expect(parseQuickAdd('25:00 toplantı', CTX)).toEqual({ title: '25:00 toplantı', fields: {}, tokens: [] });
    expect(parseQuickAdd('12:60 toplantı', CTX)).toEqual({ title: '12:60 toplantı', fields: {}, tokens: [] });
    expect(parseQuickAdd('3.50 elma', CTX)).toEqual({ title: '3.50 elma', fields: {}, tokens: [] });
    expect(parseQuickAdd('market 3.50 tl', CTX)).toEqual({ title: 'market 3.50 tl', fields: {}, tokens: [] });

    const onlyTime = parseQuickAdd('15:00 arama yap', CTX);
    expect(onlyTime.fields.dueDate).toBeUndefined();
    expect(onlyTime.fields.time).toBe('15:00');
  });
});

describe('parseQuickAdd — priorities and projects (positive & negative)', () => {
  it('parses Turkish priority markers and !1/!2/!3 aliases while rejecting bare words or unknown bangs', () => {
    expect(parseQuickAdd('fatura öde !yüksek', CTX).fields.priority).toBe('high');
    expect(parseQuickAdd('fatura öde !YÜKSEK', CTX).fields.priority).toBe('high');
    expect(parseQuickAdd('fatura öde !acil', CTX).fields.priority).toBe('high');
    expect(parseQuickAdd('fatura öde !1', CTX).fields.priority).toBe('high');
    expect(parseQuickAdd('rapor !orta', CTX).fields.priority).toBe('medium');
    expect(parseQuickAdd('rapor !2', CTX).fields.priority).toBe('medium');
    expect(parseQuickAdd('not bak !düşük', CTX).fields.priority).toBe('low');
    expect(parseQuickAdd('not bak !dusuk', CTX).fields.priority).toBe('low');
    expect(parseQuickAdd('not bak !3', CTX).fields.priority).toBe('low');

    expect(parseQuickAdd('fatura !çok', CTX)).toEqual({ title: 'fatura !çok', fields: {}, tokens: [] });
    expect(parseQuickAdd('fatura !!', CTX)).toEqual({ title: 'fatura !!', fields: {}, tokens: [] });
    expect(parseQuickAdd('yüksek tavan boya', CTX)).toEqual({ title: 'yüksek tavan boya', fields: {}, tokens: [] });
  });

  it('matches active projects by folded exact slug or unique >=2-char prefix, leaving unknown/ambiguous tags in title', () => {
    expect(parseQuickAdd('kontrol #sağlık', CTX)).toMatchObject({
      title: 'kontrol',
      fields: { projectId: 'p1' },
    });
    expect(parseQuickAdd('kontrol #SAGLIK', CTX).fields.projectId).toBe('p1');
    expect(parseQuickAdd('mutfak #evduzeni', CTX).fields.projectId).toBe('p2');
    expect(parseQuickAdd('mutfak #ev', CTX).fields.projectId).toBe('p2');

    // Unknown tag stays in title
    expect(parseQuickAdd('kontrol #bilinmeyen', CTX)).toEqual({
      title: 'kontrol #bilinmeyen',
      fields: {},
      tokens: [],
    });
    // Single-char prefix (#s matches Sağlık and Spor, and < 2 chars) stays in title
    expect(parseQuickAdd('kontrol #s', CTX)).toEqual({
      title: 'kontrol #s',
      fields: {},
      tokens: [],
    });
  });
});

describe('parseQuickAdd — combined tokens, spans, dismissal, empty-title fallback, purity, and quickAddToTaskInput', () => {
  it('parses all four token kinds together with exact UTF-16 [start, end) spans', () => {
    const input = 'Cuma 15:00 doktora git !yüksek #sağlık';
    const res = parseQuickAdd(input, CTX);
    expect(res.title).toBe('doktora git');
    expect(res.fields).toEqual({
      dueDate: '2026-11-06',
      time: '15:00',
      priority: 'high',
      projectId: 'p1',
    });
    expect(res.tokens).toHaveLength(4);
    for (const tok of res.tokens) {
      expect(input.slice(tok.start, tok.end)).toBe(tok.source);
    }
  });

  it('dismissed token keys keep the user word in title while leaving other chips intact', () => {
    const input = 'yarın 15:00 süt al !yüksek';
    const first = parseQuickAdd(input, CTX);
    const dateKey = first.tokens.find((t) => t.kind === 'date')!.key;

    const afterDismiss = parseQuickAdd(input, CTX, new Set([dateKey]));
    expect(afterDismiss.fields.dueDate).toBeUndefined();
    expect(afterDismiss.fields.time).toBe('15:00');
    expect(afterDismiss.fields.priority).toBe('high');
    expect(afterDismiss.title).toBe('yarın süt al');
  });

  it('falls back to full raw input with zero fields when extracted tokens would empty the title', () => {
    expect(parseQuickAdd('yarın', CTX)).toEqual({ title: 'yarın', fields: {}, tokens: [] });
    expect(parseQuickAdd('yarın !yüksek', CTX)).toEqual({ title: 'yarın !yüksek', fields: {}, tokens: [] });
  });

  it('is pure: deterministic across calls and never mutates ctx.projects', () => {
    const frozenProjects = Object.freeze(PROJECTS.map((p) => Object.freeze({ ...p })));
    const a = parseQuickAdd('yarın #sağlık koşu', { now: new Date(NOW.getTime()), projects: frozenProjects });
    const b = parseQuickAdd('yarın #sağlık koşu', { now: new Date(NOW.getTime()), projects: frozenProjects });
    expect(a).toEqual(b);
  });

  it('quickAddToTaskInput prioritizes chips over caller defaults and assigns due_date=today when time has no date', () => {
    const defaults = {
      priority: 'low' as const,
      list_type: 'this_week' as const,
      due_date: null,
      project_id: 'default-proj',
    };

    // Time without date -> due_date becomes today
    expect(quickAddToTaskInput('arama yap', { time: '15:00' }, defaults, TODAY)).toEqual({
      title: 'arama yap',
      priority: 'low',
      list_type: 'this_week',
      due_date: TODAY,
      project_id: 'default-proj',
      time_block_start: '15:00',
    });

    // Chips override caller defaults
    expect(
      quickAddToTaskInput(
        'doktora git',
        { dueDate: '2026-11-06', priority: 'high', projectId: 'p1' },
        defaults,
        TODAY,
      ),
    ).toEqual({
      title: 'doktora git',
      priority: 'high',
      list_type: 'this_week',
      due_date: '2026-11-06',
      project_id: 'p1',
      time_block_start: null,
    });
  });
});
