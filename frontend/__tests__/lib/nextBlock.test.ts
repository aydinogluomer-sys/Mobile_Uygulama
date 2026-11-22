/**
 * F36 — Saf, saat dilimi-bağımsız `lib/nextBlock.ts` birim testleri.
 * Tüm 4 IANA bölgesinde (`Europe/Istanbul`, `America/New_York`, `Pacific/Auckland`, `UTC`) deterministiktir.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import {
  CHIP_FAR_MINUTES,
  STRIP_BLOCK_MAX_PX,
  STRIP_BLOCK_MIN_PX,
  STRIP_NOW_GAP_PX,
  blockDayOf,
  blocksOn,
  layoutDayStrip,
  nextBlockChip,
  nextBlockInfo,
  parseBlockTime,
  type BlockTask,
} from '../../lib/nextBlock';
import { formatTimeBlock } from '../../lib/taskQuickAdd';
import { todayTaskDueLabel } from '../../lib/todaySelectors';

const makeTask = (over: Partial<BlockTask> = {}): BlockTask => ({
  id: 't1',
  title: 'Rapor yazma',
  due_date: '2026-11-02',
  time_block_start: '15:00',
  time_block_end: null,
  completed: false,
  status: 'pending',
  priority: 'none',
  ...over,
});

describe('F36 nextBlock — parseBlockTime & formatTimeBlock round-trip', () => {
  it('(+) parses H:mm, HH:mm, and HH:mm:ss valid wall-clock strings', () => {
    expect(parseBlockTime('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseBlockTime('9:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseBlockTime('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseBlockTime('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseBlockTime('15:00:30')).toEqual({ hour: 15, minute: 0 });
    expect(parseBlockTime(' 08:45 ')).toEqual({ hour: 8, minute: 45 });
  });

  it('(-) rejects invalid, out-of-range, 12h, dot-separated, and empty inputs', () => {
    for (const bad of [
      '24:00',
      '12:60',
      '15:00:60',
      '12.30',
      'abc',
      '',
      '   ',
      '1:5',
      '15:00 PM',
      '-1:00',
      null,
      undefined,
    ]) {
      expect(parseBlockTime(bad)).toBeNull();
    }
  });

  it('(+) round-trips every minute 0..1439 with F30 formatTimeBlock', () => {
    for (let total = 0; total < 1440; total += 1) {
      const h = Math.floor(total / 60);
      const m = total % 60;
      const formatted = formatTimeBlock(h, m);
      expect(formatted).not.toBeNull();
      expect(parseBlockTime(formatted)).toEqual({ hour: h, minute: m });
    }
  });

  it('(+) formats Today Sırada dueLabel as HH:mm for valid block start and falls back to bugün', () => {
    expect(todayTaskDueLabel('9:05')).toBe('09:05');
    expect(todayTaskDueLabel('15:30:00')).toBe('15:30');
    expect(todayTaskDueLabel(null)).toBe('bugün');
    expect(todayTaskDueLabel('25:00')).toBe('bugün');
  });
});

describe('F36 nextBlock — blockDayOf & blocksOn', () => {
  it('(+) extracts YYYY-MM-DD from date and timestamptz strings and rejects invalid dates', () => {
    expect(blockDayOf('2026-11-02T00:00:00+00:00')).toBe('2026-11-02');
    expect(blockDayOf('2026-11-02')).toBe('2026-11-02');
    expect(blockDayOf('2026-02-30')).toBe('');
    expect(blockDayOf('yarın')).toBe('');
    expect(blockDayOf('')).toBe('');
    expect(blockDayOf(null)).toBe('');
    expect(blockDayOf(undefined)).toBe('');
  });

  it('(-) excludes completed, cancelled, other-day, untimed, invalid-time, and due_date-less tasks without mutating input', () => {
    const input = Object.freeze([
      makeTask({ id: 'ok', title: 'Açık blok', due_date: '2026-11-02T00:00:00+00:00', time_block_start: '14:00' }),
      makeTask({ id: 'done', completed: true }),
      makeTask({ id: 'cancel', status: 'cancelled' }),
      makeTask({ id: 'other-day', due_date: '2026-11-03' }),
      makeTask({ id: 'no-time', time_block_start: null }),
      makeTask({ id: 'bad-time', time_block_start: '99:00' }),
      makeTask({ id: 'no-due', due_date: null, time_block_start: '14:00' }),
    ]);

    const res = blocksOn(input, '2026-11-02');
    expect(res.map((b) => b.id)).toEqual(['ok']);
    expect(res[0].start).toEqual(new Date(2026, 10, 2, 14, 0, 0, 0));
    expect(res[0].startLabel).toBe('14:00');
  });

  it('(+) sorts deterministically by start asc, priority rank, Turkish title, then id, and nulls invalid/reversed end', () => {
    const tasks: BlockTask[] = [
      makeTask({ id: 'b2', title: 'Şema incele', time_block_start: '10:00', priority: 'low' }),
      makeTask({ id: 'b1', title: 'Çizim yap', time_block_start: '10:00', priority: 'low' }),
      makeTask({ id: 'a1', title: 'Zor iş', time_block_start: '10:00', priority: 'high', time_block_end: '09:30' }),
      makeTask({ id: 'c2', title: 'Aynı', time_block_start: '10:00', priority: 'none' }),
      makeTask({ id: 'c1', title: 'Aynı', time_block_start: '10:00', priority: 'none', time_block_end: '10:00' }),
      makeTask({ id: 'early', title: 'Sabah', time_block_start: '08:30', time_block_end: '09:15' }),
      makeTask({ id: 'late', title: 'Gece', time_block_start: '23:30', time_block_end: '00:30' }),
    ];

    const res = blocksOn(tasks, '2026-11-02');
    expect(res.map((b) => b.id)).toEqual(['early', 'a1', 'b1', 'b2', 'c1', 'c2', 'late']);
    expect(res[0].end).toEqual(new Date(2026, 10, 2, 9, 15, 0, 0));
    expect(res[0].endLabel).toBe('09:15');
    // end <= start and midnight-crossing end become null
    expect(res.find((b) => b.id === 'a1')?.end).toBeNull();
    expect(res.find((b) => b.id === 'c1')?.end).toBeNull();
    expect(res.find((b) => b.id === 'late')?.end).toBeNull();
  });
});

describe('F36 nextBlock — nextBlockInfo & nextBlockChip', () => {
  it('(+) computes ceil minutesUntil from absolute instants, skips started/past/tomorrow blocks, and counts laterToday', () => {
    const tasks: BlockTask[] = [
      makeTask({ id: 'started', title: 'Şu anki', time_block_start: '14:00', time_block_end: '14:50' }),
      makeTask({ id: 'next', title: 'Rapor yazma', time_block_start: '15:00' }),
      makeTask({ id: 'later', title: 'Toplantı', time_block_start: '16:30' }),
      makeTask({ id: 'tomorrow', title: 'Yarınki', due_date: '2026-11-03', time_block_start: '09:00' }),
    ];

    const exact = nextBlockInfo(tasks, new Date(2026, 10, 2, 14, 35, 0, 0));
    expect(exact).not.toBeNull();
    expect(exact!.block.id).toBe('next');
    expect(exact!.minutesUntil).toBe(25);
    expect(exact!.laterToday).toBe(1);

    // M1 guard: 25m 30s remaining MUST round UP via Math.ceil to 26 (not floor to 25)
    const halfMin = nextBlockInfo(tasks, new Date(2026, 10, 2, 14, 34, 30, 0));
    expect(halfMin!.minutesUntil).toBe(26);

    // At 16:30:00 sharp, 16:30 block has started; tomorrow's block is ignored -> null
    expect(nextBlockInfo(tasks, new Date(2026, 10, 2, 16, 30, 0, 0))).toBeNull();
    expect(nextBlockInfo(tasks, new Date(2026, 10, 2, 18, 0, 0, 0))).toBeNull();
  });

  it('(+) uses absolute instant difference across spring-forward DST transition day (2026-03-08)', () => {
    const dstTask = makeTask({
      id: 'dst',
      due_date: '2026-03-08',
      time_block_start: '03:30',
    });
    const now = new Date(2026, 2, 8, 1, 50, 0, 0);
    const start = new Date(2026, 2, 8, 3, 30, 0, 0);
    const expected = Math.ceil((start.getTime() - now.getTime()) / 60_000);
    const info = nextBlockInfo([dstTask], now);
    expect(info).not.toBeNull();
    expect(info!.minutesUntil).toBe(expected);
  });

  it('(+) formats calm Turkish countdown and >=180m clock text with spoken a11y label', () => {
    const baseBlock = blocksOn([makeTask({ title: 'Rapor yazma', time_block_start: '15:00' })], '2026-11-02')[0];
    const chipAt = (minutesUntil: number) =>
      nextBlockChip({ block: baseBlock, minutesUntil, laterToday: 0 });

    expect(chipAt(0).text).toBe('Sıradaki blok birazdan');
    expect(chipAt(1).text).toBe('Sıradaki blok birazdan');
    expect(chipAt(1).a11y).toContain('Rapor yazma');
    expect(chipAt(1).a11y).toContain('dakika');

    const c25 = chipAt(25);
    expect(c25.text).toBe('Sıradaki blok 25 dk sonra');
    expect(c25.a11y).toBe('Sıradaki blok: Rapor yazma. 25 dakika sonra, başlangıç 15:00.');

    expect(chipAt(60).text).toBe('Sıradaki blok 1 sa sonra');
    expect(chipAt(70).text).toBe('Sıradaki blok 1 sa 10 dk sonra');
    expect(chipAt(179).text).toBe('Sıradaki blok 2 sa 59 dk sonra');
    expect(chipAt(CHIP_FAR_MINUTES).text).toBe('Sıradaki blok · 15:00');
  });
});

describe('F36 nextBlock — layoutDayStrip & purity', () => {
  it('(+) sizes blocks/gaps proportionally, omits overlap gaps, caps at 8 blocks, and places now accurately', () => {
    const blocks = blocksOn(
      [
        makeTask({ id: 'b1', title: 'Kısa', time_block_start: '09:00', time_block_end: '09:30' }),
        makeTask({ id: 'b2', title: 'Yakın', time_block_start: '09:45', time_block_end: '10:15' }),
        makeTask({ id: 'b3', title: 'Uzun', time_block_start: '11:00', time_block_end: '14:00' }),
        makeTask({ id: 'b4', title: 'Çakışan', time_block_start: '13:30', time_block_end: '14:30' }),
      ],
      '2026-11-02',
    );

    // 1) now before first block
    const before = layoutDayStrip(blocks, new Date(2026, 10, 2, 8, 15, 0, 0));
    expect(before.items[0]).toEqual({ kind: 'now', label: 'şimdi 08:15' });
    const blockItems = before.items.filter((i) => i.kind === 'block');
    expect(blockItems[0].kind === 'block' && blockItems[0].height).toBe(STRIP_BLOCK_MIN_PX);
    expect(blockItems[2].kind === 'block' && blockItems[2].height).toBe(STRIP_BLOCK_MAX_PX);

    // Gaps: 15m unlabeled, 45m labeled '45 dk ara' with height 16, overlap between b3 and b4 produces no gap
    const gaps = before.items.filter((i) => i.kind === 'gap');
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatchObject({ kind: 'gap', minutes: 15, label: null });
    expect(gaps[1]).toMatchObject({ kind: 'gap', minutes: 45, height: 16, label: '45 dk ara' });

    // 2) now inside b1 at midpoint (09:15) -> state 'current', nowFraction 0.5
    const insideBlock = layoutDayStrip(blocks, new Date(2026, 10, 2, 9, 15, 0, 0));
    const firstBlock = insideBlock.items[0];
    expect(firstBlock).toMatchObject({ kind: 'block', state: 'current', nowFraction: 0.5 });

    // 3) now inside 15m gap (09:35) -> gap height raised to >= STRIP_NOW_GAP_PX (28)
    const insideGap = layoutDayStrip(blocks, new Date(2026, 10, 2, 9, 35, 0, 0));
    const activeGap = insideGap.items.find((i) => i.kind === 'gap' && i.nowFraction !== null);
    expect(activeGap).toBeDefined();
    expect(activeGap!.kind === 'gap' && activeGap!.height).toBeGreaterThanOrEqual(STRIP_NOW_GAP_PX);

    // 4) now after all blocks -> trailing 'now' item, all blocks 'past'
    const after = layoutDayStrip(blocks, new Date(2026, 10, 2, 18, 5, 0, 0));
    expect(after.items[after.items.length - 1]).toEqual({ kind: 'now', label: 'şimdi 18:05' });
    expect(
      after.items.filter((i) => i.kind === 'block').every((i) => i.kind === 'block' && i.state === 'past'),
    ).toBe(true);

    // 5) now === null -> no 'now' item and all nowFraction null
    const noNow = layoutDayStrip(blocks, null);
    expect(noNow.nowLabel).toBeNull();
    expect(noNow.items.some((i) => i.kind === 'now')).toBe(false);
    expect(noNow.items.every((i) => i.kind === 'now' || i.nowFraction === null)).toBe(true);

    // 6) 9 blocks -> 8 visible + hiddenCount 1
    const nine = blocksOn(
      Array.from({ length: 9 }, (_, i) =>
        makeTask({
          id: `m${i}`,
          title: `Blok ${i}`,
          time_block_start: `${String(8 + i).padStart(2, '0')}:00`,
        }),
      ),
      '2026-11-02',
    );
    const capped = layoutDayStrip(nine, null);
    expect(capped.items.filter((i) => i.kind === 'block')).toHaveLength(8);
    expect(capped.hiddenCount).toBe(1);
  });

  it('(+) lib/nextBlock.ts contains zero hidden-clock calls (new Date() with 0 args or Date.now)', () => {
    const src = stripComments(readFileSync(join(__dirname, '../../lib/nextBlock.ts'), 'utf8'));
    expect(src).not.toMatch(/new\s+Date\s*\(\s*\)/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });
});
