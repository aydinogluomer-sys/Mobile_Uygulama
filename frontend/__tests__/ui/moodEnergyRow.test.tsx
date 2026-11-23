import React from 'react';
import { StyleSheet } from 'react-native';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: null })),
}));

import MoodCheckins from '../../components/MoodCheckins';
import ReflectionTemplate from '../../components/journal/ReflectionTemplate';
import { REFLECTION_DISCLAIMER } from '../../lib/reflectionTemplate';
import { useMoodStore } from '../../store/moodStore';

describe('F37 — MoodCheckins 2nd-tap energy row & ReflectionTemplate UI', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useMoodStore.setState({ userId: 'u1', definitions: [], checkins: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('(+) records check-in on mood tap, shows inline energy prompt, sets low energy and renders label in today list', async () => {
    render(<MoodCheckins />);
    await waitFor(() => expect(useMoodStore.getState().userId).toBe('u1'));

    // Before tapping any mood, no energy prompt is shown
    expect(screen.queryByText('Enerjin nasıl?')).toBeNull();

    fireEvent.press(screen.getByLabelText('Yorgun olarak kaydet'));
    expect(useMoodStore.getState().checkins).toHaveLength(1);
    expect(screen.getByText('Enerjin nasıl?')).toBeTruthy();

    const lowBtn = screen.getByLabelText('Enerji düşük olarak ekle');
    const highBtn = screen.getByLabelText('Enerji yüksek olarak ekle');
    const skipBtn = screen.getByLabelText('Enerji sormasını geç');

    for (const btn of [lowBtn, highBtn, skipBtn]) {
      const flat = StyleSheet.flatten(btn.props.style);
      expect(flat?.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }

    fireEvent.press(lowBtn);
    expect(screen.queryByText('Enerjin nasıl?')).toBeNull();
    expect(useMoodStore.getState().checkins[0].energy).toBe('low');
    expect(screen.getByText(/düşük enerji/)).toBeTruthy();
  });

  it('(+) "Geç" dismisses energy prompt without writing energy, and a second check-in replaces the previous prompt', async () => {
    render(<MoodCheckins />);
    await waitFor(() => expect(useMoodStore.getState().userId).toBe('u1'));

    fireEvent.press(screen.getByLabelText('Orta olarak kaydet'));
    const firstId = useMoodStore.getState().checkins[0].id;
    expect(screen.getByText('Enerjin nasıl?')).toBeTruthy();

    // Second check-in replaces active prompt target
    fireEvent.press(screen.getByLabelText('İyi olarak kaydet'));
    const secondId = useMoodStore.getState().checkins[0].id;
    expect(secondId).not.toBe(firstId);

    fireEvent.press(screen.getByLabelText('Enerji yüksek olarak ekle'));
    expect(useMoodStore.getState().checkins.find((c) => c.id === secondId)?.energy).toBe('high');
    expect('energy' in useMoodStore.getState().checkins.find((c) => c.id === firstId)!).toBe(false);
    expect(screen.queryByText('Enerjin nasıl?')).toBeNull();

    // Third check-in + Geç -> no energy written
    fireEvent.press(screen.getByLabelText('Zor olarak kaydet'));
    fireEvent.press(screen.getByLabelText('Enerji sormasını geç'));
    expect(screen.queryByText('Enerjin nasıl?')).toBeNull();
    expect('energy' in useMoodStore.getState().checkins[0]).toBe(false);
  });

  it('(-) custom mood form with "Belirtme" selected creates a definition without an energy key', async () => {
    render(<MoodCheckins />);
    await waitFor(() => expect(useMoodStore.getState().userId).toBe('u1'));

    fireEvent.press(screen.getByLabelText('Yeni duygu ekle'));
    fireEvent.changeText(screen.getByLabelText('Duygu ikonu'), '🌿');
    fireEvent.changeText(screen.getByLabelText('Duygu adı'), 'Dingin');
    fireEvent.press(screen.getByLabelText('Varsayılan enerji: Belirtme'));
    fireEvent.press(screen.getByLabelText('Duyguyu ekle'));

    expect(useMoodStore.getState().definitions).toHaveLength(1);
    expect('energy' in useMoodStore.getState().definitions[0]).toBe(false);
  });

  it('(+) ReflectionTemplate starts collapsed, shows disclaimer, disables insert when blank, and inserts formatted block', () => {
    const onInsert = jest.fn();
    render(<ReflectionTemplate onInsert={onInsert} />);

    const toggle = screen.getByLabelText('Yansıtma şablonu');
    expect(toggle.props.accessibilityState?.expanded).toBe(false);
    expect(screen.queryByText(REFLECTION_DISCLAIMER)).toBeNull();

    fireEvent.press(toggle);
    expect(screen.getByLabelText('Yansıtma şablonu').props.accessibilityState?.expanded).toBe(true);
    expect(screen.getByText(REFLECTION_DISCLAIMER)).toBeTruthy();

    const insertBtn = screen.getByLabelText('Günlüğe ekle');
    expect(insertBtn.props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('Ne oldu'), 'Toplantı uzadı');
    fireEvent.changeText(screen.getByLabelText('Başka nasıl bakabilirim'), 'Yarın devam edebilirim');
    expect(screen.getByLabelText('Günlüğe ekle').props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(screen.getByLabelText('Günlüğe ekle'));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(
      'Ne oldu: Toplantı uzadı\nBaşka nasıl bakabilirim: Yarın devam edebilirim',
    );
    expect(screen.queryByText(REFLECTION_DISCLAIMER)).toBeNull();
  });
});
