import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

export type NotionSyncStatus = 'idle' | 'connecting' | 'syncing' | 'success' | 'error';

type NotionConnection = {
  workspaceName: string;
  workspaceIcon: string | null;
  habitsUrl: string;
  tasksUrl: string;
};

type NotionStore = {
  connection: NotionConnection | null;
  status: NotionSyncStatus;
  lastSynced: string | null;
  error: string | null;
  _pendingOAuthUrl: string | null;
  fetchStatus: () => Promise<void>;
  prefetchAuthUrl: () => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  sync: (date?: string) => Promise<{ habits: number; tasks: number } | null>;
};

const SUPABASE_FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const REDIRECT_URI = Linking.createURL('notion-callback');

export const useNotionStore = create<NotionStore>((set, get) => ({
  connection: null,
  status: 'idle',
  lastSynced: null,
  error: null,
  _pendingOAuthUrl: null,

  // OAuth URL'ini önceden çek (modal açılırken çağrılır, gecikme olmadan anında bağlan)
  prefetchAuthUrl: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const res = await fetch(
        `${SUPABASE_FUNCTIONS_URL}/notion-auth?action=url&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      
      if (!res.ok) return; // Başarısız olsa da connect() üretecek
      
      const data = await res.json();
      if (data.url) {
        set({ _pendingOAuthUrl: data.url });
      }
    } catch {
      // sessizce geç, connect() kendi URL'ini üretecek
    }
  },

  // Mevcut bağlantı durumunu kontrol et
  fetchStatus: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        set({ connection: null, status: 'idle' });
        return;
      }
      
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/notion-auth?action=status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        set({ connection: null, status: 'idle', error: errorData.error });
        return;
      }
      
      const data = await res.json();
      if (data.connected && data.habits_url && data.tasks_url) {
        set({
          connection: {
            workspaceName: data.workspace_name ?? 'Notion',
            workspaceIcon: data.workspace_icon ?? null,
            habitsUrl: data.habits_url,
            tasksUrl: data.tasks_url,
          },
          status: 'success',
          error: null,
        });
      } else {
        set({ connection: null, status: 'idle', error: null });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ connection: null, status: 'idle', error: msg });
    }
  },

  // OAuth akışını başlat
  connect: async () => {
    set({ status: 'connecting', error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Oturum açmanız gerekiyor');

      // Önceden çekilen URL varsa kullan, yoksa şimdi çek
      let oauthUrl = get()._pendingOAuthUrl;
      if (!oauthUrl) {
        const urlRes = await fetch(
          `${SUPABASE_FUNCTIONS_URL}/notion-auth?action=url&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (!urlRes.ok) {
          const error = await urlRes.json();
          throw new Error(error.error ?? 'OAuth URL alınamadı');
        }
        const data = await urlRes.json();
        oauthUrl = data.url;
      }
      set({ _pendingOAuthUrl: null }); // kullanıldı, temizle

      // Tarayıcıda OAuth sayfasını aç
      const result = await WebBrowser.openAuthSessionAsync(oauthUrl!, REDIRECT_URI);

      if (result.type !== 'success') {
        set({ status: 'idle', error: null });
        return false;
      }

      // Callback URL'den code'u ayıkla
      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string;
      // Notion'un geri yansıttığı state. Doğrulama SUNUCUDA yapılır (1D-005);
      // istemcinin görevi yalnızca taşımak.
      const returnedState = parsed.queryParams?.state as string | undefined;
      if (!code) throw new Error('Yetkilendirme kodu alınamadı');
      if (!returnedState) throw new Error('OAuth state alınamadı');

      // Code'u token ile değiştir ve veritabanları kur
      const callbackRes = await fetch(`${SUPABASE_FUNCTIONS_URL}/notion-auth?action=callback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, redirect_uri: REDIRECT_URI, state: returnedState }),
      });
      
      if (!callbackRes.ok) {
        const errorData = await callbackRes.json();
        throw new Error(errorData.error ?? 'Bağlantı kurulamadı');
      }
      
      const callbackData = await callbackRes.json();
      if (!callbackData.success) {
        throw new Error(callbackData.error ?? 'Notion bağlantı başarısız');
      }

      set({
        connection: {
          workspaceName: callbackData.workspace_name ?? 'Notion',
          workspaceIcon: callbackData.workspace_icon ?? null,
          habitsUrl: callbackData.habits_url ?? '',
          tasksUrl: callbackData.tasks_url ?? '',
        },
        status: 'success',
        error: null,
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: 'error', error: msg });
      return false;
    }
  },

  // Bağlantıyı kes
  disconnect: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        set({ connection: null, status: 'idle', lastSynced: null, error: null });
        return;
      }
      
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/notion-auth?action=disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Bağlantı kesme başarısız');
      }
      
      set({ connection: null, status: 'idle', lastSynced: null, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
      // Yine de local state'i temizle
      set({ connection: null, status: 'idle', lastSynced: null });
    }
  },

  // Veri senkronizasyonu
  sync: async (date) => {
    const connection = get().connection;
    if (!connection) { 
      set({ status: 'error', error: 'Önce Notion\'a bağlanın' }); 
      return null; 
    }
    
    set({ status: 'syncing', error: null });
    try {
      const { data, error } = await supabase.functions.invoke('notion-sync', {
        body: { date },
      });
      
      if (error) {
        throw new Error(error.message || 'Senkronizasyon hatası');
      }
      
      if (!data) {
        throw new Error('Senkronizasyon sonuç alınamadı');
      }
      
      const now = new Date().toLocaleString('tr-TR');
      set({ 
        status: 'success', 
        lastSynced: now, 
        error: null 
      });
      
      return { 
        habits: data.synced_habits || 0, 
        tasks: data.synced_tasks || 0 
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: 'error', error: msg });
      return null;
    }
  },
}));
