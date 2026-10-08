/**
 * R06.03 — "Checklist, hedef düzenleme, recovery ve review için ortak
 * form/önizleme/hata bileşenlerini kullan. İptal ve geri eylemi veri
 * kaybetmesin; tekrarlanan onay ekranları gereksiz sürtünme yaratmasın."
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
const mockGoal = { ok: false, error: null as string | null };
jest.mock('../../store/goalStore', () => {
  const state: any = {
    goals: [{ id: 'g1', user_id: 'u1', kind: 'yearly', title: 'Maraton', progress: 40, year: 2026, quarter: null, month: null, archived: false, created_at: '' }],
    loading: false, loadingMore: false, hasMore: false, error: null,
    loadGoals: jest.fn(async () => undefined), loadMore: jest.fn(), archiveGoal: jest.fn(), removeGoal: jest.fn(),
    addGoal: jest.fn(async () => { state.error = mockGoal.error; return mockGoal.ok; }),
    updateProgress: jest.fn(async () => { state.error = mockGoal.error; return mockGoal.ok; }),
  };
  const useGoalStore: any = (sel?: any) => (sel ? sel(state) : state);
  useGoalStore.getState = () => state;
  return { useGoalStore };
});

import GoalsScreen from '../../app/screens/goals';
import { FormError, FormPreview } from '../../components/ui';
import { useGoalStore } from '../../store/goalStore';

const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}

it('FormError is an alert, and renders nothing without a message', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<FormError message={null} />); });
  expect(r.toJSON()).toBeNull();
  await act(async () => { r.update(<FormError message="Olmadı" />); });
  expect((r.toJSON() as any).props.accessibilityRole).toBe('alert');
  await act(async () => { r.update(<FormPreview>{'Kaydedilecek: x'}</FormPreview>); });
  expect(textOf(r)).toMatch(/ÖNİZLEME Kaydedilecek: x/);
});

describe('the goal editor', () => {
  beforeEach(() => { Object.assign(mockGoal, { ok: false, error: 'permission denied' }); });

  it('a failed save keeps the form open, the input intact, and says why', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<GoalsScreen />); });
    await act(async () => { byLabel(r, 'Maraton, Elle girilen %40').props.onPress(); });
    await act(async () => { byLabel(r, 'İlerlemeyi yüzde 75 yap').props.onPress(); });
    expect(textOf(r)).toMatch(/Kaydedilecek: Elle girilen %75/);
    await act(async () => { await byLabel(r, 'Hedefi kaydet').props.onPress(); });
    expect(textOf(r)).toMatch(/permission denied/);
    expect(r.root.findAll((n) => n.props?.accessibilityRole === 'alert').length).toBeGreaterThan(0);
    expect(textOf(r)).toMatch(/Kaydedilecek: Elle girilen %75/); // still the user's choice
  });

  it('a cancelled NEW goal keeps its draft for the next "add" -- no confirmation screen', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<GoalsScreen />); });
    const add = r.root.findAll((n) => typeof n.props?.onPress === 'function' && /Yeni|ekle/i.test(n.props?.accessibilityLabel ?? ''))[0];
    await act(async () => { add.props.onPress(); });
    const input = r.root.findAll((n) => n.props?.placeholder?.endsWith?.('hedefini yaz...'))[0];
    await act(async () => { input.props.onChangeText('Kitap yaz'); });
    await act(async () => { byLabel(r, 'Kapat').props.onPress(); });
    await act(async () => { add.props.onPress(); });
    const again = r.root.findAll((n) => n.props?.placeholder?.endsWith?.('hedefini yaz...'))[0];
    expect(again.props.value).toBe('Kitap yaz');
  });

  it('a successful save closes the form and clears the draft', async () => {
    mockGoal.ok = true; mockGoal.error = null;
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<GoalsScreen />); });
    await act(async () => { byLabel(r, 'Maraton, Elle girilen %40').props.onPress(); });
    await act(async () => { await byLabel(r, 'Hedefi kaydet').props.onPress(); });
    expect(useGoalStore.getState().updateProgress).toHaveBeenCalled();
    expect(textOf(r)).not.toMatch(/Kaydedilecek/);
  });
});

it('the four forms share the same error component', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  for (const f of ['components/ChecklistEditor.tsx', 'app/screens/goals.tsx', 'app/screens/recovery.tsx', 'components/NextActionPicker.tsx']) {
    expect(read(f)).toMatch(/<FormError message=\{/);
    expect(read(f)).not.toMatch(/accessibilityRole="alert">\{error\}/);
  }
});
