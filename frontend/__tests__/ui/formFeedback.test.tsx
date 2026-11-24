/**
 * R06.03 — "Checklist, hedef düzenleme, recovery ve review için ortak
 * form/önizleme/hata bileşenlerini kullan. İptal ve geri eylemi veri
 * kaybetmesin; tekrarlanan onay ekranları gereksiz sürtünme yaratmasın."
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
const mockGoal = { ok: false, error: null as string | null };
jest.mock('../../store/goalStore', () => {
  const state: any = {
    goals: [
      {
        id: 'g1',
        user_id: 'u1',
        kind: 'yearly',
        title: 'Maraton',
        progress: 40,
        year: 2026,
        quarter: null,
        month: null,
        archived: false,
        created_at: '',
      },
    ],
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    loadGoals: jest.fn(async () => undefined),
    loadMore: jest.fn(),
    archiveGoal: jest.fn(),
    removeGoal: jest.fn(),
    addGoal: jest.fn(async () => {
      state.error = mockGoal.error;
      return mockGoal.ok;
    }),
    updateProgress: jest.fn(async () => {
      state.error = mockGoal.error;
      return mockGoal.ok;
    }),
  };
  const useGoalStore: any = (sel?: any) => (sel ? sel(state) : state);
  useGoalStore.getState = () => state;
  return { useGoalStore };
});

import GoalsScreen from '../../app/screens/goals';
import { FormError, FormPreview } from '../../components/ui';
import { useGoalStore } from '../../store/goalStore';
import {
  fireEvent,
  renderWithProviders,
  screen,
  type RenderedScreen,
} from '../helpers/renderWithProviders';

function unwrapJson(json: ReturnType<RenderedScreen['toJSON']>) {
  if (
    json &&
    !Array.isArray(json) &&
    json.type === 'RNCSafeAreaProvider'
  ) {
    if (!json.children || json.children.length === 0) return null;
    return json.children.length === 1 ? json.children[0] : json.children;
  }
  return json;
}

function textOf(r: RenderedScreen): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    walk(n.children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

it('FormError is an alert, and renders nothing without a message', () => {
  const r = renderWithProviders(<FormError message={null} />);
  expect(unwrapJson(r.toJSON())).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();

  r.rerender(<FormError message="Olmadı" />);
  const alertNode = unwrapJson(r.toJSON()) as any;
  expect(alertNode.props.accessibilityRole).toBe('alert');
  expect(screen.getByRole('alert')).toBeTruthy();

  r.rerender(<FormPreview>{'Kaydedilecek: x'}</FormPreview>);
  expect(textOf(r)).toMatch(/ÖNİZLEME Kaydedilecek: x/);
});

describe('the goal editor', () => {
  beforeEach(() => {
    Object.assign(mockGoal, { ok: false, error: 'permission denied' });
  });

  it('a failed save keeps the form open, the input intact, and says why', async () => {
    const r = renderWithProviders(<GoalsScreen />);
    await r.user.press(screen.getByLabelText('Maraton, Elle girilen %40'));
    await r.user.press(screen.getByLabelText('İlerlemeyi yüzde 75 yap'));
    expect(textOf(r)).toMatch(/Kaydedilecek: Elle girilen %75/);
    await r.user.press(screen.getByLabelText('Hedefi kaydet'));
    expect(textOf(r)).toMatch(/permission denied/);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(textOf(r)).toMatch(/Kaydedilecek: Elle girilen %75/);
  });

  it('a cancelled NEW goal keeps its draft for the next "add" -- no confirmation screen', async () => {
    const r = renderWithProviders(<GoalsScreen />);
    const add = screen.getAllByLabelText(/Yeni|ekle/i)[0];
    await r.user.press(add);
    const input = screen.getByPlaceholderText(/hedefini yaz\.\.\.$/);
    fireEvent.changeText(input, 'Kitap yaz');
    await r.user.press(screen.getByLabelText('Kapat'));
    await r.user.press(screen.getAllByLabelText(/Yeni|ekle/i)[0]);
    const again = screen.getByPlaceholderText(/hedefini yaz\.\.\.$/);
    expect(again.props.value).toBe('Kitap yaz');
  });

  it('a successful save closes the form and clears the draft', async () => {
    mockGoal.ok = true;
    mockGoal.error = null;
    const r = renderWithProviders(<GoalsScreen />);
    await r.user.press(screen.getByLabelText('Maraton, Elle girilen %40'));
    await r.user.press(screen.getByLabelText('Hedefi kaydet'));
    expect(useGoalStore.getState().updateProgress).toHaveBeenCalled();
    expect(textOf(r)).not.toMatch(/Kaydedilecek/);
  });
});

it('the four forms share the same error component', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  for (const f of [
    'components/ChecklistEditor.tsx',
    'app/screens/goals.tsx',
    'app/screens/recovery.tsx',
    'components/NextActionPicker.tsx',
  ]) {
    expect(read(f)).toMatch(/<FormError message=\{/);
    expect(read(f)).not.toMatch(/accessibilityRole="alert">\{error\}/);
  }
});
