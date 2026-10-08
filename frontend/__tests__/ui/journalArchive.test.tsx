/**
 * R07.03 — history, calendar, search and tag filter on the journal archive.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}) }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../components/MoodHabitCard', () => () => null);
jest.mock('../../lib/date', () => ({ ...jest.requireActual('../../lib/date'), todayLocal: () => '2026-10-08' }));
jest.mock('../../store/journalStore', () => {
  const E = (date: string, content: string) => ({ id: `j-${date}`, user_id: 'u1', date, content, mood: 3, ai_summary: null, created_at: '' });
  const state = {
    entries: [E('2026-10-07', 'İLAÇ saatini kaçırdım #sağlık'), E('2026-10-02', 'Koşu güzeldi'), E('2026-09-20', 'Eylül notu')],
    fetchEntries: jest.fn(async () => undefined),
  };
  const useJournalStore: any = (sel?: any) => (sel ? sel(state) : state);
  useJournalStore.getState = () => state;
  return { useJournalStore };
});

import JournalArchiveScreen from '../../app/screens/journal-archive';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}
const host = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === label);

it('search narrows the history (Turkish folding), and says when nothing matches', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<JournalArchiveScreen />); });
  const input = r.root.findAll((n) => n.props?.accessibilityLabel === 'Günlükte ara' && n.props.onChangeText)[0];
  await act(async () => { input.props.onChangeText('ilaç'); });
  expect(textOf(r)).toMatch(/İLAÇ saatini/);
  expect(textOf(r)).not.toMatch(/Koşu güzeldi/);
  await act(async () => { input.props.onChangeText('hiç yok'); });
  expect(textOf(r)).toMatch(/Bu aramayla kayıt yok/);
});

it('the calendar shows the month, marks days with an entry and opens them', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<JournalArchiveScreen />); });
  const cal = r.root.findAll((n) => n.props?.accessibilityLabel === 'Takvim' && typeof n.props.onPress === 'function')[0];
  await act(async () => { cal.props.onPress(); });
  expect(textOf(r)).toMatch(/EKİM 2026/);
  expect(host(r, '7 Ekim, kayıt var')).toHaveLength(1);
  expect(host(r, '8 Ekim, kayıt yok')).toHaveLength(1);
  const day = r.root.findAll((n) => n.props?.accessibilityLabel === '7 Ekim, kayıt var' && typeof n.props.onPress === 'function')[0];
  await act(async () => { day.props.onPress(); });
  expect(mockPush).toHaveBeenCalledWith('/screens/journal-reader?date=2026-10-07');
  const prev = r.root.findAll((n) => n.props?.accessibilityLabel === 'Önceki ay' && typeof n.props.onPress === 'function')[0];
  await act(async () => { prev.props.onPress(); });
  expect(textOf(r)).toMatch(/EYLÜL 2026/);
  expect(host(r, '20 Eylül, kayıt var')).toHaveLength(1);
});
