import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';
import { useThemeStore } from '../store/themeStore';
import { useNotionSessionStore } from '../store/notionSessionStore';

// Web OAuth popup callback'ini tamamla; aksi halde openAuthSessionAsync beklemede kalabilir.
WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const loadTheme = useThemeStore((s) => s.load);
  const notionSession = useNotionSessionStore((s) => s.session);
  const hydrateNotionSession = useNotionSessionStore((s) => s.hydrate);

  useEffect(() => {
    let alive = true;

    (async () => {
      loadTheme();
      await hydrateNotionSession();
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(session);
      setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [hydrateNotionSession, loadTheme]);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inPasswordRecovery = inAuthGroup && (
      segments[1] === 'forgot-password' || segments[1] === 'reset-password'
    );
    const hasAppSession = !!session || !!notionSession;

    if (!hasAppSession && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (hasAppSession && inAuthGroup && !inPasswordRecovery) {
      router.replace('/tabs/today');
    }
  }, [session, notionSession, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="tabs" />
      <Stack.Screen name="habits" />
      <Stack.Screen name="screens" options={{ headerShown: false }} />
    </Stack>
  );
}
