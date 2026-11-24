import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import { callEdgeFunction, EdgeSessionError } from '../services/edgeFunctions';
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

const REDIRECT_URI = Linking.createURL('google-calendar-callback');

type GoogleAuthBody = {
  configured?: boolean;
  connected?: boolean;
  calendar_id?: string;
  calendar_name?: string;
  url?: string;
  error?: string;
};

export const useGoogleCalendarStore = create<GoogleCalendarStore>((set) => ({
  connection: null,
  status: 'idle',
  error: null,
  available: null,

  fetchStatus: async () => {
    try {
      const res = await callEdgeFunction<GoogleAuthBody>('google-auth', {
        label: 'Google Takvim',
        action: 'status',
      });
      // A 404 means the function is not deployed at all -- which is exactly
      // what shipped for months. Treat it as unavailable, not as "idle".
      if (res.status === 404) {
        set({ connection: null, status: 'idle', available: false, error: null });
        return;
      }
      if (res.body === null) throw new Error('Geçersiz sunucu yanıtı');
      const data = res.body;
      if (data.configured === false) {
        set({ connection: null, status: 'idle', available: false, error: null });
        return;
      }
      if (data.connected) {
        set({
          connection: {
            calendarId: data.calendar_id ?? '',
            calendarName: data.calendar_name ?? 'Google Takvim',
          },
          status: 'success',
          available: true,
          error: null,
        });
      } else {
        set({ connection: null, status: 'idle', available: true, error: null });
      }
    } catch (e) {
      if (e instanceof EdgeSessionError) return;
      // Network/parse failure tells us nothing about configuration, so leave
      // `available` unknown rather than asserting either way.
      set({ connection: null, status: 'idle', error: null });
    }
  },

  connect: async () => {
    set({ status: 'connecting', error: null });
    try {
      const urlRes = await callEdgeFunction<GoogleAuthBody>('google-auth', {
        label: 'Google Takvim',
        action: 'url',
        query: { redirect_uri: REDIRECT_URI },
      });
      if (urlRes.status === 404) {
        set({ available: false });
        throw new Error('Google Takvim bu kurulumda kullanılamıyor (sunucu bileşeni yayında değil).');
      }
      const urlBody = urlRes.body ?? {};
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

      const callbackRes = await callEdgeFunction<GoogleAuthBody>('google-auth', {
        label: 'Google Takvim',
        action: 'callback',
        method: 'POST',
        body: { code, redirect_uri: REDIRECT_URI, state: returnedState },
      });

      const callbackData = callbackRes.body ?? {};
      if (!callbackRes.ok) throw new Error(callbackData.error ?? 'Bağlantı kurulamadı');

      set({
        connection: {
          calendarId: callbackData.calendar_id ?? '',
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
    // The response was previously discarded and the local connection cleared
    // unconditionally. A 401 or a 500 therefore produced a UI that said
    // "not connected" while the Google refresh token was still sitting in
    // google_calendar_integrations — the app asserting a revocation that had
    // not happened, with no remaining affordance to retry it.
    try {
      const res = await callEdgeFunction<GoogleAuthBody>('google-auth', {
        label: 'Google Takvim',
        action: 'disconnect',
        method: 'POST',
      });
      if (!res.ok) {
        set({
          status: 'error',
          error: res.body?.error ?? `Bağlantı kesilemedi (HTTP ${res.status}). Bağlantı hâlâ etkin.`,
        });
        return;
      }
    } catch (e) {
      if (e instanceof EdgeSessionError) return;
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
