import { registerAccountScoped } from '../lib/accountScope';
import { withEdgeDeadline } from '../lib/edgeCall';
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
      const res = await withEdgeDeadline('Google Takvim', (signal) => fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=status`, { signal,
        headers: { Authorization: `Bearer ${session.access_token}` },
      }));
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

      const urlRes = await withEdgeDeadline('Google Takvim', (signal) => fetch(
        `${SUPABASE_FUNCTIONS_URL}/google-auth?action=url&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`, { signal, headers: { Authorization: `Bearer ${session.access_token}` } }
      ));
      if (urlRes.status === 404) {
        set({ available: false });
        throw new Error('Google Takvim bu kurulumda kullanılamıyor (sunucu bileşeni yayında değil).');
      }
      const urlBody = await urlRes.json();
      if (urlBody.configured === false || urlRes.status === 503) {
        set({ available: false });
        throw new Error(urlBody.error ?? 'Google Takvim yapılandırılmamış.');
      }
      const { url: oauthUrl } = urlBody;
      if (!oauthUrl) throw new Error(urlBody.error ?? 'OAuth URL alınamadı');

      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, REDIRECT_URI);
      if (result.type !== 'success' || !result.url) {
        set({ status: 'idle' });
        return false;
      }

      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string;
      // The state Google reflected back. Verification happens on the SERVER.
      //
      // Only the PROVIDER's value may be forwarded. An earlier version wrote
      // `parsed.queryParams?.state ?? state`, falling back to the state this
      // client had just been handed when the callback carried none — which
      // hands the server a value that always verifies and defeats the check
      // entirely. A callback without a state is a failed callback; the whole
      // point of the parameter is that it made the round trip through the
      // provider.
      const returnedState = parsed.queryParams?.state as string | undefined;
      if (!code) throw new Error('Yetkilendirme kodu alınamadı');
      if (!returnedState) throw new Error('OAuth state alınamadı');

      const callbackRes = await withEdgeDeadline('Google Takvim', (signal) => fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=callback`, { signal,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, redirect_uri: REDIRECT_URI, state: returnedState }),
      }));

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
    // The response was previously discarded and the local connection cleared
    // unconditionally. A 401 or a 500 therefore produced a UI that said
    // "not connected" while the Google refresh token was still sitting in
    // google_calendar_integrations — the app asserting a revocation that had
    // not happened, with no remaining affordance to retry it.
    try {
      const res = await withEdgeDeadline('Google Takvim', (signal) => fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=disconnect`, { signal,
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      }));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        set({
          status: 'error',
          error: body.error ?? `Bağlantı kesilemedi (HTTP ${res.status}). Bağlantı hâlâ etkin.`,
        });
        return;
      }
    } catch (e) {
      set({
        status: 'error',
        error: `Bağlantı kesilemedi: ${e instanceof Error ? e.message : String(e)}. Bağlantı hâlâ etkin.`,
      });
      return;
    }
    set({ connection: null, status: 'idle', error: null });
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'googleCalendar', store: useGoogleCalendarStore });
