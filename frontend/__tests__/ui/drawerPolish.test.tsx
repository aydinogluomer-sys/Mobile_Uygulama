import React from 'react';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
let mockPathname = '/tabs/today';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  usePathname: () => mockPathname,
}));

jest.mock('../../components/seasonalMotion/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'test@aderyth.app' })),
}));

import Drawer, { drawerWidth, shouldRenderDrawer } from '../../components/Drawer';
import { visibleDestinations } from '../../lib/destinations';
import { useDrawerStore } from '../../store/drawerStore';
import { useDisclosureStore } from '../../store/disclosureStore';

type JsonNode = TestRenderer.ReactTestRendererJSON;

function collectStrings(tree: TestRenderer.ReactTestRenderer): string[] {
  const out: string[] = [];
  const walk = (n: JsonNode | string | null): void => {
    if (!n) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out;
}

describe('F28 (NAV-11, NAV-21) — drawerPolish', () => {
  afterEach(() => {
    useDrawerStore.setState({ isOpen: false, moreOpen: null, hydrated: true });
    useDisclosureStore.setState({ stage: 'first_day' });
    mockPush.mockReset();
    mockNavigate.mockReset();
    mockPathname = '/tabs/today';
  });

  it('(+) shouldRenderDrawer keeps native closing animation mounted and web offscreen mounted', () => {
    expect(shouldRenderDrawer({ platform: 'ios', isOpen: false, mounted: true })).toBe(true);
    expect(shouldRenderDrawer({ platform: 'android', isOpen: false, mounted: false })).toBe(false);
    expect(shouldRenderDrawer({ platform: 'ios', isOpen: true, mounted: false })).toBe(true);
    expect(shouldRenderDrawer({ platform: 'web', isOpen: false, mounted: false })).toBe(true);
  });

  it('(+) drawerWidth leaves ~45dp backdrop on 320dp and caps at 310dp on wider screens', () => {
    expect(drawerWidth(320)).toBe(275);
    expect(drawerWidth(360)).toBe(310);
    expect(drawerWidth(411)).toBe(310);
  });

  it('(+) renders all 8 core destinations, collapses "Daha fazla" on first_day, and expands on established', async () => {
    useDrawerStore.setState({ isOpen: true, moreOpen: null, hydrated: true, userId: 'u1' });
    useDisclosureStore.setState({ stage: 'first_day' });

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Drawer />);
    });

    const texts = collectStrings(tree);
    const coreItems = visibleDestinations('drawer').filter((d) => d.tier === 'core');
    expect(coreItems).toHaveLength(8);
    for (const coreItem of coreItems) {
      expect(texts).toContain(coreItem.label);
    }
    // Non-core non-shortcut items stay hidden while "Daha fazla" is collapsed
    expect(texts).not.toContain('Puan Geçmişi');

    const toggleBtn = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) => typeof b.props.accessibilityLabel === 'string' && b.props.accessibilityLabel.startsWith('Daha fazla'));
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn?.props.accessibilityRole).toBe('button');
    expect(toggleBtn?.props.accessibilityState).toEqual({ expanded: false });

    // Switch disclosure stage to 'established' -> expanded defaults to true
    await act(async () => {
      useDisclosureStore.setState({ stage: 'established' });
    });
    const expandedBtn = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) => typeof b.props.accessibilityLabel === 'string' && b.props.accessibilityLabel.startsWith('Daha fazla'));
    expect(expandedBtn?.props.accessibilityState).toEqual({ expanded: true });

    const expandedTexts = collectStrings(tree);
    // Negative: no Triage row, no duplicate Keşfet (Hub), no gated Bağlantılar/Entegrasyonlar
    expect(expandedTexts.some((t) => /triage/i.test(t))).toBe(false);
    expect(expandedTexts.filter((t) => t === 'Keşfet')).toHaveLength(1);
    expect(expandedTexts).not.toContain('Entegrasyonlar');
    expect(expandedTexts).not.toContain('Bağlantılar');

    await act(async () => {
      tree.unmount();
    });
  });
});
