import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

jest.setTimeout(30_000);

type ScreenRegistration = {
  name: string;
  options?: {
    title?: string;
    href?: string | null;
    tabBarBadge?: number | string;
  };
};

const registeredScreens: ScreenRegistration[] = [];
const mockNavigate = jest.fn();
const mockPush = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/OutboxStatusModal', () => () => null);
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'u1@aderyth.app' })),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');

  function Screen(props: ScreenRegistration) {
    registeredScreens.push(props);
    if (props.options?.href === null) {
      return null;
    }
    const title = props.options?.title ?? props.name;
    const badge = props.options?.tabBarBadge;
    return (
      <RN.TouchableOpacity
        accessibilityRole="tab"
        accessibilityLabel={badge !== undefined ? `${title} (${badge})` : title}
      >
        <RN.Text>{title}</RN.Text>
        {badge !== undefined ? <RN.Text>{String(badge)}</RN.Text> : null}
      </RN.TouchableOpacity>
    );
  }

  function Tabs({
    screenOptions,
    children,
  }: {
    screenOptions?: {
      headerLeft?: () => React.ReactNode;
      headerRight?: () => React.ReactNode;
    };
    children: React.ReactNode;
  }) {
    return ReactActual.createElement(
      RN.View,
      null,
      screenOptions?.headerLeft ? screenOptions.headerLeft() : null,
      screenOptions?.headerRight ? screenOptions.headerRight() : null,
      children,
    );
  }

  return {
    useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
    Tabs: Object.assign(Tabs, { Screen }),
  };
});

import TabLayout from '../../app/tabs/_layout';
import { useCommandStore } from '../../store/commandStore';
import { useDisclosureStore } from '../../store/disclosureStore';
import { useDrawerStore } from '../../store/drawerStore';
import { useTaskStore } from '../../store/taskStore';
import {
  act,
  renderWithProviders,
  screen,
} from '../helpers/renderWithProviders';

void Text;
void TouchableOpacity;
void View;

describe('F48 C9 — TabLayout & Drawer behavioural IA contract (RNTL)', () => {
  beforeEach(() => {
    registeredScreens.length = 0;
    mockNavigate.mockClear();
    mockPush.mockClear();
    useDrawerStore.setState({ isOpen: false, moreOpen: false });
    useCommandStore.setState({ visible: false, pendingIntent: null });
    useDisclosureStore.setState(useDisclosureStore.getInitialState(), true);
    useTaskStore.setState({ tasks: [] });
  });

  it('(+) renders exactly 5 visible tabs in canonical IA order and keeps the 6 legacy routes hidden (href: null)', async () => {
    const r = renderWithProviders(<TabLayout />);
    await act(async () => {});

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual([
      'Bugün',
      'Plan',
      'Alışkanlıklar',
      'İçgörüler',
      'Profil',
    ]);

    const visibleNames = registeredScreens
      .filter((s) => s.options?.href !== null)
      .map((s) => s.name);
    const hiddenNames = registeredScreens
      .filter((s) => s.options?.href === null)
      .map((s) => s.name);

    expect(visibleNames).toEqual(['today', 'plan', 'timeline', 'insights', 'profile']);
    expect(hiddenNames).toEqual(
      expect.arrayContaining(['tasks', 'focus', 'stats', 'habits', 'hub', 'settings']),
    );
    await act(async () => {
      r.unmount();
    });
  });

  it('(+) HamburgerButton opens Drawer with all 4 secondary groups, and header search button opens CommandPalette', async () => {
    const r = renderWithProviders(<TabLayout />);
    await act(async () => {});

    await r.user.press(screen.getByRole('button', { name: 'Komut paletini aç veya ara' }));
    expect(useCommandStore.getState().visible).toBe(true);

    await r.user.press(screen.getByRole('button', { name: 'Menüyü aç' }));
    expect(useDrawerStore.getState().isOpen).toBe(true);

    await r.user.press(screen.getByRole('button', { name: 'Daha fazla' }));
    for (const group of ['PLANLAMA', 'ALIŞKANLIKLAR', 'KİŞİSEL', 'SİSTEM']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    await act(async () => {
      r.unmount();
    });
  });

  it('(-) Plan tab omits inbox badge when inbox is empty and shows exact open inbox count when populated', async () => {
    const r1 = renderWithProviders(<TabLayout />);
    await act(async () => {});
    expect(screen.getByRole('tab', { name: 'Plan' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /^Plan \(/ })).toBeNull();
    await act(async () => {
      r1.unmount();
    });

    useTaskStore.setState({
      tasks: [
        {
          id: 't1',
          user_id: 'u1',
          title: 'Açık görev',
          status: 'pending',
          priority: 'none',
          list_type: 'inbox',
          completed: false,
          created_at: '2026-10-31',
        } as any,
        {
          id: 't2',
          user_id: 'u1',
          title: 'Biten görev',
          status: 'completed',
          priority: 'none',
          list_type: 'inbox',
          completed: true,
          created_at: '2026-10-31',
        } as any,
      ],
    });

    const r2 = renderWithProviders(<TabLayout />);
    await act(async () => {});
    expect(screen.getByRole('tab', { name: 'Plan (1)' })).toBeTruthy();
    await act(async () => {
      r2.unmount();
    });
  });
});
