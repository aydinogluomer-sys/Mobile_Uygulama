/**
 * The Notion login session belongs to the account that made it.
 *
 * It holds no token — workspace name, icon, id and a timestamp — so this is
 * not a credential leak. It is still account-scoped data: under the old
 * global key, the next account to sign in on a shared device read the
 * previous one's workspace NAME and rendered it as their own connection.
 *
 * The same shape of defect as the offline sync queue, and fixed the same
 * way, including the lossless one-time migration.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUserId: string | null = 'userA';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: mockUserId ? { user: { id: mockUserId }, access_token: 't' } : null },
      })),
    },
  },
}));

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `atlas://${p}`, parse: () => ({ queryParams: {} }) }));

import { useNotionSessionStore } from '../../store/notionSessionStore';

const SESSION_A = {
  workspaceName: "A's private workspace",
  workspaceIcon: null,
  workspaceId: 'ws-a',
  connectedAt: '2026-08-30T00:00:00.000Z',
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockUserId = 'userA';
  useNotionSessionStore.setState({ session: null, loading: false, error: null });
});

describe('one account cannot see another account connection', () => {
  it('B hydrates nothing from A key', async () => {
    await AsyncStorage.setItem(`atlas_notion_login_session:userA`, JSON.stringify(SESSION_A));

    mockUserId = 'userB';
    await useNotionSessionStore.getState().hydrate();

    expect(useNotionSessionStore.getState().session).toBeNull();
  });

  it("A's connection survives B signing in and out", async () => {
    // Isolation must not be achieved by destroying the other account's data.
    await AsyncStorage.setItem(`atlas_notion_login_session:userA`, JSON.stringify(SESSION_A));

    mockUserId = 'userB';
    await useNotionSessionStore.getState().hydrate();

    mockUserId = 'userA';
    await useNotionSessionStore.getState().hydrate();
    expect(useNotionSessionStore.getState().session?.workspaceName).toBe(SESSION_A.workspaceName);
  });

  it('signing out hydrates nothing', async () => {
    await AsyncStorage.setItem(`atlas_notion_login_session:userA`, JSON.stringify(SESSION_A));
    mockUserId = null;
    await useNotionSessionStore.getState().hydrate();
    expect(useNotionSessionStore.getState().session).toBeNull();
  });
});

describe('migration off the unscoped key loses nothing', () => {
  it('the first account after the upgrade adopts it, once', async () => {
    await AsyncStorage.setItem('atlas_notion_login_session', JSON.stringify(SESSION_A));

    mockUserId = 'userA';
    await useNotionSessionStore.getState().hydrate();
    expect(useNotionSessionStore.getState().session?.workspaceId).toBe('ws-a');
    expect(await AsyncStorage.getItem('atlas_notion_login_session')).toBeNull();

    // Consumed, so a second account inherits nothing.
    mockUserId = 'userB';
    await useNotionSessionStore.getState().hydrate();
    expect(useNotionSessionStore.getState().session).toBeNull();
  });

  it('a signed-out hydrate does not consume the legacy key', async () => {
    // Otherwise the first launch after an upgrade, before sign-in, would
    // throw the connection away.
    await AsyncStorage.setItem('atlas_notion_login_session', JSON.stringify(SESSION_A));
    mockUserId = null;
    await useNotionSessionStore.getState().hydrate();
    expect(await AsyncStorage.getItem('atlas_notion_login_session')).not.toBeNull();
  });
});
