import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

type GoogleCalendarConnection = {
  calendarId: string;
  calendarName: string;
};

type GoogleCalendarSyncStatus = 'idle' | 'connecting' | 'success' | 'error';

type GoogleCalendarStore = {
  connection: GoogleCalendarConnection | null;
  status: GoogleCalendarSyncStatus;
  error: string | null;
  /**
   * Is the integration usable AT ALL on this deployment?
   *
   * `null` until asked. Distinct from `connection === null`, which only means
   * this user has not linked an account. Conflating the two is what let the
   * app offer a Connect button for a function that was not deployed and a
   * table that did not exist: every call 404'd, `fetchStatus`'s catch turned
   * that into `status: 'idle'`, and the UI showed a healthy "not connected
   * yet". Fail closed instead -- an unconfigured integration is presented as
   * unavailable.
   */
  available: boolean | null;
  fetchStatus: () => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
};

const SUPABASE_FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const REDIRECT_URI = Linking.createURL('google-calendar-callback');

export const useGoogleCalendarStore = create<GoogleCalendarStore>((set, get) => ({
  connection: null,
  status: 'idle',
  error: null,
  available: null,

  fetchStatus: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      // A 404 means the function is not deployed at all -- which is exactly
      // what shipped for months. Treat it as unavailable, not as "idle".
      if (res.status === 404) {
        set({ connection: null, status: 'idle', available: false, error: null });
        return;
      }
      const data = await res.json();
      if (data.configured === false) {
        set({ connection: null, status: 'idle', available: false, error: null });
        return;
      }
      if (data.connected) {
        set({
          connection: {
            calendarId: data.calendar_id,
            calendarName: data.calendar_name ?? 'Google Takvim',
          },
          status: 'success',
          available: true,
          error: null,
        });
      } else {
        set({ connection: null, status: 'idle', available: true, error: null });
      }
    } catch {
      // Network/parse failure tells us nothing about configuration, so leave
      // `available` unknown rather than asserting either way.
      set({ connection: null, status: 'idle', error: null });
    }
  },

  connect: async () => {
    set({ status: 'connecting', error: null });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Oturum açmanız gerekiyor');

      const urlRes = await fetch(
        `${SUPABASE_FUNCTIONS_URL}/google-auth?action=url&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (urlRes.status === 404) {
        set({ available: false });
        throw new Error('Google Takvim bu kurulumda kullanılamıyor (sunucu bileşeni yayında değil).');
      }
      const urlBody = await urlRes.json();
      if (urlBody.configured === false || urlRes.status === 503) {
        set({ available: false });
        throw new Error(urlBody.error ?? 'Google Takvim yapılandırılmamış.');
      }
      const { url: oauthUrl, state } = urlBody;
      if (!oauthUrl) throw new Error(urlBody.error ?? 'OAuth URL alınamadı');

      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, REDIRECT_URI);
      if (result.type !== 'success' || !result.url) {
        set({ status: 'idle' });
        return false;
      }

      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string;
      if (!code) throw new Error('Yetkilendirme kodu alınamadı');

      // The `state` must go BACK to the callback so the server can verify it.
      // The previous version dropped it, which is why CSRF protection could
      // not have worked even once the server started checking: the client was
      // never returning the value being checked. The server is the only place
      // this comparison counts -- comparing it here would be the attacker's
      // own client checking itself.
      const callbackRes = await fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=callback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          redirect_uri: REDIRECT_URI,
          state: (parsed.queryParams?.state as string) ?? state,
        }),
      });

      const callbackData = await callbackRes.json();
      if (!callbackRes.ok) throw new Error(callbackData.error ?? 'Bağlantı kurulamadı');

      set({
        connection: {
          calendarId: callbackData.calendar_id,
          calendarName: callbackData.calendar_name ?? 'Google Takvim',
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

  disconnect: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=disconnect`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    set({ connection: null, status: 'idle', error: null });
  },
}));
