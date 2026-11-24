import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import { callEdgeFunction, EdgeSessionError, invokeEdgeFunction } from '../services/edgeFunctions';
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

const REDIRECT_URI = Linking.createURL('notion-callback');

type NotionAuthBody = {
  url?: string;
  state?: string;
  connected?: boolean;
  habits_url?: string;
  tasks_url?: string;
  workspace_name?: string;
  workspace_icon?: string | null;
  success?: boolean;
  error?: string;
};

type NotionSyncSegment = { synced?: number; failed?: number; error?: string };
type NotionSyncBody = {
  success?: boolean;
  habits?: NotionSyncSegment;
  tasks?: NotionSyncSegment;
  synced_habits?: number;
  synced_tasks?: number;
  error?: string;
};

export const useNotionStore = create<NotionStore>((set, get) => ({
  connection: null,
  status: 'idle',
  lastSynced: null,
  error: null,
  _pendingOAuthUrl: null,

  // OAuth URL'ini önceden çek (modal açılırken çağrılır, gecikme olmadan anında bağlan)
  prefetchAuthUrl: async () => {
    try {
      const res = await callEdgeFunction<NotionAuthBody>('notion-auth', {
        label: 'Notion',
        action: 'url',
        query: { redirect_uri: REDIRECT_URI },
      });
      if (!res.ok) return; // Başarısız olsa da connect() üretecek
      if (res.body?.url) {
        set({ _pendingOAuthUrl: res.body.url });
      }
    } catch {
      // sessizce geç, connect() kendi URL'ini üretecek
    }
  },

  // Mevcut bağlantı durumunu kontrol et
  fetchStatus: async () => {
    try {
      const res = await callEdgeFunction<NotionAuthBody>('notion-auth', {
        label: 'Notion',
        action: 'status',
      });

      if (!res.ok) {
        set({ connection: null, status: 'idle', error: res.body?.error ?? null });
        return;
      }

      const data = res.body ?? {};
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
      if (e instanceof EdgeSessionError) {
        set({ connection: null, status: 'idle' });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      set({ connection: null, status: 'idle', error: msg });
    }
  },

  // OAuth akışını başlat
  connect: async () => {
    set({ status: 'connecting', error: null });
    try {
      // Önceden çekilen URL varsa kullan, yoksa şimdi çek
      let oauthUrl = get()._pendingOAuthUrl;
      if (!oauthUrl) {
        const urlRes = await callEdgeFunction<NotionAuthBody>('notion-auth', {
          label: 'Notion',
          action: 'url',
          query: { redirect_uri: REDIRECT_URI },
        });
        if (!urlRes.ok) {
          throw new Error(urlRes.body?.error ?? 'OAuth URL alınamadı');
        }
        oauthUrl = urlRes.body?.url ?? null;
        if (!oauthUrl) throw new Error('OAuth URL alınamadı');
      }
      set({ _pendingOAuthUrl: null }); // kullanıldı, temizle

      // Tarayıcıda OAuth sayfasını aç
      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, REDIRECT_URI);

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
      const callbackRes = await callEdgeFunction<NotionAuthBody>('notion-auth', {
        label: 'Notion',
        action: 'callback',
        method: 'POST',
        body: { code, redirect_uri: REDIRECT_URI, state: returnedState },
      });

      if (!callbackRes.ok) {
        throw new Error(callbackRes.body?.error ?? 'Bağlantı kurulamadı');
      }

      const callbackData = callbackRes.body ?? {};
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
      const res = await callEdgeFunction<NotionAuthBody>('notion-auth', {
        label: 'Notion',
        action: 'disconnect',
        method: 'POST',
      });

      if (!res.ok) {
        throw new Error(res.body?.error || 'Bağlantı kesme başarısız');
      }

      set({ connection: null, status: 'idle', lastSynced: null, error: null });
    } catch (e) {
      if (e instanceof EdgeSessionError) {
        set({ connection: null, status: 'idle', lastSynced: null, error: null });
        return;
      }
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
      const { data, error } = await invokeEdgeFunction<NotionSyncBody>('notion-sync', {
        label: 'Notion',
        body: { date },
      });
      
      if (error) {
        throw new Error(error.message || 'Senkronizasyon hatası');
      }
      
      if (!data) {
        throw new Error('Senkronizasyon sonuç alınamadı');
      }

      // `invoke` yalnız TAŞIMA hatasında `error` döndürür. Fonksiyon 200 ile
      // "hiçbir şey senkronize edilemedi" diyebilir -- deployed v1 tam olarak
      // bunu yapıyordu: habit_logs sorgusu var olmayan iki sütun istediği için
      // patlıyor, hata yutuluyor ve `{success:true, synced_habits:0}` dönüyordu.
      // Burada koşulsuz 'success' set etmek o sessiz hatayı kullanıcıya
      // "senkronize edildi" diye gösteren ikinci halkaydı. Artık gövdedeki
      // sonuç okunuyor.
      const habits = data.habits?.synced ?? data.synced_habits ?? 0;
      const tasks = data.tasks?.synced ?? data.synced_tasks ?? 0;
      const habitsFailed = data.habits?.failed ?? 0;
      const tasksFailed = data.tasks?.failed ?? 0;

      if (data.success === false || habitsFailed > 0 || tasksFailed > 0) {
        const parts: string[] = [];
        if (habitsFailed > 0) parts.push(`${habitsFailed} alışkanlık`);
        if (tasksFailed > 0) parts.push(`${tasksFailed} görev`);
        const detail = data.habits?.error ?? data.tasks?.error ?? data.error ?? null;
        const summary = parts.length
          ? `${parts.join(' ve ')} aktarılamadı`
          : 'Senkronizasyon tamamlanamadı';
        set({
          status: 'error',
          error: detail ? `${summary}: ${detail}` : summary,
          lastSynced: get().lastSynced,
        });
        return { habits, tasks };
      }

      const now = new Date().toLocaleString('tr-TR');
      set({
        status: 'success',
        lastSynced: now,
        error: null,
      });

      return { habits, tasks };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ status: 'error', error: msg });
      return null;
    }
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'notion', store: useNotionStore });
