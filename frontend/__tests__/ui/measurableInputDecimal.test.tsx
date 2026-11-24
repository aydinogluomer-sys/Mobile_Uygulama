import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import MeasurableInputModal from '../../components/MeasurableInputModal';
import type { Habit } from '../../lib/supabase';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h-water',
    user_id: 'u1',
    name: 'Su İç',
    icon: 'water-outline',
    color: '#3b82f6',
    behavior_type: 'positive',
    tracking_type: 'numeric',
    unit: 'L',
    daily_goal: 2.5,
    target_direction: 'at_least',
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status: 'active',
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 3,
    estimated_minutes: 5,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function allText(renderer: TestRenderer.ReactTestRenderer): string {
  const flatten = (c: unknown): string => {
    if (c == null || typeof c === 'boolean') return '';
    if (typeof c === 'string' || typeof c === 'number') return String(c);
    if (Array.isArray(c)) return c.map(flatten).join('');
    return '';
  };
  return renderer.root
    .findAllByType(Text)
    .map((n) => flatten(n.props.children))
    .join(' ');
}

describe('MeasurableInputModal — decimal locale input & calm validation hint (DOM-03)', () => {
  jest.setTimeout(30_000);
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  afterEach(async () => {
    await act(async () => {
      while (mounted.length > 0) mounted.pop()!.unmount();
    });
  });

  it('parses "2,5" and "1.234,5", previews the exact day total, and calls onConfirm with the numeric value', async () => {
    const onConfirm = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <MeasurableInputModal
          visible={true}
          habit={makeHabit()}
          currentValue={0}
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });
    mounted.push(r);

    const input = r.root.findByType(TextInput);
    await act(async () => {
      input.props.onChangeText('2,5');
    });
    expect(allText(r)).toContain('Kaydedince bugün: 2.5 L');

    const saveBtn = r.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.findAllByType(Text).some((t) => t.props.children === 'Kaydet'))!;
    await act(async () => {
      saveBtn.props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledWith(2.5);

    await act(async () => {
      input.props.onChangeText('1.234,5');
    });
    await act(async () => {
      saveBtn.props.onPress();
    });
    expect(onConfirm).toHaveBeenLastCalledWith(1234.5);
  });

  it('rejects non-numeric input with polite hint, rejects 0 for floor, and accepts 0 for ceiling', async () => {
    const onConfirm = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <MeasurableInputModal
          visible={true}
          habit={makeHabit({ target_direction: 'at_least' })}
          currentValue={0}
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });
    mounted.push(r);

    const input = r.root.findByType(TextInput);
    const saveBtn = r.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.findAllByType(Text).some((t) => t.props.children === 'Kaydet'))!;

    await act(async () => {
      input.props.onFocus?.();
      input.props.onChangeText('abc');
    });
    expect(allText(r)).toContain('Sayıyı rakamla yaz, örn. 2,5');
    await act(async () => {
      saveBtn.props.onPress();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    // Floor: 0 is rejected
    await act(async () => {
      input.props.onChangeText('0');
    });
    await act(async () => {
      saveBtn.props.onPress();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    // Ceiling: 0 is accepted as a clean day
    await act(async () => {
      r.update(
        <MeasurableInputModal
          visible={true}
          habit={makeHabit({ target_direction: 'at_most', daily_goal: 2 })}
          currentValue={0}
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText('0');
    });
    const ceilingSaveBtn = r.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.findAllByType(Text).some((t) => t.props.children === 'Kaydet'))!;
    await act(async () => {
      ceilingSaveBtn.props.onPress();
    });
    expect(onConfirm).toHaveBeenCalledWith(0);
  });
});
