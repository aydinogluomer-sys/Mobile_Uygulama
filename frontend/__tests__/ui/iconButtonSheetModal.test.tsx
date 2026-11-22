import React from 'react';
import { KeyboardAvoidingView, Modal, ScrollView, Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

let mockReduceMotion = false;
jest.setTimeout(30_000);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/seasonalMotion/useReducedMotion', () => ({
  useReducedMotion: () => mockReduceMotion,
}));

import { IconButton, SheetModal } from '../../components/ui';
import { ICON_BUTTON_MIN, iconButtonHitSlop } from '../../components/ui/IconButton';
import { sheetMaxHeight } from '../../components/ui/SheetModal';

class CatchBoundary extends React.Component<
  { onError: (err: Error) => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(err: Error): void {
    this.props.onError(err);
  }
  render(): React.ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

describe('F26 (DSA-10, NAV-15) — IconButton and SheetModal primitives', () => {
  const mounted: TestRenderer.ReactTestRenderer[] = [];

  beforeEach(() => {
    mockReduceMotion = false;
  });

  afterEach(async () => {
    await act(async () => {
      while (mounted.length > 0) {
        mounted.pop()!.unmount();
      }
    });
  });

  async function render(el: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(el);
    });
    mounted.push(r);
    return r;
  }

  it('(+) IconButton enforces >= 44dp touch target in both regular and compact modes and exposes role/label/state', async () => {
    expect(ICON_BUTTON_MIN).toBe(44);

    const onPress = jest.fn();
    const regular = await render(
      <IconButton icon="close" label="Ayarları kapat" selected onPress={onPress} />,
    );
    const btn = regular.root.findByType(TouchableOpacity);
    const regStyle = Object.assign({}, ...[btn.props.style].flat(3).filter(Boolean));
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe('Ayarları kapat');
    expect(btn.props.accessibilityState).toMatchObject({ disabled: false, selected: true });
    expect(regStyle.minWidth).toBeGreaterThanOrEqual(44);
    expect(regStyle.minHeight).toBeGreaterThanOrEqual(44);

    const compact = await render(
      <IconButton icon="trash-outline" label="Kısayolu kaldır" size={16} compact onPress={onPress} />,
    );
    const cBtn = compact.root.findByType(TouchableOpacity);
    const cStyle = Object.assign({}, ...[cBtn.props.style].flat(3).filter(Boolean));
    const slop = cBtn.props.hitSlop ?? { top: 0, bottom: 0, left: 0, right: 0 };
    expect(cStyle.minWidth + slop.left + slop.right).toBeGreaterThanOrEqual(44);
    expect(cStyle.minHeight + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    expect(iconButtonHitSlop(24)).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
  });

  it('(+) SheetModal renders nothing when hidden, wraps children in KeyboardAvoidingView + ScrollView when visible, and computes sheetMaxHeight', async () => {
    expect(sheetMaxHeight(800, 0.9)).toBe(720);
    expect(sheetMaxHeight(1000, 0.1)).toBe(300);
    expect(sheetMaxHeight(1000, 1.4)).toBe(1000);

    const hidden = await render(
      <SheetModal visible={false} onClose={() => {}}>
        <Text>Gizli Form</Text>
      </SheetModal>,
    );
    expect(hidden.toJSON()).toBeNull();

    const onClose = jest.fn();
    const shown = await render(
      <SheetModal visible onClose={onClose} accessibilityLabel="Yeni hedef formu">
        <Text>Görünür Form</Text>
      </SheetModal>,
    );

    const modal = shown.root.findByType(Modal);
    expect(modal.props.animationType).toBe('slide');
    const kav = shown.root.findByType(KeyboardAvoidingView);
    expect(kav).toBeDefined();
    const scroll = shown.root.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');

    const backdrop = shown.root.find(
      (n) => typeof n.type === 'string' && n.props?.accessible === false && typeof n.props?.onClick === 'function'
        || (n.props?.accessible === false && n.props?.focusable === false && 'onPress' in n.props),
    );
    expect(backdrop.props.accessible).toBe(false);
    await act(async () => {
      backdrop.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('(-) IconButton rejects blank labels; SheetModal honours closeOnBackdrop=false and forces animationType="none" under Reduce Motion', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const caught: Error[] = [];
    try {
      await render(
        <CatchBoundary onError={(e) => { caught.push(e); }}>
          <IconButton icon="close" label="   " onPress={() => {}} />
        </CatchBoundary>,
      );
      expect(caught).toHaveLength(1);
      expect(caught[0].message).toMatch(/non-empty label/i);
    } finally {
      spy.mockRestore();
    }

    mockReduceMotion = true;
    const onClose = jest.fn();
    const locked = await render(
      <SheetModal visible onClose={onClose} closeOnBackdrop={false} animationType="slide">
        <Text>Sabit Form</Text>
      </SheetModal>,
    );
    expect(locked.root.findByType(Modal).props.animationType).toBe('none');
    const backdrop = locked.root.find(
      (n) => n.props?.accessible === false && n.props?.focusable === false && 'onPress' in n.props,
    );
    await act(async () => {
      backdrop.props.onPress?.();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
