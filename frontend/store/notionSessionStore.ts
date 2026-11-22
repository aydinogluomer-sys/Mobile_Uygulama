import { registerAccountScoped } from '../lib/accountScope';
import { currentUser } from '../lib/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { create } from 'zustand';
import { callEdgeFunction } from '../services/edgeFunctions';

/**
 * Per-account key.
 *
 * This used to be one global `atlas_notion_login_session`. It holds no token
 * — workspace name, icon, id and a timestamp — but on a shared device the
 * next account to sign in read the previous one's workspace NAME out of it
 * and rendered it as their own connection. Account-scoped data belongs under
 * an account-scoped key, whether or not it happens to be a credential.
 *
 * `null` when signed out: there is no account to store against, and reusing
 * the last one is the bug.
 */
const LEGACY_STORAGE_KEY = 'atlas_notion_login_session';

async function storageKey(): Promise<string | null> {
  const uid = (await currentUser())?.id;
  return uid ? `atlas_notion_login_session:${uid}` : null;
}
const OAUTH_TIMEOUT_MS = 2 * 60 * 1000; // 2 dakika

const REDIRECT_URI = Linking.createURL('notion-callback');

export type NotionLoginSession = {
  workspaceName: string;
  workspaceIcon: string | null;
  workspaceId: string | null;
  connectedAt: string;
};

type NotionLoginStore = {
  session: NotionLoginSession | null;
  loading: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  login: () => Promise<boolean>;
  logout: () => Promise<void>;
};

type NotionAuthCallback = {
  success: boolean;
  workspace_name?: string;
  workspace_icon?: string | null;
  workspace_id?: string | null;
  error?: string;
};

export const useNotionSessionStore = create<NotionLoginStore>((set, get) => ({
  session: null,
  loading: false,
  error: null,

  hydrate: async () => {
    try {
      const key = await storageKey();
      if (!key) { set({ session: null }); return; }

      const raw = await AsyncStorage.getItem(key);
      if (raw) { set({ session: JSON.parse(raw) as NotionLoginSession }); return; }

      // One-time migration off the unscoped key, adopted by the first account
      // to sign in after the upgrade and then removed — the same shape as the
      // sync queue's migration, and for the same reason: discarding it would
      // silently drop a connection the user still has.
      const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacy) { set({ session: null }); return; }
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
      await AsyncStorage.setItem(key, legacy);
      set({ session: JSON.parse(legacy) as NotionLoginSession });
    } catch {
      set({ session: null });
    }
  },

  login: async () => {
    set({ loading: true, error: null });
    try {
      const urlRes = await callEdgeFunction<{ url?: string; state?: string; error?: string }>('notion-auth', {
        label: 'Notion oturumu',
        action: 'url',
        query: { redirect_uri: REDIRECT_URI },
        auth: 'none',
      });
      const urlData = urlRes.body ?? {};
      if (!urlRes.ok || !urlData.url || !urlData.state) throw new Error(urlData.error ?? 'Notion bağlantı URL’i alınamadı');

      const oauthUrl = urlData.url;
      let oauthTimer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        WebBrowser.openAuthSessionAsync(oauthUrl, REDIRECT_URI),
        new Promise<never>((_, reject) => {
          oauthTimer = setTimeout(
            () => reject(new Error('Notion doğrulama zaman aşımına uğradı. Lütfen tekrar deneyin.')),
            OAUTH_TIMEOUT_MS,
          );
        }),
      ]).finally(() => {
        if (oauthTimer !== undefined) clearTimeout(oauthTimer);
      });
      if (result.type !== 'success') {
        set({ loading: false });
        return false;
      }

      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string | undefined;
      const returnedState = parsed.queryParams?.state as string | undefined;
      if (!code) throw new Error('Yetkilendirme kodu alınamadı');
      if (!returnedState) throw new Error('OAuth state alınamadı');

      // State artık SUNUCUDA doğrulanıyor (1D-005). Buradaki eski karşılaştırma
      // AsyncStorage'daki değeri gelen değerle kıyaslıyordu; CSRF senaryosunda
      // istemci saldırganın kontrolündedir, dolayısıyla o kontrol koruma değil
      // dekordu. İmza, son kullanma ve uid bağı callback'te doğrulanır.

      const callbackRes = await callEdgeFunction<NotionAuthCallback>('notion-auth', {
        label: 'Notion oturumu',
        action: 'callback',
        method: 'POST',
        body: { code, redirect_uri: REDIRECT_URI, state: returnedState },
        auth: 'none',
      });
      const callbackData = callbackRes.body;
      if (!callbackRes.ok || !callbackData?.success) {
        throw new Error(callbackData?.error ?? 'Notion bağlantısı kurulamadı');
      }

      const nextSession: NotionLoginSession = {
        workspaceName: callbackData.workspace_name ?? 'Notion',
        workspaceIcon: callbackData.workspace_icon ?? null,
        workspaceId: callbackData.workspace_id ?? null,
        connectedAt: new Date().toISOString(),
      };
      const key = await storageKey();
      if (key) await AsyncStorage.setItem(key, JSON.stringify(nextSession));
      set({ session: nextSession, loading: false, error: null });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ loading: false, error: msg });
      return false;
    }
  },

  logout: async () => {
    try {
      const key = await storageKey();
      if (key) await AsyncStorage.removeItem(key);
      set({ session: null, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
    }
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'notionSession', store: useNotionSessionStore });
