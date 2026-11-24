import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, TouchableOpacity } from 'react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../lib/haptics', () => ({
  haptic: { select: jest.fn(), light: jest.fn(), success: jest.fn() },
}));

import HabitColorPicker from '../../components/habits/HabitColorPicker';
import { HABIT_HUES } from '../../lib/habitColors';

describe('components/habits/HabitColorPicker (F31 Thefor F-7)', () => {
  it('(+) renders 12 radio swatches >= 44pt, marks selected swatch with checkmark + accessibilityState.selected, and supports reset to null', () => {
    const onChange = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <HabitColorPicker value={HABIT_HUES[4].hex} onChange={onChange} />,
      );
    });

    const radios = r.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityRole === 'radio',
    );
    expect(radios).toHaveLength(12);

    for (const radio of radios) {
      const flat = StyleSheet.flatten(radio.props.style) as {
        minWidth?: number;
        minHeight?: number;
      };
      expect(flat.minWidth ?? 0).toBeGreaterThanOrEqual(44);
      expect(flat.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }

    const selectedRadio = radios[4];
    expect(selectedRadio.props.accessibilityState?.selected).toBe(true);
    expect(selectedRadio.props.accessibilityLabel).toBe(`${HABIT_HUES[4].label}, seçili`);
    expect(
      selectedRadio.findAll(
        (n) => n.type === ('Ionicons' as unknown) && n.props?.name === 'checkmark',
      ).length,
    ).toBeGreaterThan(0);

    act(() => {
      radios[0].props.onPress();
    });
    expect(onChange).toHaveBeenCalledWith(HABIT_HUES[0].hex);

    const resetBtn = r.root.find(
      (n) => n.type === TouchableOpacity && n.props?.accessibilityLabel === 'Varsayılan renge dön',
    );
    act(() => {
      resetBtn.props.onPress();
    });
    expect(onChange).toHaveBeenCalledWith(null);
    act(() => {
      r.unmount();
    });
  });

  it('(-) when disabled, neither swatches nor reset button invoke onChange; off-palette hex shows "Özel renk" with zero selected radios', () => {
    const onChange = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <HabitColorPicker value="#123456" onChange={onChange} disabled />,
      );
    });

    const radios = r.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityRole === 'radio',
    );
    expect(radios.every((rd) => rd.props.accessibilityState?.selected === false)).toBe(true);

    const allText = JSON.stringify(r.toJSON());
    expect(allText).toContain('Özel renk');

    act(() => {
      radios[0].props.onPress?.();
    });
    const resetBtn = r.root.find(
      (n) => n.type === TouchableOpacity && n.props?.accessibilityLabel === 'Varsayılan renge dön',
    );
    act(() => {
      resetBtn.props.onPress?.();
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      r.unmount();
    });
  });
});
