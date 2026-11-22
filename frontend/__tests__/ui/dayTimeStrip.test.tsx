/**
 * F36 — `DayTimeStrip` sunumsal bileşen testleri (erişilebilirlik etiketleri,
 * geçmiş blok sönüklüğü, `now: null` M7 koruması, +N taşma metni ve akış düzeni).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import DayTimeStrip from '../../components/calendar/DayTimeStrip';
import { blocksOn, type BlockTask } from '../../lib/nextBlock';
import { colors } from '../../lib/tokens';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object' && 'children' in (n as Record<string, unknown>)) {
      walk((n as { children?: unknown }).children);
    }
  };
  walk(r.toJSON());
  return out.join(' ');
}

const makeTask = (over: Partial<BlockTask> = {}): BlockTask => ({
  id: 't1',
  title: 'Rapor yazma',
  due_date: '2026-11-02',
  time_block_start: '14:00',
  time_block_end: '15:00',
  completed: false,
  status: 'pending',
  priority: 'none',
  ...over,
});

describe('F36 DayTimeStrip — blocks, now-line, overflow & flow layout', () => {
  it('(+) renders accessible block rows, dims past blocks with textFaint, and labels intra-block now line "Şimdi, 14:32"', async () => {
    const blocks = blocksOn(
      [
        makeTask({ id: 'b1', title: 'Sabah özeti', time_block_start: '09:00', time_block_end: '09:30' }),
        makeTask({ id: 'b2', title: 'Rapor yazma', time_block_start: '14:00', time_block_end: '15:00' }),
        makeTask({ id: 'b3', title: 'Akşam yürüyüşü', time_block_start: '18:00', time_block_end: '18:45' }),
      ],
      '2026-11-02',
    );

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <DayTimeStrip blocks={blocks} now={new Date(2026, 10, 2, 14, 32, 0, 0)} />,
      );
    });

    const listRoot = r.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.accessibilityRole === 'list',
    );
    expect(listRoot).toHaveLength(1);

    const a11yLabels = r.root
      .findAll((n) => typeof n.type === 'string' && n.props?.accessible === true)
      .map((n) => String(n.props.accessibilityLabel));

    expect(a11yLabels).toContain('09:00 ile 09:30 arası, Sabah özeti, bitti');
    expect(a11yLabels).toContain('14:00 ile 15:00 arası, Rapor yazma, şu an sürüyor');
    expect(a11yLabels).toContain('18:00 ile 18:45 arası, Akşam yürüyüşü, yaklaşıyor');
    expect(a11yLabels).toContain('Şimdi, 14:32');

    const pastTitle = r.root.findAll(
      (n) => typeof n.type === 'string' && n.children.includes('Sabah özeti'),
    )[0];
    const flatPastStyle = Object.assign({}, ...[pastTitle.props.style].flat(3).filter(Boolean));
    expect(flatPastStyle.color).toBe(colors.textFaint);

    await act(async () => {
      r.unmount();
    });
  });

  it('(-) renders null for empty blocks, omits now-line when now is null (M7), caps 9 blocks at 8 with +1 more, and keeps block cards in flow layout', async () => {
    // 1. Empty blocks -> null
    let rEmpty!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rEmpty = TestRenderer.create(<DayTimeStrip blocks={[]} now={new Date(2026, 10, 2, 10, 0)} />);
    });
    expect(rEmpty.toJSON()).toBeNull();

    // 2. M7 guard: now === null -> ZERO now lines
    const nineBlocks = blocksOn(
      Array.from({ length: 9 }, (_, i) =>
        makeTask({
          id: `k${i}`,
          title: `Görev ${i + 1}`,
          time_block_start: `${String(8 + i).padStart(2, '0')}:00`,
          time_block_end: `${String(8 + i).padStart(2, '0')}:30`,
        }),
      ),
      '2026-11-02',
    );

    let rNullNow!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      rNullNow = TestRenderer.create(<DayTimeStrip blocks={nineBlocks} now={null} />);
    });

    const allAccessible = rNullNow.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.accessible === true,
    );
    expect(allAccessible).toHaveLength(8);
    expect(
      allAccessible.some((n) => String(n.props?.accessibilityLabel ?? '').startsWith('Şimdi')),
    ).toBe(false);
    expect(textOf(rNullNow)).not.toContain('şimdi');
    expect(textOf(rNullNow)).toContain('+1 blok daha');

    // 3. Flow layout & font scaling: zero block elements use position: 'absolute', and allowFontScaling is never false
    for (const blockNode of allAccessible) {
      const flat = Object.assign({}, ...[blockNode.props.style].flat(3).filter(Boolean));
      expect(flat.position).not.toBe('absolute');
    }
    const textNodes = rNullNow.root.findAll((n) => String(n.type) === 'Text');
    expect(textNodes.every((t) => t.props?.allowFontScaling !== false)).toBe(true);

    await act(async () => {
      rNullNow.unmount();
    });
  });
});
