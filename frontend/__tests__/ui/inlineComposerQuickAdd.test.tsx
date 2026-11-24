import React from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockSpeech = {
  available: false,
  blocked: false,
  listening: false,
  error: null as string | null,
  errorKind: null as string | null,
  start: jest.fn(async () => undefined),
  stop: jest.fn(),
  lastOnTranscript: null as ((t: string) => void) | null,
  lastOptions: undefined as { getBase?: () => { before: string; after: string }; maxLength?: number; enabled?: boolean } | undefined,
};

jest.mock('../../hooks/useSpeechInput', () => {
  const actual = jest.requireActual('../../hooks/useSpeechInput');
  return {
    ...actual,
    useSpeechInput: (
      onTranscript: (t: string) => void,
      options?: { getBase?: () => { before: string; after: string }; maxLength?: number; enabled?: boolean },
    ) => {
      mockSpeech.lastOnTranscript = onTranscript;
      mockSpeech.lastOptions = options;
      return {
        available: mockSpeech.available,
        blocked: mockSpeech.blocked,
        listening: mockSpeech.listening,
        error: mockSpeech.error,
        errorKind: mockSpeech.errorKind,
        start: mockSpeech.start,
        stop: mockSpeech.stop,
      };
    },
  };
});

import InlineComposer from '../../components/InlineComposer';
import { composeDictation } from '../../hooks/useSpeechInput';

const FIXED_NOW = () => new Date(2026, 10, 4, 10, 0, 0, 0);
const PROJECTS = [{ id: 'p1', name: 'Sağlık' }];

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function render(el: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(el);
  });
  mounted.push(tree);
  return tree;
}

beforeEach(() => {
  mockSpeech.available = false;
  mockSpeech.blocked = false;
  mockSpeech.listening = false;
  mockSpeech.error = null;
  mockSpeech.errorKind = null;
  mockSpeech.start.mockClear();
  mockSpeech.stop.mockClear();
  mockSpeech.lastOnTranscript = null;
  mockSpeech.lastOptions = undefined;
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((t) => t.unmount());
  });
});

function allTexts(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .join(' | ');
}

function pressableByLabel(tree: TestRenderer.ReactTestRenderer, labelPrefix: string) {
  return tree.root.findAll(
    (n) =>
      typeof n.props?.onPress === 'function' &&
      typeof n.props?.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith(labelPrefix),
    { deep: false },
  );
}

describe('InlineComposer — quickAdd live preview chips & dismissal', () => {
  it('(+) shows live Turkish chip preview, submits extracted title + fields, and restores word to title when chip is dismissed', async () => {
    const onSubmit = jest.fn(async () => undefined);
    const tree = await render(
      <InlineComposer onSubmit={onSubmit} quickAdd={{ projects: PROJECTS, now: FIXED_NOW }} />,
    );

    const input = tree.root.findByType(TextInput);
    await act(async () => {
      input.props.onChangeText('yarın süt al');
    });

    expect(allTexts(tree)).toContain('Yarın');
    const chips = pressableByLabel(tree, 'Tarih: Yarın');
    expect(chips.length).toBeGreaterThanOrEqual(1);

    // Dismiss the date chip -> disappears, word stays in submitted title
    await act(async () => {
      chips[0].props.onPress();
    });
    expect(pressableByLabel(tree, 'Tarih: Yarın')).toHaveLength(0);

    await act(async () => {
      await tree.root.findByType(TextInput).props.onSubmitEditing();
    });
    expect(onSubmit).toHaveBeenCalledWith('yarın süt al', {});
    expect(tree.root.findByType(TextInput).props.value).toBe('');

    // Fresh entry without dismissing -> extracted title + dueDate
    onSubmit.mockClear();
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('yarın süt al');
    });
    await act(async () => {
      await tree.root.findByType(TextInput).props.onSubmitEditing();
    });
    expect(onSubmit).toHaveBeenCalledWith('süt al', { dueDate: '2026-11-05' });
  });

  it('(+) hides mic when unavailable or permanently blocked, renders >=44pt labelled mic when available, and preserves typed text during dictation', async () => {
    const onSubmit = jest.fn();

    // Unavailable -> no mic button
    mockSpeech.available = false;
    const tUnavailable = await render(<InlineComposer onSubmit={onSubmit} voice />);
    expect(pressableByLabel(tUnavailable, 'Sesle ekle')).toHaveLength(0);

    // Permanently blocked -> no mic button
    mockSpeech.available = true;
    mockSpeech.blocked = true;
    const tBlocked = await render(<InlineComposer onSubmit={onSubmit} voice />);
    expect(pressableByLabel(tBlocked, 'Sesle ekle')).toHaveLength(0);

    // Available & unblocked -> 44x44 labelled button + selection-preserving getBase
    mockSpeech.blocked = false;
    const tReady = await render(
      <InlineComposer onSubmit={onSubmit} quickAdd={{ projects: PROJECTS, now: FIXED_NOW }} voice />,
    );
    const mic = pressableByLabel(tReady, 'Sesle ekle')[0];
    expect(mic).toBeDefined();
    const flatStyle = Object.assign({}, ...[mic.props.style].flat(3).filter(Boolean));
    expect(flatStyle.minWidth).toBeGreaterThanOrEqual(44);
    expect(flatStyle.minHeight).toBeGreaterThanOrEqual(44);

    // User types "yarın ", then dictates interim transcripts -> "yarın " stays intact
    await act(async () => {
      tReady.root.findByType(TextInput).props.onChangeText('yarın ');
    });
    const base = mockSpeech.lastOptions!.getBase!();
    await act(async () => {
      mockSpeech.lastOnTranscript!(composeDictation(base, 'süt al'));
    });
    expect(tReady.root.findByType(TextInput).props.value).toBe('yarın süt al');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('(-) backward compatibility: omitting quickAdd sends raw 1-arg title with zero chips; blank input ignored; rejected onSubmit keeps text', async () => {
    const onSubmit = jest.fn(async () => undefined);
    const tree = await render(<InlineComposer onSubmit={onSubmit} />);

    // Blank / whitespace does not submit
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('   ');
    });
    await act(async () => {
      await tree.root.findByType(TextInput).props.onSubmitEditing();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    // Without quickAdd, "yarın süt al" shows zero chips and passes a single argument
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('yarın süt al');
    });
    expect(pressableByLabel(tree, 'Tarih:')).toHaveLength(0);
    await act(async () => {
      await tree.root.findByType(TextInput).props.onSubmitEditing();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]).toEqual(['yarın süt al']);

    // Failing onSubmit preserves user's typed text
    const failingSubmit = jest.fn(async () => {
      throw new Error('ağ hatası');
    });
    const tFail = await render(<InlineComposer onSubmit={failingSubmit} />);
    await act(async () => {
      tFail.root.findByType(TextInput).props.onChangeText('kaybolmamalı');
    });
    await act(async () => {
      await expect(tFail.root.findByType(TextInput).props.onSubmitEditing()).rejects.toThrow('ağ hatası');
    });
    expect(tFail.root.findByType(TextInput).props.value).toBe('kaybolmamalı');
  });
});
