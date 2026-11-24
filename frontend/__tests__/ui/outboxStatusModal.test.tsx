/**
 * F05 (SYN-16, SYN-03) — the offline sync sheet, rendered.
 *
 * Pins what can be pinned without a device: the message after "Şimdi Senkronize Et" comes from what
 * is left (offline with work waiting is not a success), every stuck change has "Yeniden dene" and a
 * two-step "Bu değişikliği bırak" (inline, no Alert.alert), conflicts only say where they are
 * resolved, and the buttons are real 44 pt buttons that name their row. Visual QA (devices, font
 * scale, screen readers) stays with the owner.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import type { OutboxIssue, UnifiedOutboxSummary } from '../../services/unifiedOutbox';

const mockSessionUser: { id: string | null } = { id: null };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: mockSessionUser.id ? { user: { id: mockSessionUser.id }, access_token: 't' } : null },
        error: null,
      }),
    },
    from: () => { throw new Error('no table access in this test'); },
  },
}));

const empty = (): UnifiedOutboxSummary => ({
  pending: 0, dead: 0, conflict: 0, authBlocked: false,
  channels: { habitLogs: { pending: 0, dead: 0 }, tasks: { pending: 0, dead: 0, conflict: 0, authBlocked: false }, core: { pending: 0, dead: 0, conflict: 0, authBlocked: false } },
});
const mockOutbox = {
  summary: empty(),
  after: null as UnifiedOutboxSummary | null,
  issues: [] as OutboxIssue[],
  retry: jest.fn(async (_i: OutboxIssue) => undefined),
  discard: jest.fn(async (_i: OutboxIssue) => undefined),
};

// the real `describeFlushOutcome`; the queues themselves are scripted
jest.mock('../../services/unifiedOutbox', () => {
  const actual = jest.requireActual('../../services/unifiedOutbox');
  return {
    ...actual,
    getUnifiedOutboxSummary: () => mockOutbox.summary,
    subscribeUnifiedOutbox: () => () => undefined,
    listOutboxIssues: () => mockOutbox.issues,
    flushAllOutboxes: async () => {
      if (mockOutbox.after) mockOutbox.summary = mockOutbox.after;
      return mockOutbox.summary;
    },
    retryOutboxIssue: (i: OutboxIssue) => mockOutbox.retry(i),
    discardOutboxIssue: (i: OutboxIssue) => mockOutbox.discard(i),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import OutboxStatusModal, { DISCARD_CONFIRM_MS } from '../../components/OutboxStatusModal';
import { contrastRatio, colors } from '../../lib/tokens';

// The first render of the sheet (its textures and icons) takes ~2 s alone and longer under a loaded
// full run; the same allowance as uiPrimitivesAccessibility.test.tsx. A render stuck for 30 s still fails.
jest.setTimeout(30_000);

type R = TestRenderer.ReactTestRenderer;
const texts = (r: R): string[] => r.root.findAll((n) => typeof n.props.children === 'string' && (n.type as unknown) === 'Text').map((n) => n.props.children as string);
const buttons = (r: R, label: string) => r.root.findAll((n) => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
const button = (r: R, label: string) => {
  const found = buttons(r, label);
  expect(found.length).toBeGreaterThanOrEqual(1);
  return found[0];
};
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(3).filter(Boolean) as Record<string, unknown>[]);
const json = (r: R) => JSON.stringify(r.toJSON());

const habitIssue: OutboxIssue = { channel: 'habit', id: 'op-1', label: 'Su iç · 2026-08-04', reason: 'Sunucu kabul etmedi.', status: 'dead' };
const conflictIssue: OutboxIssue = { channel: 'core', id: 'c-1', label: 'Not', reason: 'Başka bir yerde değiştirilmiş.', status: 'conflict' };

async function render(): Promise<R> {
  let r!: R;
  await act(async () => { r = TestRenderer.create(<OutboxStatusModal visible onClose={() => undefined} />); });
  return r;
}
async function flush(r: R) {
  await act(async () => { await button(r, 'Şimdi Senkronize Et').props.onPress(); });
}

let alertSpy: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSessionUser.id = null;
  mockOutbox.summary = empty();
  mockOutbox.after = null;
  mockOutbox.issues = [];
  mockOutbox.retry.mockClear();
  mockOutbox.discard.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert');
});
afterEach(() => {
  expect(alertSpy).not.toHaveBeenCalled(); // never a native alert (it does nothing on the web)
  alertSpy.mockRestore();
  jest.useRealTimers();
});

describe('SYN-16 — an honest message', () => {
  it('offline with 7 waiting: "bekliyor", not "eşitlendi", no success icon; announced politely', async () => {
    mockOutbox.summary = { ...empty(), pending: 7 };
    mockOutbox.after = { ...empty(), pending: 7 };
    const r = await render();
    await flush(r);
    const msg = '7 değişiklik bekliyor. Bağlantı gelince kendiliğinden gönderilecek.';
    expect(texts(r)).toContain(msg);
    expect(texts(r)).not.toContain('Her şey eşitlendi.');
    expect(json(r)).not.toMatch(/iletildi/);
    expect(r.root.findAll((n) => n.props.accessibilityLiveRegion === 'polite' && n.props.children === msg).length).toBeGreaterThanOrEqual(1);
    expect(r.root.findAll((n) => n.props.name === 'cloud-done-outline')).toHaveLength(0);
    act(() => r.unmount());
  });

  it('really empty after the flush: "Her şey eşitlendi." and the success icon', async () => {
    mockOutbox.summary = { ...empty(), pending: 2 };
    mockOutbox.after = empty();
    const r = await render();
    await flush(r);
    expect(texts(r)).toContain('Her şey eşitlendi.');
    expect(r.root.findAll((n) => n.props.name === 'cloud-done-outline').length).toBeGreaterThanOrEqual(1);
    act(() => r.unmount());
  });
});

describe('SYN-03 — a way out for every stuck change', () => {
  it('a dead row: "Yeniden dene" retries that change', async () => {
    mockOutbox.summary = { ...empty(), dead: 1 };
    mockOutbox.issues = [habitIssue];
    const r = await render();
    expect(json(r)).toMatch(/Gönderilemeyenler/);
    expect(texts(r)).toEqual(expect.arrayContaining(['Su iç · 2026-08-04', 'Sunucu kabul etmedi.', 'Yeniden dene']));
    await act(async () => { await button(r, 'Su iç · 2026-08-04: yeniden dene').props.onPress(); });
    expect(mockOutbox.retry).toHaveBeenCalledWith(habitIssue);
    act(() => r.unmount());
  });

  it('"Bu değişikliği bırak": the first tap asks in place, the second drops it', async () => {
    mockOutbox.issues = [habitIssue];
    const r = await render();
    await act(async () => { await button(r, 'Su iç · 2026-08-04: bu değişikliği bırak').props.onPress(); });
    expect(mockOutbox.discard).not.toHaveBeenCalled();
    expect(texts(r)).toContain('Emin misin? Dokun ve bırak');
    await act(async () => { await button(r, 'Su iç · 2026-08-04: Emin misin? Dokun ve bırak').props.onPress(); });
    expect(mockOutbox.discard).toHaveBeenCalledWith(habitIssue);
    act(() => r.unmount());
  });

  it('the question goes away by itself after 4 s; a tap after that only asks again', async () => {
    jest.useFakeTimers();
    mockOutbox.issues = [habitIssue];
    const r = await render();
    await act(async () => { await button(r, 'Su iç · 2026-08-04: bu değişikliği bırak').props.onPress(); });
    expect(texts(r)).toContain('Emin misin? Dokun ve bırak');
    expect(DISCARD_CONFIRM_MS).toBe(4_000);
    act(() => { jest.advanceTimersByTime(DISCARD_CONFIRM_MS); });
    expect(texts(r)).not.toContain('Emin misin? Dokun ve bırak');
    expect(texts(r)).toContain('Bu değişikliği bırak');
    await act(async () => { await button(r, 'Su iç · 2026-08-04: bu değişikliği bırak').props.onPress(); });
    expect(mockOutbox.discard).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it('a conflict row offers no action, only where it is resolved', async () => {
    mockOutbox.issues = [conflictIssue];
    const r = await render();
    expect(texts(r)).toContain('İlgili ekranda çözülür');
    expect(buttons(r, 'Not: yeniden dene')).toHaveLength(0);
    expect(buttons(r, 'Not: bu değişikliği bırak')).toHaveLength(0);
    act(() => r.unmount());
  });

  it('nothing stuck: the section is not rendered at all', async () => {
    mockOutbox.summary = { ...empty(), pending: 3 };
    const r = await render();
    expect(json(r)).not.toMatch(/Gönderilemeyenler/);
    expect(json(r)).not.toMatch(/Yeniden dene/);
    act(() => r.unmount());
  });
});

describe('accessibility', () => {
  it('row actions are 44 pt buttons that name their row; the row reads its label and reason', async () => {
    mockOutbox.issues = [habitIssue];
    const r = await render();
    for (const label of ['Su iç · 2026-08-04: yeniden dene', 'Su iç · 2026-08-04: bu değişikliği bırak']) {
      const b = button(r, label);
      expect({ label, minHeight: flat(b.props.style).minHeight }).toEqual({ label, minHeight: 44 });
      expect(b.props.hitSlop).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
    }
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Su iç · 2026-08-04. Sunucu kabul etmedi.').length).toBeGreaterThanOrEqual(1);
    act(() => r.unmount());
  });

  it('F19 (SYN-04 / TST-15): shows calm quarantine count politely with WCAG AA contrast and reports channel flush errors honestly', async () => {
    expect(contrastRatio(colors.textDim, colors.surface)).toBeGreaterThanOrEqual(4.5);

    mockSessionUser.id = 'u1';
    await AsyncStorage.setItem('outbox.v1.core.u1.quarantine.1', 'raw-1');
    await AsyncStorage.setItem('atlas_sync_queue_v1:u1.quarantine.2', 'raw-2');

    mockOutbox.after = { ...empty(), errors: { habitLogs: 'boom' } };
    const r = await render();
    await act(async () => { await Promise.resolve(); });

    const qLine = 'Okunamayan 2 kayıt güvenli yerde saklandı.';
    expect(texts(r)).toContain(qLine);
    const qNode = r.root.findAll((n) => n.props.children === qLine && n.props.accessibilityLiveRegion === 'polite');
    expect(qNode.length).toBeGreaterThanOrEqual(1);
    expect(flat(qNode[0].props.style).color).toBe(colors.textDim);

    await flush(r);
    expect(texts(r)).toContain('Bazı değişiklikler gönderilemedi; kalanlar sonra tekrar denenecek.');
    expect(texts(r)).not.toContain('Her şey eşitlendi.');
    act(() => r.unmount());
  });
});
