import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import type { Habit } from '../../lib/supabase';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('../../store/habitStore', () => ({
  useHabitStore: <T,>(selector: (state: { habits: Habit[]; loading: boolean }) => T): T =>
    selector({ habits: [], loading: false }),
}));

jest.mock('../../store/willpowerStore', () => ({
  useWillpowerStore: <T,>(
    selector: (state: { canActivate: () => boolean; score: () => number | null }) => T,
  ): T =>
    selector({
      canActivate: () => true,
      score: () => 100,
    }),
}));

import HabitOnboarding from '../../components/HabitOnboarding';

function flattenText(c: unknown): string {
  if (c == null || typeof c === 'boolean') return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (Array.isArray(c)) return c.map(flattenText).join('');
  return '';
}

function allText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map((n) => flattenText(n.props.children))
    .join(' ');
}

function buttonByText(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const hit = renderer.root
    .findAllByType(TouchableOpacity)
    .find((b) => b.findAllByType(Text).some((t) => flattenText(t.props.children).trim() === label));
  if (!hit) throw new Error(`Button "${label}" not found`);
  return hit;
}

describe('HabitOnboarding — decimal & zero ceiling targets + duration floor note (DOM-11, INT-04)', () => {
  jest.setTimeout(30_000);
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  afterEach(async () => {
    await act(async () => {
      while (mounted.length > 0) mounted.pop()!.unmount();
    });
  });

  async function mountAtStep2(onSubmit = jest.fn()) {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<HabitOnboarding visible={true} onClose={jest.fn()} onSubmit={onSubmit} />);
    });
    mounted.push(r);
    const nameInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: Sabah Sporu')!;
    await act(async () => {
      nameInput.props.onChangeText('Su Takibi');
    });
    await act(async () => {
      buttonByText(r, 'Devam').props.onPress();
    });
    return r;
  }

  it('echoes raw text ("2," and "2,5") without stripping the comma, submits 2.5, and allows "0" under at_most for numeric and duration', async () => {
    const onSubmit = jest.fn();
    const r = await mountAtStep2(onSubmit);

    await act(async () => {
      buttonByText(r, 'Sayısal').props.onPress();
    });

    const unitInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: adım, sayfa, ml')!;
    const goalInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!;

    await act(async () => {
      unitInput.props.onChangeText('L');
      goalInput.props.onChangeText('2,');
    });
    expect(r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.value).toBe('2,');

    await act(async () => {
      r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.onChangeText('2,5');
    });
    expect(r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.value).toBe('2,5');
    expect(buttonByText(r, 'Devam').props.disabled).toBe(false);

    // Advance to step 7 and submit -> daily_goal === 2.5
    for (let step = 2; step < 7; step += 1) {
      await act(async () => {
        buttonByText(r, 'Devam').props.onPress();
      });
    }
    await act(async () => {
      buttonByText(r, 'Fikir Olarak Sakla').props.onPress();
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ daily_goal: 2.5, unit: 'L' }));

    // Re-enter step 2 for at_most "0" numeric and duration
    const r2 = await mountAtStep2();
    await act(async () => {
      buttonByText(r2, 'Sayısal').props.onPress();
    });
    await act(async () => {
      r2.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: adım, sayfa, ml')!.props.onChangeText('fincan');
      buttonByText(r2, 'En fazla ↓').props.onPress();
    });
    await act(async () => {
      r2.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.onChangeText('0');
    });
    expect(r2.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.value).toBe('0');
    expect(buttonByText(r2, 'Devam').props.disabled).toBe(false);

    // Duration + at_most + "0"
    await act(async () => {
      buttonByText(r2, 'Süre').props.onPress();
    });
    await act(async () => {
      buttonByText(r2, 'En fazla ↓').props.onPress();
    });
    await act(async () => {
      r2.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 20')!.props.onChangeText('0');
    });
    expect(r2.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 20')!.props.value).toBe('0');
    expect(buttonByText(r2, 'Devam').props.disabled).toBe(false);
  });

  it('blocks "0" under at_least, re-validates when switching from at_most to at_least, warns on "abc", and shows step 5 duration floor note only when unset', async () => {
    const r = await mountAtStep2();
    await act(async () => {
      buttonByText(r, 'Sayısal').props.onPress();
    });

    const unitInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: adım, sayfa, ml')!;
    await act(async () => {
      unitInput.props.onChangeText('L');
      r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.onChangeText('0');
    });
    expect(buttonByText(r, 'Devam').props.disabled).toBe(true);
    expect(allText(r)).toContain("En az için hedef 0'dan büyük olmalı");

    // Switch to at_most -> allowed; switch back to at_least -> re-blocked
    await act(async () => {
      buttonByText(r, 'En fazla ↓').props.onPress();
    });
    expect(buttonByText(r, 'Devam').props.disabled).toBe(false);

    await act(async () => {
      buttonByText(r, 'En az ↑').props.onPress();
    });
    expect(buttonByText(r, 'Devam').props.disabled).toBe(true);
    expect(allText(r)).toContain("En az için hedef 0'dan büyük olmalı");

    // Non-numeric "abc" -> blocked with hint
    await act(async () => {
      r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.onChangeText('abc');
    });
    expect(buttonByText(r, 'Devam').props.disabled).toBe(true);
    expect(allText(r)).toContain('Sayıyı rakamla yaz, örn. 2,5');

    // Fix target and navigate to Step 5 to verify progressive duration floor note
    await act(async () => {
      r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Örn: 10000')!.props.onChangeText('2,5');
    });
    for (let step = 2; step < 5; step += 1) {
      await act(async () => {
        buttonByText(r, 'Devam').props.onPress();
      });
    }
    expect(allText(r)).toContain('Süre seçilmedi: yük en az 1 dk üzerinden hesaplanır');

    await act(async () => {
      buttonByText(r, '30 dk').props.onPress();
    });
    expect(allText(r)).not.toContain('Süre seçilmedi: yük en az 1 dk üzerinden hesaplanır');
  });
});
