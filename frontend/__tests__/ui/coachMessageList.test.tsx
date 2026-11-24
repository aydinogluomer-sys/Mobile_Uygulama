import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import CoachMessageList, { type CoachMessage } from '../../components/coach/CoachMessageList';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const SAMPLE: CoachMessage[] = [
  { id: 'm1', role: 'user', content: 'Bugün odaklanmakta zorlanıyorum' },
  { id: 'm2', role: 'assistant', content: 'Küçük bir 5 dakikalık adımla başlayabiliriz.' },
  { id: 'm3', role: 'error', content: 'Bağlantı koptu, tekrar dene.' },
];

describe('F21 (PRF-15) — CoachMessageList accessibility, ordering, and touch-target contract', () => {
  it('(+) renders bubbles with exact roles (alert only on error), older button, speak only on assistant, children before streaming bubble, and >=44pt touch targets', () => {
    const onLoadOlder = jest.fn();
    const onCopy = jest.fn();
    const onSpeak = jest.fn();

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <CoachMessageList
          messages={SAMPLE}
          hasOlder={true}
          onLoadOlder={onLoadOlder}
          copiedId="m1"
          speakingId={null}
          onCopy={onCopy}
          onSpeak={onSpeak}
          loading={true}
          streamingReply="Yazılan canlı yanıt..."
        >
          <View>
            <Text>ONAY_KARTI_YER_TUTUCU</Text>
          </View>
        </CoachMessageList>,
      );
    });

    const alerts = tree.root.findAllByType(View).filter((v) => v.props.accessibilityRole === 'alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].findAllByType(Text).map((t) => t.props.children)).toContain('Bağlantı koptu, tekrar dene.');

    const olderBtn = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.props.accessibilityLabel === 'Daha eski mesajları yükle');
    expect(olderBtn).toBeDefined();
    act(() => {
      olderBtn!.props.onPress();
    });
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    const speakBtns = tree.root
      .findAllByType(TouchableOpacity)
      .filter((b) => b.props.accessibilityLabel === 'Yanıtı sesli oku');
    expect(speakBtns).toHaveLength(1);
    act(() => {
      speakBtns[0].props.onPress();
    });
    expect(onSpeak).toHaveBeenCalledWith(SAMPLE[1]);

    const copyBtns = tree.root
      .findAllByType(TouchableOpacity)
      .filter((b) => b.props.accessibilityLabel === 'Mesajı kopyala');
    expect(copyBtns).toHaveLength(3);
    for (const btn of [...copyBtns, ...speakBtns]) {
      const flat = StyleSheet.flatten(btn.props.style) as { minWidth?: number; minHeight?: number };
      expect(flat.minWidth).toBeGreaterThanOrEqual(44);
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    }

    const progress = tree.root.findAllByType(View).find((v) => v.props.accessibilityRole === 'progressbar');
    expect(progress).toBeDefined();
    expect(progress!.props.accessibilityLabel).toBe('Koç yanıt yazıyor');

    // Ordering: messages -> children (confirmation card) -> streaming bubble
    const allTexts = tree.root.findAllByType(Text).map((t) => String(t.props.children));
    const lastMsgIdx = allTexts.indexOf('Bağlantı koptu, tekrar dene.');
    const cardIdx = allTexts.indexOf('ONAY_KARTI_YER_TUTUCU');
    const streamIdx = allTexts.indexOf('Yazılan canlı yanıt...');
    expect(cardIdx).toBeGreaterThan(lastMsgIdx);
    expect(streamIdx).toBeGreaterThan(cardIdx);

    act(() => {
      tree.unmount();
    });
  });

  it('(-) omits streaming bubble when loading=false and renders empty messages array without crashing', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <CoachMessageList
          messages={[]}
          hasOlder={false}
          onLoadOlder={jest.fn()}
          copiedId={null}
          speakingId={null}
          onCopy={jest.fn()}
          onSpeak={jest.fn()}
          loading={false}
          streamingReply="Eski akış kalıntısı"
        />,
      );
    });

    const progress = tree.root.findAllByType(View).filter((v) => v.props.accessibilityRole === 'progressbar');
    expect(progress).toHaveLength(0);
    expect(tree.root.findAllByType(Text)).toHaveLength(0);

    act(() => {
      tree.unmount();
    });
  });
});
