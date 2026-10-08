import { resetWebhookCache } from '../services/webhookService';
import { coreOutbox } from '../services/coreOutbox';
import PrivacyCover from '../components/PrivacyCover';
import { maybeRunDailyLocalBackup } from '../services/localBackupService';
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
// R02 — the task outbox is flushed on boot, on foreground and after a session refresh.
import { useTaskStore } from '../store/taskStore';
// R04 — reminders follow the schedule; their buttons act once.
import * as Notifications from 'expo-notifications';
import { useHabitStore } from '../store/habitStore';
import { registerReminderReconciler } from '../lib/notifications';
import { reconcileReminders, handleReminderResponse } from '../services/reminderService';
import { resolveOnboardingRouting, useOnboardingStore } from '../store/onboardingStore';
import OnboardingGate from '../components/onboarding/OnboardingGate';
import { installGlobalErrorHandlers } from '../lib/crashReporting';
import { initCrashReporting } from '../lib/sentryClient';
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

// Sentry, aynı gerekçeyle ve aynı anda: bir sink'i ilk render'dan SONRA
// bağlamak, boot sırasında olan çökmeyi -- yani en çok rapor edilmesi
// gereken çökmeyi -- kaçırırdı. `initCrashReporting` idempotent ve asla
// throw etmez; DSN yoksa false döner ve uygulama Sentry hiç yokmuş gibi
// davranır (geliştirmede console sink, üretimde sessizlik).
initCrashReporting();

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
  const hydrateOnboarding = useOnboardingStore((s) => s.hydrate);
  const onboardingHydration = useOnboardingStore((s) => s.hydrationState);
  const onboardingStatus = useOnboardingStore((s) => s.status);
  const onboardingLoadError = useOnboardingStore((s) => s.loadError);
  const personalizing = useOnboardingStore((s) => s.personalizing);

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
      // R02 — the task outbox: what the previous session could not deliver.
      void useTaskStore.getState().flush();
      // R02.03 — the core outbox (journal, notes, recovery plans, focus sessions).
      void coreOutbox.flush();
      // R08.02 — the automatic local backup copy: at most once a day, only when the app is opened.
      void maybeRunDailyLocalBackup().catch(() => undefined);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      // R02.06 — the task outbox is per account. A sign-out drops this
      // account's tasks from memory (its unsent work stays saved under its
      // own key); a refreshed or new session may resume a paused outbox.
      if (event === 'SIGNED_OUT') { useTaskStore.getState().resetForAccount(); coreOutbox.reset(); }
      else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') { void useTaskStore.getState().authRefreshed(); void coreOutbox.authRefreshed(); }
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
   * Onboarding durumu HESABA bağlıdır, cihaza değil.
   *
   * Oturum göründüğünde sunucudan okunur; oturum bittiğinde sıfırlanır.
   * Sıfırlamamak, A hesabından çıkıp B hesabına girildiğinde B'yi A'nın
   * cevabıyla yönlendirirdi -- yeni bir kullanıcı onboarding'i hiç görmeden
   * Today'e düşerdi.
   *
   * Notion oturumu ile giren kullanıcının Supabase oturumu yoktur; okuma
   * `Oturum bulunamadı.` ile döner, `status` `'unknown'` kalır ve
   * `needsOnboarding` false olur -- yani Notion kullanıcısı onboarding'e
   * yönlendirilmez. Bu, tahmin değil kasıtlı güvenli taraf.
   */
  useEffect(() => {
    if (loading) return;
    if (session) {
      void hydrateOnboarding();
    } else {
      // Everything account-scoped, not just the status: the plan, the answers,
      // the personalization flag and the previous account's error all belong
      // to whoever just signed out.
      useOnboardingStore.getState().resetForAccount();
    }
  }, [session, loading, hydrateOnboarding]);

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
      if (next === 'active') {
        void flushPendingSync();
        void useTaskStore.getState().flush();
        // R04.04 — the plan is built from local dates at run time, so this
        // also re-plans after a timezone or DST change.
        void reconcileReminders(() => useHabitStore.getState().habits);
      }
    });
    return () => sub.remove();
  }, [loading, flushPendingSync]);

  /**
   * R04 — reminders. Signed in: the reconciler is registered (every store
   * call that used to set a DAILY trigger now asks for a re-plan), a re-plan
   * runs whenever the day's logs change (a done day stops being reminded),
   * and reminder buttons are handled -- including the one that launched the
   * app. Signed out: no reconciler, nothing planned.
   */
  useEffect(() => {
    if (loading || !session) { registerReminderReconciler(null); return; }
    const run = () => reconcileReminders(() => useHabitStore.getState().habits);
    registerReminderReconciler(run);
    void run();
    const unsubLogs = useLogStore.subscribe((s, prev) => { if (s.logs !== prev.logs) void run(); });
    // Status changes (activate / queue), breaks, holidays and goal versions
    // all change the habit list: re-plan.
    const unsubHabits = useHabitStore.subscribe((s, prev) => { if (s.habits !== prev.habits) void run(); });
    const deps = {
      get habits() { return useHabitStore.getState().habits; },
      logHabit: (p: { habitId: string; date: Date; state: 'done' | 'partial' | 'skip' | 'miss' }) => useLogStore.getState().logHabit(p),
      openMeasure: () => router.push('/tabs/timeline' as never),
      reconcile: run,
    };
    const respSub = Notifications.addNotificationResponseReceivedListener((r) => { void handleReminderResponse(r, deps); });
    void Notifications.getLastNotificationResponseAsync().then((r) => { if (r) void handleReminderResponse(r, deps); }).catch(() => undefined);
    return () => { unsubLogs(); unsubHabits(); respSub.remove(); registerReminderReconciler(null); };
  }, [loading, session, router]);

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
    // The decision itself is a pure function in `store/onboardingStore.ts`,
    // so every combination of session / hydration / status can be asserted
    // directly instead of by mounting a navigator and reading the source.
    const decision = resolveOnboardingRouting({
      hasSupabaseSession: !!session,
      hasAnySession: !!session || !!notionSession,
      hydrationState: onboardingHydration,
      status: onboardingStatus,
      inAuthGroup,
      inPasswordRecovery,
      inOnboarding: segmentPath[0] === 'onboarding',
      personalizing,
    });

    if (decision.kind === 'redirect') router.replace(decision.to);
    // 'wait' and 'gate' are handled by the render below; 'stay' does nothing.
  }, [session, notionSession, loading, segments, router, onboardingHydration, onboardingStatus, personalizing]);

  // §18: boot zinciri çözülene kadar HİÇBİR ekran render edilmez. Bu kozmetik
  // bir splash değil; "ilk dokunuştan önce hidrasyon" garantisini yapısal
  // yapan şeyin ta kendisi. Yönlendirme effect'i zaten `loading` ile
  // kapılıydı, dolayısıyla `router.replace` navigator mount edildikten sonra
  // (loading=false render'ının commit'ini takip eden effect fazında) çalışır.
  /**
   * Onboarding satırı okunamadıysa Today'e DÜŞÜLMEZ.
   *
   * Eski hali `hydrated` boolean'ıydı ve hata durumunda da true oluyordu;
   * router beklemeyi bırakıyor, `needsOnboarding('unknown')` false dönüyor ve
   * yeni kullanıcı, uygulama onboarding'e ihtiyacı olup olmadığını
   * ÖĞRENEMEDİĞİ hâlde Today'e ulaşıyordu.
   *
   * Sonsuz spinner da değil: kullanıcıya görünür bir yeniden-deneme var.
   */
  if (!!session && onboardingHydration === 'error') {
    return (
      <OnboardingGate
        error={onboardingLoadError}
        onRetry={() => { void hydrateOnboarding(); }}
      />
    );
  }

  // Aynı gerekçe §18'in kendi kapısında yazılı: karar verilemeyen bir anda
  // ekran GÖSTERMEMEK, yanlış ekranı gösterip düzeltmekten iyidir. Supabase
  // oturumu varken onboarding satırı okunana kadar bekleniyor; aksi halde
  // yeni kullanıcı önce boş bir Today görür, sonra onboarding'e atılırdı.
  if (loading || (!!session && onboardingHydration !== 'ready')) {
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
      {/* R06.05 — covers the app-switcher preview when "hide titles" is on */}
      <PrivacyCover />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="tabs" />
        <Stack.Screen name="habits" />
        <Stack.Screen name="screens" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" />
      </Stack>
    </ErrorBoundary>
  );
}
