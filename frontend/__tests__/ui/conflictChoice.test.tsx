/**
 * R02.05 — the conflict choice is offered where the conflicting record is:
 * three labelled buttons, each handing its choice to the store.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
const mockResolve = jest.fn(async () => true);
const mockConflicts = { list: [] as { operationId: string; entityId: string; payload: Record<string, unknown> }[] };
jest.mock('../../store/noteStore', () => {
  const state = {
    notes: [{ id: 'n1', user_id: 'u1', title: 'Plan', content: 'x', tags: [], created_at: '', updated_at: '' }],
    loading: false, loadingMore: false, hasMore: false,
    loadMore: jest.fn(), fetchNotes: jest.fn(async () => undefined), addNote: jest.fn(), updateNote: jest.fn(), removeNote: jest.fn(), search: jest.fn(async () => []),
    conflicts: () => mockConflicts.list,
    resolveConflict: (...a: unknown[]) => (mockResolve as any)(...a),
  };
  const useNoteStore: any = (sel?: any) => (sel ? sel(state) : state);
  useNoteStore.getState = () => state;
  return { useNoteStore };
});

import ConflictChoice from '../../components/ConflictChoice';
import NotesScreen from '../../app/screens/notes';

const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === label);

it('offers all three choices, each labelled, each reporting its own value', async () => {
  const chosen: string[] = [];
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<ConflictChoice what='"Plan" notu' onChoose={(c) => chosen.push(c)} />); });
  for (const label of ['Bu cihazdaki sürümü tut', 'Diğer sürümü tut, bu cihazdaki değişikliği bırak', 'İki sürümü de tut']) {
    const n = r.root.findAll((x) => x.props?.accessibilityLabel === label && typeof x.props.onPress === 'function')[0];
    await act(async () => { n.props.onPress(); });
  }
  expect(chosen).toEqual(['mine', 'theirs', 'both']);
  expect(byLabel(r, '"Plan" notu başka bir yerde de değiştirildi. Hangisi kalsın?')).toHaveLength(1);
});

it('the notes screen shows the choice only while a note is in conflict, and "both" goes to the store', async () => {
  mockConflicts.list = [];
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<NotesScreen />); });
  expect(byLabel(r, '"Plan" notu başka bir yerde de değiştirildi. Hangisi kalsın?')).toHaveLength(0);

  mockConflicts.list = [{ operationId: 'op1', entityId: 'n1', payload: { content: 'bu cihaz' } }];
  await act(async () => { r.update(<NotesScreen />); });
  expect(byLabel(r, '"Plan" notu başka bir yerde de değiştirildi. Hangisi kalsın?')).toHaveLength(1);
  const both = r.root.findAll((x) => x.props?.accessibilityLabel === 'İki sürümü de tut' && typeof x.props.onPress === 'function')[0];
  await act(async () => { await both.props.onPress(); });
  expect(mockResolve).toHaveBeenCalledWith('n1', 'both');
});
