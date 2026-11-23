const mockSessionUser: { id: string | null } = { id: 'u1' };

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => (mockSessionUser.id ? { id: mockSessionUser.id, email: null } : null)),
}));

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(30_000);

import TimeCapsuleComposer from '../../components/journal/TimeCapsuleComposer';
import TimeCapsuleCard from '../../components/recovery/TimeCapsuleCard';
import { useTimeCapsules } from '../../hooks/useTimeCapsules';
import { resetAccountMemory } from '../../lib/accountScope';
import { CAPSULE_COPY, loadCapsules, saveCapsules, type TimeCapsule } from '../../lib/timeCapsule';

function HookHarness() {
  const caps = useTimeCapsules();
  return (
    <>
      <Text testID="ready">{String(caps.ready)}</Text>
      <Text testID="eligible">{caps.eligible ? caps.eligible.id : 'none'}</Text>
      <Text testID="waiting">{String(caps.waiting)}</Text>
      {caps.eligible && (
        <TimeCapsuleCard
          capsule={caps.eligible}
          onRead={() => {
            void caps.open(caps.eligible!.id);
          }}
          onLater={() => {}}
        />
      )}
    </>
  );
}

describe('F37 — TimeCapsuleCard, TimeCapsuleComposer & useTimeCapsules', () => {
  const sampleCapsule: TimeCapsule = {
    id: 'cap-1',
    text: 'Bugün yavaşlamak sorun değil, yarın yeniden başlarsın.',
    day: '2026-01-01',
    createdAt: '2026-01-01T10:00:00.000Z',
  };

  beforeEach(async () => {
    mockSessionUser.id = 'u1';
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('(+) renders header role, plain text, and >= 44pt Okudum / Şimdi değil buttons firing callbacks', () => {
    const onRead = jest.fn();
    const onLater = jest.fn();
    render(<TimeCapsuleCard capsule={sampleCapsule} onRead={onRead} onLater={onLater} />);

    const header = screen.getByRole('header');
    expect(header.props.children).toBe(CAPSULE_COPY.cardTitle);
    expect(screen.getByText(sampleCapsule.text)).toBeTruthy();

    const readBtn = screen.getByLabelText(CAPSULE_COPY.read);
    const laterBtn = screen.getByLabelText(CAPSULE_COPY.later);
    expect(StyleSheet.flatten(readBtn.props.style)?.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(laterBtn.props.style)?.minHeight ?? 0).toBeGreaterThanOrEqual(44);

    fireEvent.press(laterBtn);
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onRead).not.toHaveBeenCalled();

    fireEvent.press(readBtn);
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('(-) renders markdown/HTML tokens verbatim as plain text and touches no storage without onRead', async () => {
    const setItemMock = AsyncStorage.setItem as jest.Mock;
    setItemMock.mockClear();
    const rawMarkup = '**kalın** <b>x</b> _italik_';
    render(
      <TimeCapsuleCard
        capsule={{ ...sampleCapsule, text: rawMarkup }}
        onRead={() => {}}
        onLater={() => {}}
      />,
    );
    expect(screen.getByText(rawMarkup)).toBeTruthy();
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it('(+) useTimeCapsules.open marks capsule opened AND persists via saveCapsules across remounts', async () => {
    await saveCapsules('u1', [sampleCapsule]);
    const { rerender } = render(
      <View testID="harness-root">
        <HookHarness key="mount-1" />
      </View>,
    );

    await waitFor(
      () =>
        expect({
          ready: screen.getByTestId('ready').props.children,
          eligible: screen.getByTestId('eligible').props.children,
          waiting: screen.getByTestId('waiting').props.children,
        }).toEqual({ ready: 'true', eligible: 'cap-1', waiting: '1' }),
      { timeout: 5000 },
    );
    fireEvent.press(screen.getByLabelText(CAPSULE_COPY.read));

    await waitFor(() => expect(screen.getByTestId('eligible').props.children).toBe('none'), {
      timeout: 5000,
    });
    await waitFor(
      () => {
        expect(AsyncStorage.setItem).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
    const persisted = await loadCapsules('u1');
    expect(persisted[0]?.openedAt).toBeDefined();

    // Remount HookHarness under stable host root so useTimeCapsules re-reads from AsyncStorage
    rerender(
      <View testID="harness-root">
        <HookHarness key="mount-2" />
      </View>,
    );
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'), {
      timeout: 5000,
    });
    expect(screen.getByTestId('eligible').props.children).toBe('none');
  });

  it('(+) TimeCapsuleComposer starts collapsed, saves note, shows full message at 5 notes, and supports Yeniden oku & Sil', async () => {
    await saveCapsules('u1', [
      {
        id: 'opened-1',
        text: 'Geçmişteki iyi gününden selam.',
        day: '2026-01-02',
        createdAt: '2026-01-02T09:00:00.000Z',
        openedAt: '2026-01-05T09:00:00.000Z',
      },
      { id: 'w-2', text: 'Not 2', day: '2026-01-03', createdAt: '2026-01-03T09:00:00.000Z' },
      { id: 'w-3', text: 'Not 3', day: '2026-01-04', createdAt: '2026-01-04T09:00:00.000Z' },
      { id: 'w-4', text: 'Not 4', day: '2026-01-05', createdAt: '2026-01-05T09:00:00.000Z' },
      { id: 'w-5', text: 'Not 5', day: '2026-01-06', createdAt: '2026-01-06T09:00:00.000Z' },
    ]);

    render(<TimeCapsuleComposer />);
    const toggle = screen.getByLabelText(CAPSULE_COPY.composerTitle);
    expect(toggle.props.accessibilityState?.expanded).toBe(false);

    fireEvent.press(toggle);
    await waitFor(() => expect(screen.getByLabelText('Yeniden oku')).toBeTruthy(), {
      timeout: 5000,
    });

    // Re-read opened note inline
    fireEvent.press(screen.getByLabelText('Yeniden oku'));
    expect(screen.getByText('Geçmişteki iyi gününden selam.')).toBeTruthy();

    // At 5 notes, attempting a 6th shows CAPSULE_COPY.full while preserving input
    fireEvent.changeText(screen.getByPlaceholderText(CAPSULE_COPY.placeholder), 'Altıncı not');
    fireEvent.press(screen.getByLabelText(CAPSULE_COPY.save));
    await waitFor(() => expect(screen.getByText(CAPSULE_COPY.full)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByPlaceholderText(CAPSULE_COPY.placeholder).props.value).toBe('Altıncı not');

    // Delete one note (5 -> 4), then save succeeds (4 -> 5)
    fireEvent.press(screen.getAllByLabelText('Notu sil')[1]);
    await waitFor(() => expect(screen.getAllByLabelText('Notu sil').length).toBe(4));
    expect((await loadCapsules('u1')).length).toBe(4);

    fireEvent.changeText(screen.getByPlaceholderText(CAPSULE_COPY.placeholder), 'Sabırlı ol.');
    fireEvent.press(screen.getByLabelText(CAPSULE_COPY.save));
    await waitFor(() => expect(screen.getByText(CAPSULE_COPY.saved)).toBeTruthy(), {
      timeout: 5000,
    });
    expect((await loadCapsules('u1')).length).toBe(5);
  });

  it('(-) preserves typed text and reports error when AsyncStorage write fails or no user is signed in', async () => {
    render(<TimeCapsuleComposer />);
    fireEvent.press(screen.getByLabelText(CAPSULE_COPY.composerTitle));
    await waitFor(() => expect(screen.getByPlaceholderText(CAPSULE_COPY.placeholder)).toBeTruthy());

    const setItemMock = AsyncStorage.setItem as jest.Mock;
    const origImpl = setItemMock.getMockImplementation();
    setItemMock.mockRejectedValueOnce(new Error('disk full'));
    try {
      fireEvent.changeText(screen.getByPlaceholderText(CAPSULE_COPY.placeholder), 'Kaybolmasın');
      fireEvent.press(screen.getByLabelText(CAPSULE_COPY.save));
      await waitFor(() =>
        expect(screen.getByText('Not kaydedilemedi, yeniden dene.')).toBeTruthy(),
      );
      expect(screen.getByPlaceholderText(CAPSULE_COPY.placeholder).props.value).toBe('Kaybolmasın');
    } finally {
      if (origImpl) setItemMock.mockImplementation(origImpl);
    }
  });
});
