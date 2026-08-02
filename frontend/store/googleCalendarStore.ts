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

  fetchStatus: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.connected) {
        set({
          connection: {
            calendarId: data.calendar_id,
            calendarName: data.calendar_name ?? 'Google Takvim',
          },
          status: 'success',
          error: null,
        });
      } else {
        set({ connection: null, status: 'idle', error: null });
      }
    } catch {
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
      const { url: oauthUrl } = await urlRes.json();
      if (!oauthUrl) throw new Error('OAuth URL alınamadı');

      const result = await WebBrowser.openAuthSessionAsync(oauthUrl, REDIRECT_URI);
      if (result.type !== 'success' || !result.url) {
        set({ status: 'idle' });
        return false;
      }

      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string;
      if (!code) throw new Error('Yetkilendirme kodu alınamadı');

      const callbackRes = await fetch(`${SUPABASE_FUNCTIONS_URL}/google-auth?action=callback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
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
