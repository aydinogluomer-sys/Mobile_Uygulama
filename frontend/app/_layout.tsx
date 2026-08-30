import { resetWebhookCache } from '../services/webhookService';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View, type AppStateStatus } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/tokens';
import { useThemeStore } from '../store/themeStore';
import { useNotionSessionStore } from '../store/notionSessionStore';
import { useLogStore } from '../store/logStore';
import { installGlobalErrorHandlers } from '../lib/crashReporting';
import ErrorBoundary from '../components/ui/ErrorBoundary';

// Web OAuth popup callback'ini tamamla; aksi halde openAuthSessionAsync beklemede kalabilir.
WebBrowser.maybeCompleteAuthSession();

// §24 "crash reporting": global JS hata yakalayıcıları, MODÜL yüklenirken
// kurulur -- bir effect'in içinde DEĞİL. Sebep: bir effect en erken ilk
// render COMMIT edildikten sonra çalışır, oysa bu dosyanın kendi import
// zincirinde (supabase istemcisi, store'ların modül seviyesi kurulumu) veya
// ilk render'ın kendisinde atılan bir hata o ana kadar çoktan olup biter ve
// yakalayıcı olmadan kaybolur. Boot çökmesi tam da en çok rapor edilmesi
// gereken çökme türüdür.
//
// `installGlobalErrorHandlers` idempotent (bkz. kendi dokümanı), dolayısıyla
// Fast Refresh sırasında modülün yeniden değerlendirilmesi olayları
// ikiye katlamaz.
installGlobalErrorHandlers();

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const loadTheme = useThemeStore((s) => s.load);
  const notionSession = useNotionSessionStore((s) => s.session);
  const hydrateNotionSession = useNotionSessionStore((s) => s.hydrate);
  // Plan §18 offline senkron yaşam döngüsü. Seçici (selector) ile alınıyor:
  // bunlar store'un kararlı (stable) fonksiyon referansları, dolayısıyla
  // aşağıdaki effect'lerin bağımlılık dizisinde her render'da yeniden
  // tetiklenmeye yol açmazlar.
  const hydrateSyncQueue = useLogStore((s) => s.hydrateSyncQueue);
  const flushPendingSync = useLogStore((s) => s.flushPendingSync);

  useEffect(() => {
    let alive = true;

    (async () => {
      loadTheme();
      // §18: hidrasyon İLK `logHabit` çağrısından ÖNCE bitmek ZORUNDA.
      // `hydrateSyncQueue()` bellekteki kuyruğu diskteki ile DEĞİŞTİRİR --
      // hidrasyonun önüne geçen bir dokunuş sessizce ezilir (bkz.
      // store/logStore.ts'deki `hydrateSyncQueue` sözleşmesi). Bunu burada,
      // `loading`'i kapatan aynı awaited zincirin içinde beklemek + aşağıdaki
      // `if (loading)` erken dönüşü, yarışı "umut" ile değil YAPISAL olarak
      // imkânsız kılar: hidrasyon bitmeden ekranda dokunulacak bir alışkanlık
      // satırı render edilmez.
      //
      // Notion oturumu ile paralel: ikisi bağımsız store, biri diğerinin
      // sonucunu okumuyor; sıraya dizmek boot'u boş yere uzatırdı.
      await Promise.all([hydrateNotionSession(), hydrateSyncQueue()]);
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(session);
      setLoading(false);
      // §18 ilk replay: önceki oturumun kuyruğa alıp da onaylatamadığı
      // yazmalar. `void` bilinçli -- boot bunun sonucunu beklemez; başarısız
      // olursa op kuyrukta `pending` kalır ve bir sonraki tetikleyicide
      // yeniden denenir.
      void flushPendingSync();
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // Webhook kayıtları oturum boyunca bellekte tutuluyor (tamamlama yolu
      // her tik'te PostgREST'e gitmesin diye). Hesap değişince o liste artık
      // yanlış sahibe ait; bırakılırsa A'nın uç noktasına B'nin tamamlaması
      // gider. Bir sonraki gönderimde yeniden okunur.
      resetWebhookCache();
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [hydrateNotionSession, hydrateSyncQueue, flushPendingSync, loadTheme]);

  /**
   * §18: uygulama ön plana döndüğünde replay.
   *
   * Kuyruktaki bir yazmanın gerçek tetikleyicisi "cihaz yeniden şans buldu"
   * anıdır; bunun ücretsiz ve bağımlılıksız iki sinyali var: boot (yukarıda)
   * ve `AppState -> 'active'`. Bilinçli olarak YOK:
   *  - polling timer: cebindeki telefonun sinyali geri gelmesi kullanıcının
   *    beklediği bir an değil; pil yakarak AppState'in zaten cevapladığı bir
   *    soruyu sormak olurdu.
   *  - ağ-durumu kütüphanesi (netinfo): yeni bir native bağımlılık, aynı
   *    kazanım için.
   *
   * `loading` bitmeden dinleyici kurulmaz: hidrasyon henüz kuyruğu diskten
   * yüklememişken tetiklenen bir flush boş kuyruk üzerinde çalışırdı --
   * zararsız ama anlamsız. Boot'un kendi flush'ı zaten hemen ardından geliyor.
   *
   * Aynı ana birden fazla 'active' olayı ya da boot flush'ı ile çakışma
   * tehlikesizdir: `flushPendingSync` içindeki re-entrancy koruması (bkz.
   * store/logStore.ts `flushInFlight`) fazladan çağrıyı uçuştaki geçişe
   * bağlar.
   */
  useEffect(() => {
    if (loading) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void flushPendingSync();
    });
    return () => sub.remove();
  }, [loading, flushPendingSync]);

  useEffect(() => {
    if (loading) return;

    // CI PARİTESİ (davranış değişikliği DEĞİL, yalnızca tipleme).
    //
    // `tsconfig.json` `.expo/types/**/*.ts`'i include ediyor ve orada duran
    // `router.d.ts` expo-router'ın ÜRETİLMİŞ typed-routes bildirimi. O dosya
    // `.gitignore`'da (frontend/.gitignore:7) ve yalnızca dev sunucusu
    // tarafından üretiliyor -- `npx expo export` bile yeniden yazmıyor.
    // Dolayısıyla temiz bir CI klonunda mevcut değil ve `useSegments()`
    // 1-elemanlı `[string]` tuple'ına düşüyor; `segments[1]` o durumda
    // TS2493 "tuple has no element at index 1" veriyor. Yerelde geçen,
    // CI'da kırmızı olan hata tam olarak buydu.
    //
    // Okumayı bir kez düz `string[]` üzerinden yapmak, üretilmiş bildirim
    // olsun olmasın aynı sonucu veriyor: dizi sınırının dışındaki bir okuma
    // JS'te zaten `undefined`, karşılaştırma da `false` -- yani parola
    // kurtarma muafiyeti bugünküyle birebir aynı çalışıyor.
    const segmentPath = segments as unknown as string[];
    const inAuthGroup = segmentPath[0] === '(auth)';
    const inPasswordRecovery = inAuthGroup && (
      segmentPath[1] === 'forgot-password' || segmentPath[1] === 'reset-password'
    );
    const hasAppSession = !!session || !!notionSession;

    if (!hasAppSession && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (hasAppSession && inAuthGroup && !inPasswordRecovery) {
      router.replace('/tabs/today');
    }
  }, [session, notionSession, loading, segments, router]);

  // §18: boot zinciri çözülene kadar HİÇBİR ekran render edilmez. Bu kozmetik
  // bir splash değil; "ilk dokunuştan önce hidrasyon" garantisini yapısal
  // yapan şeyin ta kendisi. Yönlendirme effect'i zaten `loading` ile
  // kapılıydı, dolayısıyla `router.replace` navigator mount edildikten sonra
  // (loading=false render'ının commit'ini takip eden effect fazında) çalışır.
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // §24 "crash reporting": navigator'ı saran sınır. Buradaki bir render
  // throw'u önceden TÜM ağacı boş ekrana düşürüyordu.
  //
  // `resetKeys` olarak `segments[0]` veriliyor, `segments`'in kendisi değil:
  // sınır bir kez bile kilitlenirse kullanıcının tek kurtuluşu uygulamayı
  // kapatmaktır, ama her rota değişiminde sıfırlamak da yanlış olurdu --
  // kırık ekrana geri dönmek fallback yerine aynı throw'u yeniden üretirdi.
  // Sekme/grup değişimi ("başka bir yere gittim") doğru granülerlik.
  return (
    <ErrorBoundary context="root-navigator" resetKeys={[segments[0]]}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="tabs" />
        <Stack.Screen name="habits" />
        <Stack.Screen name="screens" options={{ headerShown: false }} />
      </Stack>
    </ErrorBoundary>
  );
}
