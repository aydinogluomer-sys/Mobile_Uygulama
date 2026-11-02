import { registerAccountScoped } from '../lib/accountScope';
import { withEdgeDeadline } from '../lib/edgeCall';
import { SPOTIFY_OAUTH_ENABLED, SPOTIFY_OAUTH_DISABLED_REASON } from '../lib/featureGates';
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

export type SpotifyConnection = {
  displayName: string;
  product: string | null; // 'premium' | 'free' | null
};

export type NowPlaying = {
  isPlaying: boolean;
  name: string;
  artists: string;
  albumArt: string | null;
  uri: string | null;
};

type SpotifyStatus = 'idle' | 'connecting' | 'success' | 'error';

type SpotifyStore = {
  connection: SpotifyConnection | null;
  status: SpotifyStatus;
  error: string | null;
  nowPlaying: NowPlaying | null;
  busy: boolean;

  fetchStatus: () => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  fetchNowPlaying: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  playContext: (uri: string) => Promise<string | null>; // hata anahtarı döner, null=başarı
};

const FN_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/spotify-auth';
const REDIRECT_URI = Linking.createURL('spotify-callback');

async function callFn(action: string, body?: Record<string, unknown>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Oturum açmanız gerekiyor');
  const res = await withEdgeDeadline('Spotify', (signal) => fetch(`${FN_URL}?action=${action}`, { signal,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  }));
  const parsed = await res.json().catch(() => ({}));
  // The HTTP status was previously discarded, so a 401/500 came back looking
  // exactly like a successful empty body and every caller read it as success.
  // Carried rather than thrown, because the playback actions legitimately
  // tolerate soft failures (`no_active_device`) — but `disconnect` must not.
  return { ...parsed, __ok: res.ok, __status: res.status };
}

export const useSpotifyStore = create<SpotifyStore>((set, get) => ({
  connection: null,
  status: 'idle',
  error: null,
  nowPlaying: null,
  busy: false,

  fetchStatus: async () => {
    try {
      const data = await callFn('status');
      if (data?.connected) {
        set({
          connection: { displayName: data.display_name ?? 'Spotify', product: data.product ?? null },
          status: 'success',
          error: null,
        });
      } else {
        set({ connection: null, status: 'idle', error: null });
      }
    } catch {
      set({ connection: null, status: 'idle' });
    }
  },

  connect: async () => {
    // ── The gate is HERE, not in the card ────────────────────────────────
    //
    // A disabled button is decoration: any other caller — a deep link, a
    // future screen, a test — would still walk into the flow. This is the
    // only function that starts an authorization, so it is the boundary.
    //
    // It returns BEFORE any network call, so no request reaches the
    // vulnerable deployed function and no browser session is opened. See
    // `lib/featureGates.ts` for the live evidence and the four conditions
    // that turn it back on.
    if (!SPOTIFY_OAUTH_ENABLED) {
      set({ status: 'error', error: SPOTIFY_OAUTH_DISABLED_REASON });
      return false;
    }

    set({ status: 'connecting', error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Oturum açmanız gerekiyor');

      const urlRes = await withEdgeDeadline('Spotify', (signal) => fetch(
        `${FN_URL}?action=url&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, { signal, method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' }
      ));
      const { url: oauthUrl, error } = await urlRes.json();
      if (!oauthUrl) throw new Error(error ?? 'OAuth URL alınamadı');

      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, REDIRECT_URI);
      if (result.type !== 'success' || !result.url) { set({ status: 'idle' }); return false; }

      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string;
      // Spotify'ın geri yansıttığı state. Doğrulama SUNUCUDA (1D-005).
      const returnedState = parsed.queryParams?.state as string | undefined;
      if (!code) throw new Error('Yetkilendirme kodu alınamadı');
      if (!returnedState) throw new Error('OAuth state alınamadı');

      const data = await callFn('callback', { code, redirect_uri: REDIRECT_URI, state: returnedState });
      if (!data?.success) throw new Error(data?.error ?? 'Bağlantı kurulamadı');

      set({
        connection: { displayName: data.display_name ?? 'Spotify', product: data.product ?? null },
        status: 'success',
        error: null,
      });
      return true;
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  disconnect: async () => {
    // Local state is cleared ONLY when the server confirms the row is gone.
    // Clearing it regardless told the user "disconnected" while their Spotify
    // refresh token was still stored server-side — the UI asserted a
    // revocation that had not happened, and there was no longer any button to
    // retry it with.
    try {
      const r = await callFn('disconnect');
      if (!r?.__ok) {
        set({ status: 'error', error: r?.error ?? `Bağlantı kesilemedi (HTTP ${r?.__status ?? '?'})` });
        return;
      }
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      return;
    }
    set({ connection: null, status: 'idle', error: null, nowPlaying: null });
  },

  fetchNowPlaying: async () => {
    if (!get().connection) return;
    try {
      const d = await callFn('now-playing');
      if (d?.track) {
        set({ nowPlaying: {
          isPlaying: !!d.is_playing,
          name: d.track.name,
          artists: d.track.artists,
          albumArt: d.track.album_art ?? null,
          uri: d.track.uri ?? null,
        } });
      } else {
        set({ nowPlaying: { isPlaying: false, name: '', artists: '', albumArt: null, uri: null } });
      }
    } catch { /* yoksay */ }
  },

  play: async () => { set({ busy: true }); try { await callFn('play'); } finally { set({ busy: false }); } await get().fetchNowPlaying(); },
  pause: async () => { set({ busy: true }); try { await callFn('pause'); } finally { set({ busy: false }); } await get().fetchNowPlaying(); },
  next: async () => { set({ busy: true }); try { await callFn('next'); } finally { set({ busy: false }); } setTimeout(() => get().fetchNowPlaying(), 400); },
  previous: async () => { set({ busy: true }); try { await callFn('previous'); } finally { set({ busy: false }); } setTimeout(() => get().fetchNowPlaying(), 400); },

  playContext: async (uri) => {
    set({ busy: true });
    try {
      const r = await callFn('play-context', { context_uri: uri });
      if (r?.ok) { setTimeout(() => get().fetchNowPlaying(), 500); return null; }
      return r?.error ?? 'error';
    } finally {
      set({ busy: false });
    }
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'spotify', store: useSpotifyStore });
