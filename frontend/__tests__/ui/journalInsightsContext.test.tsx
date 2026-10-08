/**
 * R09.05 — the journal insight screen: the user chooses which records go to
 * the model, the prompt carries only those, the insight shows what it was
 * built from, and the model's text is labelled as commentary beside the
 * app's own numbers.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}) }));
const mockInvoke = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } } }));
let mockReq = 0;
jest.mock('../../services/focusPointService', () => ({ newRequestId: () => `req-${++mockReq}` }));
const mockEntries: any[] = [];
jest.mock('../../store/journalStore', () => {
  const fetchEntries = jest.fn(async () => undefined);
  const state = () => ({ entries: mockEntries, fetchEntries });
  const useJournalStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useJournalStore.getState = state;
  return { useJournalStore };
});
const mockSave = jest.fn(async () => undefined);
let mockCached: any = null;
jest.mock('../../store/insightsStore', () => {
  // stable functions, like the real store (a fresh one per render would re-run the screen's effects)
  const fetchInsight = jest.fn(async () => undefined);
  const state = () => ({ get: () => mockCached, fetchInsight, saveInsight: mockSave });
  const useInsightsStore: any = (sel?: any) => (sel ? sel(state()) : state());
  return { useInsightsStore };
});
jest.mock('../../store/subscriptionStore', () => {
  const state = { focusPoints: 50, fetch: jest.fn(async () => undefined), setBalance: jest.fn() };
  const useSubscriptionStore: any = (sel?: any) => (sel ? sel(state) : state);
  return { useSubscriptionStore };
});

import JournalInsightsScreen from '../../app/screens/journal-insights';

const E = (date: string, content: string, mood: number | null, created_at = `${date}T09:00:00Z`) =>
  ({ id: `j-${date}`, user_id: 'u1', date, content, mood, ai_summary: null, created_at });

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}
const press = (r: TestRenderer.ReactTestRenderer, pred: (n: any) => boolean) =>
  r.root.findAll((n) => pred(n) && typeof n.props?.onPress === 'function', { deep: false })[0];

beforeAll(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 8, 10), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  mockEntries.length = 0;
  mockEntries.push(E('2026-10-05', 'Koşu güzeldi', 4), E('2026-10-06', 'Çok özel bir konu', 2), E('2026-10-07', 'Yorgun ama iyi', 3), E('2026-09-30', 'Geçen hafta', 5));
  mockCached = null;
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ data: { insight: 'Bu hafta 9 kez koştun.', balance: 45 }, error: null });
  mockSave.mockClear();
});

async function mount() {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<JournalInsightsScreen />); });
  return r;
}

it('lists this period\'s records as choices with the app\'s own count and mood average', async () => {
  const r = await mount();
  const boxes = r.root.findAll((n) => n.props?.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function', { deep: false });
  expect(boxes.map((b) => [b.props.accessibilityLabel, b.props.accessibilityState.checked])).toEqual([
    ['2026-10-05 kaydı AI\'ya gitsin', true], ['2026-10-06 kaydı AI\'ya gitsin', true], ['2026-10-07 kaydı AI\'ya gitsin', true],
  ]);
  expect(textOf(r)).toMatch(/Uygulamanın hesabı: 3 kayıt · ruh hali ort\. 3 · 2026-10-05 – 2026-10-07/);
});

it('a record the user leaves out never reaches the prompt; the saved count is what was sent', async () => {
  const r = await mount();
  await act(async () => { press(r, (n) => n.props?.accessibilityLabel === '2026-10-06 kaydı AI\'ya gitsin').props.onPress(); });
  expect(textOf(r)).toMatch(/Uygulamanın hesabı: 2 kayıt/);
  expect(textOf(r)).toMatch(/1 kayıt sen çıkardın/);
  await act(async () => { await press(r, (n) => n.props?.accessibilityRole === 'button' && /odak puanı/.test(n.props.accessibilityHint ?? '')).props.onPress(); });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  const body = mockInvoke.mock.calls[0][1].body;
  expect(body.entries).toMatch(/Koşu güzeldi/);
  expect(body.entries).toMatch(/Yorgun ama iyi/);
  expect(body.entries).not.toMatch(/Çok özel/);
  expect(body.entries).not.toMatch(/Geçen hafta/);
  expect(mockSave).toHaveBeenCalledWith('weekly', '2026-10-05', 'Bu hafta 9 kez koştun.', 2);
});

it('with every record left out there is nothing to send: the button is disabled and nothing is called', async () => {
  const r = await mount();
  for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) {
    await act(async () => { press(r, (n) => n.props?.accessibilityLabel === `${d} kaydı AI'ya gitsin`).props.onPress(); });
  }
  const btn = press(r, (n) => n.props?.accessibilityRole === 'button' && /odak puanı/.test(n.props.accessibilityHint ?? ''));
  expect(btn.props.disabled).toBe(true);
  await act(async () => { await btn.props.onPress(); });
  expect(mockInvoke).not.toHaveBeenCalled();
});

it('a saved insight says what it was built from, labels the model\'s numbers, and says when records changed since', async () => {
  mockCached = { content: 'Bu hafta 9 kez koştun.', entry_count: 3, updated_at: '2026-10-07T20:00:00Z' };
  let r = await mount();
  expect(textOf(r)).toMatch(/3 kayıttan · Bu hafta · 2026-10-07/);
  expect(textOf(r)).toMatch(/AI yorumu — içindeki sayılar uygulamanın hesabı değildir\./);
  expect(textOf(r)).not.toMatch(/sonra değişti/);
  await act(async () => { r.unmount(); });
  mockEntries.push(E('2026-10-08', 'Yeni kayıt', 3, '2026-10-08T07:00:00Z'));
  r = await mount();
  expect(textOf(r)).toMatch(/Kayıtlar ya da seçimin bu içgörüden sonra değişti/);
});

it('R09.06 — a lost answer says so, and the resend of the same records carries the same request id', async () => {
  mockInvoke.mockReset();
  mockInvoke
    .mockResolvedValueOnce({ data: null, error: Object.assign(new Error('fetch'), { name: 'FunctionsFetchError' }) })
    .mockResolvedValueOnce({ data: { insight: 'Tamam.', balance: 40 }, error: null })
    .mockResolvedValueOnce({ data: { insight: 'Yine.', balance: 35 }, error: null });
  const r = await mount();
  const gen = () => press(r, (n) => n.props?.accessibilityRole === 'button' && /odak puanı/.test(n.props.accessibilityHint ?? ''));
  await act(async () => { await gen().props.onPress(); });
  expect(textOf(r)).toMatch(/Yanıt alınamadı\. Aynı isteği tekrar gönderirsen ikinci kez ücret alınmaz\./);
  await act(async () => { await gen().props.onPress(); });
  await act(async () => { await gen().props.onPress(); });
  const ids = mockInvoke.mock.calls.map((c) => c[1].body.request_id);
  expect(ids[0]).toBe(ids[1]);
  expect(ids[2]).not.toBe(ids[1]);
});
