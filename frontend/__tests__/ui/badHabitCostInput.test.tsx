import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockListBadHabits = jest.fn();
const mockCreateBadHabit = jest.fn();
jest.mock('../../services/badHabitService', () => ({
  listBadHabits: (...args: unknown[]) => mockListBadHabits(...args),
  createBadHabit: (...args: unknown[]) => mockCreateBadHabit(...args),
  savingsFor: jest.fn(() => ({ daysSinceQuit: 5, moneySaved: 100, timeSavedHours: 2 })),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'u1@aderyth.app' })),
}));

import BadHabitsTracker from '../../components/BadHabitsTracker';

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

describe('BadHabitsTracker — comma decimal cost & strict validation (DOM-19, GAP1-14)', () => {
  jest.setTimeout(30_000);
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockListBadHabits.mockResolvedValue({
      ok: true,
      data: { rows: [], nextCursor: null, hasMore: false },
    });
    mockCreateBadHabit.mockResolvedValue({ ok: true, data: { id: 'bh-1' } });
  });

  afterEach(async () => {
    await act(async () => {
      while (mounted.length > 0) mounted.pop()!.unmount();
    });
  });

  async function openAddModal(): Promise<TestRenderer.ReactTestRenderer> {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<BadHabitsTracker visible={true} onClose={jest.fn()} />);
    });
    mounted.push(r);
    const headerAddBtn = r.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.findAll((x) => x.props?.name === 'add-circle').length > 0)!;
    await act(async () => {
      headerAddBtn.props.onPress();
    });
    return r;
  }

  function findAddBtn(r: TestRenderer.ReactTestRenderer) {
    return r.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.findAllByType(Text).some((t) => t.props.children === 'Ekle'))!;
  }

  it('parses "12,5" as costPerDay 12.5 and treats empty fields as 0', async () => {
    const r = await openAddModal();
    const nameInput = r.root.findAllByType(TextInput).find((i) => String(i.props.placeholder).includes('Alışkanlık adı'))!;
    const costInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Günlük maliyet (₺)')!;
    const timeInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Günlük kaybedilen zaman (dakika)')!;

    await act(async () => {
      nameInput.props.onChangeText('Sigara');
      costInput.props.onChangeText('12,5');
      timeInput.props.onChangeText('30');
    });
    await act(async () => {
      await findAddBtn(r).props.onPress();
    });
    expect(mockCreateBadHabit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sigara',
        costPerDay: 12.5,
        timeWastedPerDay: 30,
      }),
    );

    // Reopen and submit with empty numeric fields -> both 0
    const headerAddBtn = r.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.findAll((x) => x.props?.name === 'add-circle').length > 0)!;
    await act(async () => {
      headerAddBtn.props.onPress();
    });
    const nameInput2 = r.root.findAllByType(TextInput).find((i) => String(i.props.placeholder).includes('Alışkanlık adı'))!;
    await act(async () => {
      nameInput2.props.onChangeText('Şeker');
    });
    await act(async () => {
      await findAddBtn(r).props.onPress();
    });
    expect(mockCreateBadHabit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'Şeker',
        costPerDay: 0,
        timeWastedPerDay: 0,
      }),
    );
  });

  it('blocks submission and shows inline hint on "12x", "-3", or fractional timeWastedPerDay "2,5"', async () => {
    const r = await openAddModal();
    const nameInput = r.root.findAllByType(TextInput).find((i) => String(i.props.placeholder).includes('Alışkanlık adı'))!;
    const costInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Günlük maliyet (₺)')!;
    const timeInput = r.root.findAllByType(TextInput).find((i) => i.props.placeholder === 'Günlük kaybedilen zaman (dakika)')!;

    await act(async () => {
      nameInput.props.onChangeText('Sigara');
      costInput.props.onChangeText('12x');
    });
    expect(allText(r)).toContain('Tutarı rakamla yaz, örn. 12,5');
    await act(async () => {
      await findAddBtn(r).props.onPress();
    });
    expect(mockCreateBadHabit).not.toHaveBeenCalled();

    await act(async () => {
      costInput.props.onChangeText('-3');
    });
    expect(allText(r)).toContain('Tutarı rakamla yaz, örn. 12,5');
    await act(async () => {
      await findAddBtn(r).props.onPress();
    });
    expect(mockCreateBadHabit).not.toHaveBeenCalled();

    // Valid cost, fractional minutes -> rejected (must be integer)
    await act(async () => {
      costInput.props.onChangeText('10');
      timeInput.props.onChangeText('2,5');
    });
    await act(async () => {
      await findAddBtn(r).props.onPress();
    });
    expect(mockCreateBadHabit).not.toHaveBeenCalled();
  });
});
