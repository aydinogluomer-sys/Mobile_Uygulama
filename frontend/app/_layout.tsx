import { resetWebhookCache } from '../services/webhookService';
import { coreOutbox } from '../services/coreOutbox';
// F05 (SYN-15) — the coordinator flushes waiting work while the app is open (one timer, no polling library).
import { syncFlushers } from '../services/unifiedOutbox';
import { startSyncCoordinator } from '../lib/syncCoordinator';
import PrivacyCover from '../components/PrivacyCover';
import { maybeRunDailyLocalBackup } from '../services/localBackupService';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, View, type AppStateStatus } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { publicEnvStatus, supabase, SUPABASE_CONFIG_ERROR } from '../lib/supabase';
import ConfigErrorScreen from '../components/ConfigErrorScreen';
// F06 (SYN-02, SYN-23, NAV-04) — a boot that survives an offline start, a hang and a missing config.
import { resolveBootSession, BOOT_WATCHDOG_MS } from '../lib/bootSession';
import { readStoredSession } from '../lib/session';
import { bindAuthAutoRefresh } from '../lib/authLifecycle';
import { flushPendingAuthStorage } from '../lib/authStorage';
import BootGate from '../components/BootGate';
import { signOutCurrentAccount } from '../services/accountService';
// F04 — one account boundary for everything account-scoped (stores, read cache, reminders, keys).
import { endAccountScope } from '../lib/accountScope';
import { StatusBar } from 'expo-status-bar';
import { useThemeColors, useThemeMode } from '../hooks/useThemeColors';
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
import { syncProfileTimeZone } from '../services/timeZoneSyncService';
import { resolveOnboardingRouting, useOnboardingStore } from '../store/onboardingStore';
import OnboardingGate from '../components/onboarding/OnboardingGate';
import { installGlobalErrorHandlers, reportError } from '../lib/crashReporting';
import { initCrashReporting } from '../lib/sentryClient';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import DialogHost from '../components/ui/DialogHost';

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

/**
 * F08 (BLD-02): a build without its public Supabase configuration shows a calm, static
 * "Yapılandırma eksik" screen instead of booting. The check sits OUTSIDE the component that holds
 * the hooks (Rules of Hooks: an early return before them would change the hook order), and
 * ConfigErrorScreen needs nothing that could itself fail (react-native and tokens only).
 */
export default function RootLayout() {
  if (!publicEnvStatus.ok) return <ConfigErrorScreen missing={publicEnvStatus.missing} />;
  return <RootLayoutInner />;
}

