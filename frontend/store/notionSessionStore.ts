import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { create } from 'zustand';

const STORAGE_KEY = 'atlas_notion_login_session';
const OAUTH_TIMEOUT_MS = 2 * 60 * 1000; // 2 dakika

const SUPABASE_FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
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
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      set({ session: JSON.parse(raw) as NotionLoginSession });
    } catch {
      set({ session: null });
    }
  },

  login: async () => {
    set({ loading: true, error: null });
    try {
      const urlRes = await fetch(`${SUPABASE_FUNCTIONS_URL}/notion-auth?action=url&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`);
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.url || !urlData.state) throw new Error(urlData.error ?? 'Notion bağlantı URL’i alınamadı');

      const result = await Promise.race([
        WebBrowser.openAuthSessionAsync(urlData.url, REDIRECT_URI),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Notion doğrulama zaman aşımına uğradı. Lütfen tekrar deneyin.')), OAUTH_TIMEOUT_MS);
        }),
      ]);
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

      const callbackRes = await fetch(`${SUPABASE_FUNCTIONS_URL}/notion-auth?action=callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: REDIRECT_URI, state: returnedState }),
      });
      const callbackData = (await callbackRes.json()) as NotionAuthCallback;
      if (!callbackRes.ok || !callbackData.success) {
        throw new Error(callbackData.error ?? 'Notion bağlantısı kurulamadı');
      }

      const nextSession: NotionLoginSession = {
        workspaceName: callbackData.workspace_name ?? 'Notion',
        workspaceIcon: callbackData.workspace_icon ?? null,
        workspaceId: callbackData.workspace_id ?? null,
        connectedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
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
      await AsyncStorage.removeItem(STORAGE_KEY);
      set({ session: null, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
    }
  },
}));