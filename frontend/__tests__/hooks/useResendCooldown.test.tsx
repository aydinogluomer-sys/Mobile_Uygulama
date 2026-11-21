import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import {
  RESEND_COOLDOWN_SECONDS,
  resetResendCooldowns,
  useResendCooldown,
  type ResendCooldown,
} from '../../hooks/useResendCooldown';

jest.useFakeTimers();

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function mountProbe(
  key?: string | null,
): Promise<{ tree: TestRenderer.ReactTestRenderer; read: () => ResendCooldown }> {
  let latest!: ResendCooldown;
  function Probe({ cooldownKey }: { cooldownKey?: string | null }) {
    const state = useResendCooldown(cooldownKey);
    latest = state;
    return <Text>{`${state.remaining}:${state.active ? '1' : '0'}`}</Text>;
  }
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<Probe cooldownKey={key} />);
  });
  mounted.push(tree);
  return { tree, read: () => latest };
}

beforeEach(() => {
  jest.setSystemTime(new Date('2026-11-21T10:00:00.000Z'));
  resetResendCooldowns();
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((t) => t.unmount());
  });
});

describe('useResendCooldown — saat tabanlı, ekranlar arası paylaşılan geri sayım', () => {
  it('(+) start() 60 sn başlatır, 1 sn sonra 59 ve 60 sn sonra 0 / active=false olur', async () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    const { read } = await mountProbe('kisi@ornek.com');
    expect(read().remaining).toBe(0);
    expect(read().active).toBe(false);

    await act(async () => { read().start(); });
    expect(read().remaining).toBe(60);
    expect(read().active).toBe(true);

    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(read().remaining).toBe(59);
    expect(read().active).toBe(true);

    await act(async () => { jest.advanceTimersByTime(59_000); });
    expect(read().remaining).toBe(0);
    expect(read().active).toBe(false);
  });

  it('(+) aynı e-posta anahtarıyla bağlanan ikinci bileşen kalan süreyi paylaşır (giriş <-> kayıt)', async () => {
    const first = await mountProbe('ayni@ornek.com');
    await act(async () => { first.read().start(); });
    await act(async () => { jest.advanceTimersByTime(18_000); });
    expect(first.read().remaining).toBe(42);

    const second = await mountProbe('  AYNI@ornek.com  ');
    expect(second.read().remaining).toBe(42);
    expect(second.read().active).toBe(true);
  });

  it('(+) start(5) özel bekleme süresini uygular', async () => {
    const { read } = await mountProbe('ozel@ornek.com');
    await act(async () => { read().start(5); });
    expect(read().remaining).toBe(5);

    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(read().remaining).toBe(0);
    expect(read().active).toBe(false);
  });

  it('(-) farklı anahtarlar ve null anahtarlar birbirinin beklemesini paylaşmaz', async () => {
    const a = await mountProbe('bir@ornek.com');
    const b = await mountProbe('iki@ornek.com');
    const c1 = await mountProbe(null);
    const c2 = await mountProbe(null);

    await act(async () => { a.read().start(); });
    expect(a.read().remaining).toBe(60);
    expect(b.read().remaining).toBe(0);

    await act(async () => { c1.read().start(30); });
    expect(c1.read().remaining).toBe(30);
    expect(c2.read().remaining).toBe(0);
  });

  it('(-) bileşen unmount edildiğinde açık interval kalmaz ve act uyarısı üretmez', async () => {
    const { tree, read } = await mountProbe('temiz@ornek.com');
    // The renderer keeps fake timers of its own (scheduler), so a raw timer count says
    // nothing about the hook; the hook's own one-second interval is followed by identity.
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');
    try {
      await act(async () => { read().start(); });
      const started = setSpy.mock.calls
        .map((call, i) => ({ ms: call[1], id: setSpy.mock.results[i]?.value }))
        .filter((c) => c.ms === 1000);
      expect(started).toHaveLength(1);
      expect(clearSpy.mock.calls.some((c) => c[0] === started[0].id)).toBe(false);

      await act(async () => {
        tree.unmount();
        const idx = mounted.indexOf(tree);
        if (idx >= 0) mounted.splice(idx, 1);
      });
      expect(clearSpy.mock.calls.some((c) => c[0] === started[0].id)).toBe(true);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it('(-) bekleme bitince interval kendiliğinden kapanır', async () => {
    const { read } = await mountProbe('bitis@ornek.com');
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');
    try {
      await act(async () => { read().start(3); });
      const started = setSpy.mock.calls
        .map((call, i) => ({ ms: call[1], id: setSpy.mock.results[i]?.value }))
        .filter((c) => c.ms === 1000);
      expect(started).toHaveLength(1);
      await act(async () => { jest.advanceTimersByTime(3000); });
      expect(read().active).toBe(false);
      expect(clearSpy.mock.calls.some((c) => c[0] === started[0].id)).toBe(true);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });

  it('(-) sistem saati 1 saat geri alınsa bile remaining istenen süreyi aşmaz', async () => {
    const startMs = Date.now();
    const { read } = await mountProbe('saat@ornek.com');
    await act(async () => { read().start(60); });
    expect(read().remaining).toBe(60);

    jest.setSystemTime(startMs - 3_600_000);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(read().remaining).toBeLessThanOrEqual(60);
    expect(read().remaining).toBe(60);
  });

  it('(-) clear() sayacı anında sıfırlar ve 0 sonrası süre ilerletmek sayacı negatife düşürmez', async () => {
    const { read } = await mountProbe('ifade@ornek.com');
    await act(async () => { read().start(10); });
    expect(read().remaining).toBe(10);

    await act(async () => { read().clear(); });
    expect(read().remaining).toBe(0);
    expect(read().active).toBe(false);

    await act(async () => { jest.advanceTimersByTime(120_000); });
    expect(read().remaining).toBe(0);
  });
});