function RootLayoutInner() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();
  const loadTheme = useThemeStore((s) => s.load);
  const c = useThemeColors();
  const mode = useThemeMode();
  const notionSession = useNotionSessionStore((s) => s.session);
  const hydrateNotionSession = useNotionSessionStore((s) => s.hydrate);
  // Plan §18 offline senkron yaşam döngüsü. Seçici (selector) ile alınıyor:
  // bunlar store'un kararlı (stable) fonksiyon referansları, dolayısıyla
  // aşağıdaki effect'lerin bağımlılık dizisinde her render'da yeniden
  // tetiklenmeye yol açmazlar.
  const hydrateSyncQueue = useLogStore((s) => s.hydrateSyncQueue);
  const flushPendingSync = useLogStore((s) => s.flushPendingSync);
  // F05 (SYN-01): the habit-log queue follows the signed-in account on every auth event.
  const rebindSyncQueue = useLogStore((s) => s.rebindSyncQueue);
  const hydrateOnboarding = useOnboardingStore((s) => s.hydrate);
  const onboardingHydration = useOnboardingStore((s) => s.hydrationState);
  const onboardingStatus = useOnboardingStore((s) => s.status);
  const onboardingLoadError = useOnboardingStore((s) => s.loadError);
  const personalizing = useOnboardingStore((s) => s.personalizing);
  // F04: the user the app last saw. A SIGNED_OUT event carries no session, so whose state to
  // clear comes from here; it is set at boot and after every auth event.
  const lastUidRef = useRef<string | null>(null);
  // F06: effects that care about WHO is signed in depend on this, not on the Session object, which
  // is a new object on every TOKEN_REFRESHED (about once an hour).
  const sessionUid = session?.user?.id ?? null;
  const hasSupabaseSession = !!session;
  // F06 (NAV-04): "Tekrar dene" on a boot that runs past BOOT_WATCHDOG_MS restarts the boot effect.
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootStalled, setBootStalled] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let alive = true;
    setBootStalled(false);
    // F06 (NAV-04): a boot that hangs (a captive network, a storage read that never answers) ends
    // in a visible "Tekrar dene" after 12 s instead of an endless spinner.
    const watchdog = setTimeout(() => { if (alive) setBootStalled(true); }, BOOT_WATCHDOG_MS);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // F06 (SYN-02): offline with an expired token auth-js emits INITIAL_SESSION with no session.
      // The boot below may already have opened the app on the session stored on this device; a
      // null here must not throw that user out to the login screen. A real sign-out (including a
      // refresh token the server has revoked) arrives as SIGNED_OUT.
      if (!session && event !== 'SIGNED_OUT') return;
      setSession(session);
      // F04 (STO-01) — every account-scoped store, module map, the read cache and the reminders
      // are cleared through ONE registry (lib/accountScope.ts): on a sign-out, and when a different
      // user appears without one. Unsent work stays saved under its own account's key (R02.06).
      // A refreshed or new session may resume a paused outbox.
      const nextUid = session?.user?.id ?? null;
      const prevUid = lastUidRef.current;
      if (event === 'SIGNED_OUT') { void endAccountScope('signed_out', prevUid); }
      else if (prevUid && nextUid && prevUid !== nextUid) {
        void endAccountScope('user_changed', prevUid);
        // F05 (F04 finding a): the new account's own task and core outboxes are loaded and sent now,
        // not at the next foreground (endAccountScope cleared the old ones synchronously above)
        void useTaskStore.getState().authRefreshed();
        void coreOutbox.authRefreshed();
      }
      else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') { void useTaskStore.getState().authRefreshed(); void coreOutbox.authRefreshed(); }
      // F05 (SYN-01, STO-02): the habit-log queue is bound to whoever is signed in now: the previous
      // owner's work is saved under ITS key, the new owner's is loaded and flushed. The same user
      // again is a no-op. (This replaces F04's interim `hydrateSyncQueue()` on a user change.)
      if (event === 'SIGNED_OUT') { void rebindSyncQueue(null); }
      else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void rebindSyncQueue(nextUid);
      }
      lastUidRef.current = nextUid;
      // Webhook kayıtları oturum boyunca bellekte tutuluyor (tamamlama yolu
      // her tik'te PostgREST'e gitmesin diye). Hesap değişince o liste artık
      // yanlış sahibe ait; bırakılırsa A'nın uç noktasına B'nin tamamlaması
      // gider. Bir sonraki gönderimde yeniden okunur.
      resetWebhookCache();
    });

    (async () => {
      // F06 (NAV-04, SYN-23): the boot chain cannot end without opening the gate. Before F06 a
      // rejected hydration or getSession() left `loading` true forever (no try/finally).
      try {
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
        // F06: allSettled -- one rejected hydration no longer blocks the other or the boot.
        const settled = await Promise.allSettled([hydrateNotionSession(), hydrateSyncQueue()]);
        for (const r of settled) if (r.status === 'rejected') reportError(r.reason, 'manual', 'boot-hydrate');
        // F06 (SYN-02): getSession() bounded at 8 s; offline with an expired token the session stored
        // on this device opens the app (local work only; auth-js refreshes when the network is back).
        const boot = await resolveBootSession({
          getSession: () => supabase.auth.getSession(),
          readStored: readStoredSession,
        });
        if (!alive) return;
        const session = boot.session;
        lastUidRef.current = session?.user?.id ?? null;
        setSession(session);
      } catch (e) {
        reportError(e, 'manual', 'boot');
      } finally {
        clearTimeout(watchdog);
        if (alive) { setBootStalled(false); setLoading(false); }
      }
      if (!alive) return;
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

    return () => {
      alive = false;
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
  }, [hydrateNotionSession, hydrateSyncQueue, flushPendingSync, rebindSyncQueue, loadTheme, bootAttempt]);

  /**
   * F06 (SYN-23): on native the auth-js refresh ticker runs only in the foreground, and a return to
   * the foreground retries any session write SecureStore refused (lib/authStorage.ts). On the web
   * auth-js follows tab visibility itself.
   */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    return bindAuthAutoRefresh(supabase, AppState, () => { void flushPendingAuthStorage(); });
  }, []);

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
  //
  // F06 (STO-04): keyed on the user id, not the Session object. A token refresh writes a new Session
  // about once an hour; re-hydrating on it lowered `ready` to `loading` and the whole navigator was
  // replaced by a spinner. (`hydrate` no longer lowers `ready` either: two independent defences.)
  useEffect(() => {
    if (loading) return;
    if (sessionUid) {
      void hydrateOnboarding();
    } else {
      // Everything account-scoped, not just the status: the plan, the answers,
      // the personalization flag and the previous account's error all belong
      // to whoever just signed out.
      useOnboardingStore.getState().resetForAccount();
    }
  }, [sessionUid, loading, hydrateOnboarding]);

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
   * F05 (SYN-15): ikisi hâlâ yok. Ama uygulama açıkken sinyalin geri gelmesi
   * de bir an: aşağıdaki koordinatör, YALNIZCA bekleyen iş varken tek bir
   * zamanlayıcı (aralıklı değil, geri çekilen) ve başarılı ağ yanıtı
   * sinyaliyle bunu yakalar. Bu dinleyici ön plan flush'ını yapmaya devam
   * eder; koordinatör ön plana dönüşte yalnızca zamanlayıcısını yeniden kurar.
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
        void coreOutbox.flush();
        // R04.04 — the plan is built from local dates at run time, so this
        // also re-plans after a timezone or DST change.
        void reconcileReminders(() => useHabitStore.getState().habits);
        // F06 (NAV-04): a status that came from the device cache (or a failed silent refresh) is
        // read again from the server, silently; the screen stays up whatever the answer.
        if (useOnboardingStore.getState().staleStatus) void hydrateOnboarding();
      }
    });
    return () => sub.remove();
  }, [loading, flushPendingSync, hydrateOnboarding]);

  /**
   * F05 (SYN-15): the sync coordinator, beside (not instead of) the foreground
   * flush above. Boot and foreground were the only moments a queued write was
   * retried; a phone that regained signal in the user's hand sent nothing until
   * the app was reopened. The coordinator owns ONE timer, armed only while work
   * is waiting and the app is in the foreground (it backs off while nothing
   * moves), and it flushes shortly after a successful network answer. Signed
   * out there is nothing of anyone's to send, so it does not run.
   */
  useEffect(() => {
    if (loading || !sessionUid) return;
    const coordinator = startSyncCoordinator(syncFlushers());
    return () => coordinator.stop();
  }, [loading, sessionUid]);

  /**
   * R04 — reminders. Signed in: the reconciler is registered (every store
   * call that used to set a DAILY trigger now asks for a re-plan), a re-plan
   * runs whenever the day's logs change (a done day stops being reminded),
   * and reminder buttons are handled -- including the one that launched the
   * app. Signed out: no reconciler, nothing planned.
   */
  // F06: keyed on the user id -- an hourly token refresh no longer tears down and re-registers the
  // notification listeners and re-plans every reminder.
  useEffect(() => {
    if (loading || !sessionUid) { registerReminderReconciler(null); return; }
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
  }, [loading, sessionUid, router]);

  // F15 -- the device zone is reported once per session and again when the app returns to the
  // foreground (a trip changes the zone). Silent by design: it never blocks, never shows UI.
  useEffect(() => {
    if (loading || !session) return;
    void syncProfileTimeZone();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void syncProfileTimeZone();
    });
    return () => sub.remove();
  }, [loading, session]);

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
  //
  // F22 (NAV-06): computed in the component body (not inside the effect) because the
  // spinner below needs it too: recovery screens keep the navigator mounted while the
  // onboarding row is read.
  const segmentPath = segments as unknown as string[];
  const inAuthGroup = segmentPath[0] === '(auth)';
  const inPasswordRecovery = inAuthGroup && (
    segmentPath[1] === 'forgot-password' || segmentPath[1] === 'reset-password'
  );

  useEffect(() => {
    if (loading) return;

    // The decision itself is a pure function in `store/onboardingStore.ts`,
    // so every combination of session / hydration / status can be asserted
    // directly instead of by mounting a navigator and reading the source.
    const decision = resolveOnboardingRouting({
      hasSupabaseSession,
      hasAnySession: hasSupabaseSession || !!notionSession,
      hydrationState: onboardingHydration,
      status: onboardingStatus,
      inAuthGroup,
      inPasswordRecovery,
      inOnboarding: segmentPath[0] === 'onboarding',
      personalizing,
    });

    if (decision.kind === 'redirect') router.replace(decision.to);
    // 'wait' and 'gate' are handled by the render below; 'stay' does nothing.
  }, [hasSupabaseSession, notionSession, loading, segmentPath, inAuthGroup, inPasswordRecovery, router, onboardingHydration, onboardingStatus, personalizing]);

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
   *
   * F06 (NAV-04): ve bir kaçış -- "Oturumu kapat" / "Tekrar giriş yap" F04'ün
   * çıkış hizmetini çağırır (gönderilmemiş iş bu cihazda, bu hesap için kalır);
   * SIGNED_OUT olayı oturumu boşaltır ve yönlendirme giriş ekranına gider.
   * Sıra önemli: yapılandırma eksikse hiçbir şey çalışamaz; açılış 12 sn'yi
   * aştıysa "Tekrar dene"; sonra bu kapı; en son spinner.
   */
  if (SUPABASE_CONFIG_ERROR) return <BootGate variant="config" detail={SUPABASE_CONFIG_ERROR} />;
  if (loading && bootStalled) return <BootGate variant="stalled" onRetry={() => setBootAttempt((n) => n + 1)} />;
  if (!!session && onboardingHydration === 'error') {
    return (
      <OnboardingGate
        error={onboardingLoadError}
        onRetry={() => { void hydrateOnboarding(); }}
        onSignOut={() => {
          setSigningOut(true);
          void signOutCurrentAccount().finally(() => setSigningOut(false));
        }}
        signingOut={signingOut}
      />
    );
  }

  // Aynı gerekçe §18'in kendi kapısında yazılı: karar verilemeyen bir anda
  // ekran GÖSTERMEMEK, yanlış ekranı gösterip düzeltmekten iyidir. Supabase
  // oturumu varken onboarding satırı okunana kadar bekleniyor; aksi halde
  // yeni kullanıcı önce boş bir Today görür, sonra onboarding'e atılırdı.
  if (loading || (!!session && onboardingHydration !== 'ready')) {
    // F22 (NAV-06): a recovery screen stays mounted while the onboarding row is read;
    // unmounting it would drop the user out of the new-password form.
    if (loading || !inPasswordRecovery) {
      return (
        <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.primary} />
        </View>
      );
    }
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
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
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
      <DialogHost />
    </>
  );
}
