import React from 'react';
import { TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-linking', () => ({
  createURL: (p: string) => `aderyth://${p}`,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'test@aderyth.app' })),
  currentUserId: jest.fn(async () => 'u1'),
}));

jest.mock('../../services/accountService', () => ({
  deleteAccount: jest.fn(),
  signOutCurrentAccount: jest.fn(async () => ({ ok: true })),
  unsentChangeCount: jest.fn(() => 0),
}));

jest.mock('../../services/unifiedOutbox', () => ({
  flushAllOutboxes: jest.fn(async () => undefined),
}));

jest.mock('../../components/BadHabitsTracker', () => 'BadHabitsTracker');
jest.mock('../../components/RestorePanel', () => 'RestorePanel');
jest.mock('../../components/CsvImportPanel', () => 'CsvImportPanel');
jest.mock('../../components/OutboxStatusModal', () => 'OutboxStatusModal');
jest.mock('../../components/ObsidianExportModal', () => 'ObsidianExportModal');
jest.mock('../../components/SignOutConfirmModal', () => 'SignOutConfirmModal');

import SettingsScreen from '../../app/tabs/settings';
import AccountSection from '../../components/settings/AccountSection';
import { profileSegments } from '../../app/tabs/profile';
import { PUBLIC_SITE_URLS_LIVE } from '../../lib/featureGates';

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

describe('F28 (NAV-14, PRF-17) — settingsSections', () => {
  afterEach(() => {
    mockPush.mockReset();
    mockNavigate.mockReset();
  });

  it('(+) renders all 8 canonical sections in order and routes single "Bağlantılar" row to integrations', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SettingsScreen />);
    });

    const texts = collectStrings(tree);
    const expectedSections = [
      'Görünüm',
      'Araçlar',
      'Veri ve Gizlilik',
      'Hesap',
      'Kişiselleştirme',
      'Takip & Veri Araçları',
      'Bağlantılar',
      'Hakkında',
    ];

    let lastIdx = -1;
    for (const section of expectedSections) {
      const idx = texts.indexOf(section, lastIdx + 1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }

    // (-) Negative: legacy "Entegrasyonlar" section header and "Yakında" are absent
    expect(texts).not.toContain('Entegrasyonlar');
    expect(texts).not.toContain('Yakında');

    const connectionsRow = tree.root
      .findAllByType(TouchableOpacity)
      .find((b) => b.props.accessibilityLabel === 'Bağlantılar');
    expect(connectionsRow).toBeDefined();

    await act(async () => {
      connectionsRow?.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/screens/integrations');

    await act(async () => {
      tree.unmount();
    });
  });

  it('(-) hides integrations segment in Profile when gates are off, and gates external website links in AccountSection on PUBLIC_SITE_URLS_LIVE', async () => {
    expect(profileSegments(false).some((s) => s.key === 'integrations')).toBe(false);
    expect(profileSegments(true).some((s) => s.key === 'integrations')).toBe(true);

    expect(typeof PUBLIC_SITE_URLS_LIVE).toBe('boolean');
    let accTree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      accTree = TestRenderer.create(
        <AccountSection
          email="test@aderyth.app"
          onSignOut={jest.fn()}
          onDeleteAccount={jest.fn()}
        />,
      );
    });

    const accTexts = collectStrings(accTree);
    expect(accTexts).toContain('Gizlilik Politikası');
    expect(accTexts).toContain('Oturumu Kapat');
    expect(accTexts).toContain('Hesabı Sil');
    if (PUBLIC_SITE_URLS_LIVE) {
      expect(accTexts).toContain('Destek');
    } else {
      expect(accTexts).not.toContain('Destek');
    }

    await act(async () => {
      accTree.unmount();
    });
  });
});
