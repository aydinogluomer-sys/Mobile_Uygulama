import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, TextInput, TouchableOpacity } from 'react-native';

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
}));

import HabitDayNote from '../../components/habits/HabitDayNote';
import { noteHintKey } from '../../lib/habitNote';

function collectText(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    const obj = n as { children?: unknown };
    walk(obj.children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('components/habits/HabitDayNote (F31 PS-03)', () => {
  it('(+) enables Kaydet only when changed, shows counter >= 240, and sends null when cleared', async () => {
    const onSave = jest.fn(async () => ({ ok: true as const }));
    const onDismiss = jest.fn();

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <HabitDayNote
          variant="inline"
          dayLabel="12 Mart Çarşamba"
          initial="eski not"
          userId="u1"
          onSave={onSave}
          onDismiss={onDismiss}
        />,
      );
    });

    const findSaveBtn = () =>
      r.root.find(
        (n) => n.type === TouchableOpacity && n.props?.accessibilityLabel === 'Kaydet',
      );

    expect(findSaveBtn().props.accessibilityState?.disabled).toBe(true);
    expect(collectText(r)).not.toContain('/280');

    const input = r.root.findByType(TextInput);
    expect(input.props.accessibilityLabel).toBe('Not, 12 Mart Çarşamba');
    act(() => {
      input.props.onChangeText('a'.repeat(245));
    });
    expect(collectText(r)).toContain('245/280');
    expect(findSaveBtn().props.accessibilityState?.disabled).toBe(false);

    act(() => {
      input.props.onChangeText('   ');
    });
    expect(findSaveBtn().props.accessibilityState?.disabled).toBe(false);
    await act(async () => {
      await findSaveBtn().props.onPress();
    });
    expect(onSave).toHaveBeenCalledWith(null);
    act(() => {
      r.unmount();
    });
  });

  it('(+) offer variant shows one-time hint on first mount and (-) hides it on second mount', async () => {
    const onSave = jest.fn(async () => ({ ok: true as const }));
    let r1!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r1 = TestRenderer.create(
        <HabitDayNote
          variant="offer"
          dayLabel="12 Mart Çarşamba"
          initial={null}
          userId="u1"
          onSave={onSave}
          onDismiss={jest.fn()}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(collectText(r1)).toContain('İstersen nedenini tek satırda yaz. Yalnız sen görürsün.');
    expect(mockStore.get(noteHintKey('u1'))).toBe('1');
    act(() => {
      r1.unmount();
    });

    let r2!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r2 = TestRenderer.create(
        <HabitDayNote
          variant="offer"
          dayLabel="13 Mart Perşembe"
          initial={null}
          userId="u1"
          onSave={onSave}
          onDismiss={jest.fn()}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(collectText(r2)).not.toContain('İstersen nedenini tek satırda yaz.');
    act(() => {
      r2.unmount();
    });
  });

  it('(-) prevents double-tap duplicate saves, shows inline error without Alert, and never calls console.*', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let resolveSave!: (v: { ok: false; error: string }) => void;
    const onSave = jest.fn(
      () =>
        new Promise<{ ok: false; error: string }>((res) => {
          resolveSave = res;
        }),
    );

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <HabitDayNote
          variant="inline"
          dayLabel="12 Mart Çarşamba"
          initial={null}
          userId="u1"
          onSave={onSave}
          onDismiss={jest.fn()}
        />,
      );
    });

    const input = r.root.findByType(TextInput);
    act(() => {
      input.props.onChangeText('özel gizli not');
    });

    const saveBtn = r.root.find(
      (n) => n.type === TouchableOpacity && n.props?.accessibilityLabel === 'Kaydet',
    );

    act(() => {
      void saveBtn.props.onPress();
      void saveBtn.props.onPress();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave({ ok: false, error: 'Not kaydedilemedi. Bağlantını kontrol edip tekrar dene.' });
    });

    expect(collectText(r)).toContain('Not kaydedilemedi.');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    act(() => {
      r.unmount();
    });

    alertSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });
});
