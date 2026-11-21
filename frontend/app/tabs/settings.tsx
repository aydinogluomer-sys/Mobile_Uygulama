import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { colors, ACCENTS, type AccentKey, alphaHex } from '../../lib/tokens';
import type { SeasonalMotionIntensity } from '../../components/seasonalMotion/types';
import {
  listWebhooks, registerWebhook, removeWebhook,
  type WebhookRow,
} from '../../services/webhookService';
import { buildBackup, isBackupComplete, renderBackup, MAX_ROWS, type ExportFormat } from '../../services/exportService';
import { shareOrDownload } from '../../lib/shareFile';
import { EXPORT_META } from '../../lib/focusReport';
import { todayLocal } from '../../lib/date';
import { deleteAccount, signOutCurrentAccount, unsentChangeCount } from '../../services/accountService';
import { flushAllOutboxes } from '../../services/unifiedOutbox';
import SignOutConfirmModal from '../../components/SignOutConfirmModal';
import { PUBLIC_SITE_URLS_LIVE, PUBLIC_SITE_URLS } from '../../lib/featureGates';
import { useRouter } from 'expo-router';
import BadHabitsTracker from '../../components/BadHabitsTracker';
import { useOnboardingStore } from '../../store/onboardingStore';
// F06 (PRF-03): the seeder is loaded through its __DEV__-only gate, never imported statically
import { loadDemoSeed } from '../../lib/demoSeedGate';
import IntegrationCategoryCard from '../../components/IntegrationCategoryCard';
// R08 — check an export and merge what is missing; never a full restore.
import RestorePanel from '../../components/RestorePanel';
import CsvImportPanel from '../../components/CsvImportPanel';
import OutboxStatusModal from '../../components/OutboxStatusModal';
import ObsidianExportModal from '../../components/ObsidianExportModal';
import { currentUser } from '../../lib/session';
import IntegrationItemCard from '../../components/IntegrationItemCard';
import {
  INTEGRATION_CATEGORIES,
  type IntegrationCategoryId,
} from '../../constants/integrations';
import { CURRENT_FEATURES, UPCOMING_FEATURES, type FeatureHighlight } from '../../constants/features';
import { reportError } from '../../lib/crashReporting';
import { AtmosphericScreenCanvas, ChapterDivider, EditorialBanner, EmbeddedFiligree, EmblemMedallion } from '../../components/ui';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

const SEASONAL_OPTIONS: { v: SeasonalMotionIntensity; l: string }[] = [
  { v: 'off', l: 'Kapalı' },
  { v: 'subtle', l: 'Hafif' },
  { v: 'normal', l: 'Normal' },
];

export default function SettingsScreen() {
  const { isDark, toggle: toggleTheme } = useThemeStore();
  const seasonalMotion = useThemeStore((st) => st.seasonalMotion);
  const setSeasonalMotion = useThemeStore((st) => st.setSeasonalMotion);
  const accent = useThemeStore((st) => st.accent);
  const setAccent = useThemeStore((st) => st.setAccent);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<IntegrationCategoryId | null>(
    null
  );
  const [categoryDetailVisible, setCategoryDetailVisible] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [showBadHabitsTracker, setShowBadHabitsTracker] = useState(false);
  const [showOutboxModal, setShowOutboxModal] = useState(false);
  const [showObsidianModal, setShowObsidianModal] = useState(false);
  const router = useRouter();
  const beginPersonalization = useOnboardingStore((s) => s.beginPersonalization);

  /**
   * Reopens the first-run flow on purpose.
   *
   * `beginPersonalization()` is what stops the router bouncing a finished
   * user straight back out (see `app/_layout.tsx`). Re-running the flow ADDS
   * a proposal the user must confirm; it never edits or deletes the habits
   * they already have -- the plan screen writes through the same install
   * pipeline, which only inserts.
   */
  function openPersonalization() {
    beginPersonalization();
    router.push('/onboarding/needs');
  }
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  // F04 (NAV-02) — a user-facing sign-out, confirmed in a modal that also works on the web.
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signOutUnsent, setSignOutUnsent] = useState(0);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    currentUser().then((u) => { if (alive) setAccountEmail(u?.email ?? null); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const loadWebhooks = async () => {
    const res = await listWebhooks();
    if (!res.ok) {
      // A failed read was previously swallowed into console.error, so the
      // list rendered empty and read as "you have none registered".
      Alert.alert('Hata', `Webhook'lar yüklenemedi: ${res.error}`);
      return;
    }
    setWebhooks(res.data);
  };

  const handleAddWebhook = async () => {
    const res = await registerWebhook({ url: webhookUrl });
    if (!res.ok) {
      Alert.alert('Hata', res.error);
      return;
    }
    setWebhookUrl('');
    setShowWebhookModal(false);
    await loadWebhooks();
    Alert.alert('Başarılı', 'Webhook eklendi!');
  };

  const handleExportData = async (format: ExportFormat) => {
    try {
      setExportingFormat(format);
      setExportNotice(null);

      // Built on the device from this account's own repositories. The three
      // endpoints this replaces read the entire database with no user filter
      // on a service with no authentication, and the Excel/CSV pair were
      // opened in the system browser -- see services/exportService.ts.
      // R08 — the manifest names the account, so the file can be checked later.
      const me = await currentUser();
      const backup = await buildBackup(new Date(), { userId: me?.id ?? null });
      const notices: string[] = [];

      // R08.02 — a collection cut at the row ceiling (MAX_ROWS) is said out loud too:
      // such a file is refused by the restore check, so it must not look complete.
      if (!isBackupComplete(backup)) {
        if (backup.truncated.length > 0) {
          notices.push(
            `Şu bölümler ${MAX_ROWS.toLocaleString('tr-TR')} kayıt sınırında kesildi: ${backup.truncated.join(', ')}. Bu dosya geri yükleme için kullanılamaz.`,
          );
          Alert.alert(
            'Dışa aktarım tam değil',
            `Şu bölümler ${MAX_ROWS.toLocaleString('tr-TR')} kayıt sınırında kesildi: ${backup.truncated.join(', ')}. Bu dosya geri yükleme için kullanılamaz; paylaşılan metin hangi bölümlerin eksik olduğunu yazıyor.`,
          );
        }
        if (backup.failed.length > 0) {
          notices.push(`Şu bölümler okunamadı: ${backup.failed.map((f) => f.collection).join(', ')}.`);
          Alert.alert(
            'Dışa aktarım eksik',
            `Şu bölümler okunamadı: ${backup.failed.map((f) => f.collection).join(', ')}.\n\n` +
              'Yine de paylaşabilirsiniz; dosya hangi bölümlerin eksik olduğunu yazıyor.',
          );
        }
      }

      const out = await shareOrDownload({
        filename: `aderyth-disa-aktarim-${todayLocal()}.${EXPORT_META[format].ext}`,
        mime: EXPORT_META[format].mime,
        content: renderBackup(backup, format),
        title: `Aderyth Veri Dışa Aktarımı (${format.toUpperCase()})`,
      });
      if (out === 'downloaded') {
        notices.push('Dosya indirildi.');
      } else if (out === 'too_large') {
        notices.push(
          'Dışa aktarım bu cihazın paylaşım menüsüne sığmayacak kadar büyük; JSON biçimini dene ya da web sürümünden indir.',
        );
      }
      const nextNotice = notices.filter(Boolean).join(' ');
      setExportNotice(nextNotice || null);
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNLOAD_UNAVAILABLE') {
        setExportNotice('Tarayıcın dosya indirmeyi engelledi; indirme iznini kontrol et.');
      } else {
        Alert.alert('Hata', 'Veriler dışa aktarılırken bir hata oluştu');
        setExportNotice('Veriler dışa aktarılırken bir hata oluştu.');
        // R10.03 — through the scrubbing funnel, never raw to the device log.
        reportError(error, 'manual', 'export');
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const handleOpenWebhookFromDetail = () => {
    setCategoryDetailVisible(false);
    setTimeout(() => {
      setSelectedCategoryId(null);
      loadWebhooks();
      setShowWebhookModal(true);
    }, 280);
  };

  /**
   * Delete the account, behind two deliberate taps.
   *
   * Two confirmations rather than one because the action is irreversible and
   * the first tap is a menu row -- but no further than two, and no
   * type-the-word ceremony: making deletion tedious is the dark pattern this
   * requirement exists to prevent. The wording states plainly what goes and
   * that it cannot be undone.
   *
   * Nothing is shown as done until `deleteAccount` returns ok; on success the
   * session ends and the root layout routes to the signed-out state on its
   * own, so this screen does not navigate.
   */
  const handleDeleteAccount = () => {
    if (deletingAccount) return;
    // R02.06 — unsent work is never deleted without the user being told.
    const unsent = unsentChangeCount();
    const unsentLine = unsent > 0 ? `\n\nBu cihazda henüz sunucuya gönderilmemiş ${unsent} değişiklik var; hesapla birlikte bunlar da silinecek.` : '';
    Alert.alert(
      'Hesabını Sil',
      'Hesabın ve Aderyth\'te saklanan kişisel verilerin silinecek: alışkanlıkların, kayıtların, görevlerin, notların, günlüğün, hedeflerin, odak seansların ve AI Koç sohbetlerin.' + unsentLine + '\n\nBu işlem geri alınamaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Devam Et',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Emin misin?',
              'Son onay. Hesabın kalıcı olarak silinecek ve verilerin geri getirilemeyecek.',
              [
                { text: 'Vazgeç', style: 'cancel' },
                {
                  text: 'Hesabımı Sil',
                  style: 'destructive',
                  onPress: async () => {
                    setDeletingAccount(true);
                    const res = await deleteAccount();
                    setDeletingAccount(false);
                    if (!res.ok) {
                      Alert.alert('Hesap silinemedi', res.error);
                    }
                    // On success there is nothing to show: the session is gone
                    // and the app is already on its way to the login screen.
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const handleSeedDemoData = async () => {
    const demo = loadDemoSeed();
    if (!demo) return;
    try {
      setSeedingDemo(true);
      const result = await demo.seedDemoData();
      Alert.alert(
        'Demo veri hazir',
        `Projeler: +${result.projects}\nGorevler: +${result.tasks}\nAliskanliklar: +${result.habits}\nLoglar: +${result.logs}\nOdak gorevleri: +${result.focusTasks}\nTelafi planlari: +${result.recoveryPlans}\nGunluk girdileri: +${result.journalEntries}`
      );
    } catch (error) {
      Alert.alert('Hata', 'Demo verileri eklenirken bir hata olustu.');
      reportError(error, 'manual', 'demo-seed');
    } finally {
      setSeedingDemo(false);
    }
  };

  const selectedCategory = selectedCategoryId
    ? INTEGRATION_CATEGORIES.find((c) => c.id === selectedCategoryId) ?? null
    : null;

  const renderFeatureItem = (item: FeatureHighlight) => (
    <View key={item.id} style={styles.featureItem}>
      <View style={[styles.featureIcon, { backgroundColor: `${item.color}20` }]}>
        <Ionicons name={item.icon as any} size={20} color={item.color} />
      </View>
      <View style={styles.featureInfo}>
        <Text style={styles.featureTitle}>{item.title}</Text>
        <Text style={styles.featureDescription}>{item.description}</Text>
      </View>
    </View>
  );

  const openSignOut = () => {
    if (deletingAccount || signingOut) return;
    setSignOutError(null);
    setSignOutUnsent(unsentChangeCount());
    setSignOutOpen(true);
  };

  /** Success needs no navigation: the root layout sees no session and routes to sign-in, as after a deletion. */
  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    const res = await signOutCurrentAccount();
    setSigningOut(false);
    if (!res.ok) { setSignOutError(res.error); return; }
    setSignOutOpen(false);
  };

  const handleSyncFirst = async () => {
    setSigningOut(true);
    try { await flushAllOutboxes(); } catch { /* the count below says what is still waiting */ }
    setSignOutUnsent(unsentChangeCount());
    setSigningOut(false);
  };

  const renderSettingItem = (
    icon: string,
    title: string,
    subtitle: string,
    onPress: () => void,
    // `string`, not the inferred literal type of the default. `colors` is
    // declared `as const`, so `color = colors.accent` typed this parameter as
    // the single value colors.accent and every other accent was a type error --
    // invisible while every call site happened to pass the default.
    color: string = colors.accent,
  ) => (
    <TouchableOpacity style={styles.settingItem} onPress={onPress}>
      <View style={styles.settingLeft}>
        <View style={[styles.settingIcon, { backgroundColor: color + '20' }]}>
          <Ionicons name={icon as any} size={24} color={color} />
        </View>
        <View style={styles.settingInfo}>
          <Text style={styles.settingTitle}>{title}</Text>
          <Text style={styles.settingSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AtmosphericScreenCanvas
        source={CANVASES.treasuryVault}
        textureSource={TEXTURES.linen}
        scrim={0.64}
        tintColor={colors.accent}
      />
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <EditorialBanner
            source={SCREEN_BANNERS.privacyVaultSeal}
            textureSource={TEXTURES.linen}
            eyebrow="SİSTEM & MAHREMİYET"
            title="Aderyth Ayarları"
            subtitle="Görünüm, yerel yedekleme ve hesap kontrol merkezi."
            accentColor={colors.accent}
            minHeight={94}
            style={{ marginBottom: 16 }}
            rightSlot={
              <EmblemMedallion
                source={SCREEN_BANNERS.privacyVaultSeal}
                size={44}
                unlocked
                accentColor={colors.accent}
              />
            }
          />
          <Text style={styles.title}>Ayarlar</Text>
          <Text style={styles.subtitle}>Uygulamanızı özelleştirin</Text>

          {/* Görünüm */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Görünüm</Text>
            <View style={styles.themeRow}>
              <View style={styles.themeLeft}>
                <Ionicons
                  name={isDark ? 'moon-outline' : 'sunny-outline'}
                  size={20}
                  color={isDark ? colors.accent : colors.warning}
                />
                <View>
                  <Text style={styles.themeLabel}>{isDark ? 'Koyu Tema' : 'Açık Tema'}</Text>
                  <Text style={styles.themeSubLabel}>
                    {isDark ? 'AMOLED dostu koyu arka plan' : 'Gündüz için açık arka plan'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: colors.border, true: alphaHex(colors.accent, '40') }}
                thumbColor={isDark ? colors.accent : colors.textDim}
              />
            </View>

            {/* Mevsimsel arka plan animasyonları (contract §13) */}
            <View style={styles.motionBlock}>
              <View style={styles.motionHead}>
                <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.themeLabel}>Arka plan animasyonları</Text>
                  <Text style={styles.themeSubLabel}>
                    Aylık takvim arka planlarında hafif mevsimsel hareketler gösterir.
                  </Text>
                </View>
              </View>
              <View style={styles.segRow}>
                {SEASONAL_OPTIONS.map((o) => {
                  const on = seasonalMotion === o.v;
                  return (
                    <TouchableOpacity
                      key={o.v}
                      style={[styles.segBtn, on && styles.segBtnOn]}
                      onPress={() => setSeasonalMotion(o.v)}
                    >
                      <Text style={[styles.segText, on && styles.segTextOn]}>{o.l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Aksan rengi (Atlas: clay/moss/slate/amber) */}
            <View style={styles.motionBlock}>
              <View style={styles.motionHead}>
                <Ionicons name="color-palette-outline" size={18} color={ACCENTS[accent].primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.themeLabel}>Aksan rengi</Text>
                  <Text style={styles.themeSubLabel}>
                    Birincil butonlar, sekme çubuğu ve Bugün başlığında kullanılır.
                  </Text>
                </View>
              </View>
              <View style={styles.accentRow}>
                {(Object.keys(ACCENTS) as AccentKey[]).map((k) => {
                  const a = ACCENTS[k];
                  const on = accent === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={styles.accentItem}
                      onPress={() => setAccent(k)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.accentDot, { backgroundColor: a.primary }, on && styles.accentDotOn]}>
                        {on && <Ionicons name="checkmark" size={16} color={colors.white} />}
                      </View>
                      <Text style={[styles.accentLabel, on && { color: a.primary, fontWeight: '700' }]}>{a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          <ChapterDivider source={DECOR.dividerSundial} label="VERİ KASASI & YEDEK" style={{ marginBottom: 18 }} />

          {/* Data & Privacy */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Veri ve Gizlilik</Text>
            
            <View style={styles.exportContainer}>
              <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.11} />
              <Text style={styles.exportTitle}>Verileri Dışa Aktar</Text>
              <Text style={styles.exportSubtitle}>
                Power BI, Excel veya diğer analiz araçlarında kullanabilirsiniz
              </Text>
              {/*
                Said out loud, in the UI, because the alternative is letting
                the word "yedek" imply a promise the app cannot keep. There is
                no import path: a file produced here cannot be loaded back.
                See services/exportService.ts for why a restore was not
                written rather than written badly.
              */}
              <Text style={styles.exportSubtitle}>
                Bu tam bir yedek değildir — tam geri yükleme yoktur. JSON dosyası
                aşağıda doğrulanıp eksik kayıtlar hesabına eklenebilir; alışkanlık
                kayıtları, odak oturumları ve webhook&apos;lar geri yüklenemez.
                Dışa aktarım tüm alışkanlık kayıtlarını (yapıldı, kısmen, atlandı, kaçırıldı) notlarıyla içerir.
              </Text>
              {/* R08.03 — the chosen protection boundary, said before sharing (docs/implementation-v3/R08_BACKUP_PROTECTION.md). */}
              <Text style={styles.exportSubtitle} accessibilityRole="text">
                Dosya şifrelenmez; içinde günlüğün ve notların var — yalnız güvendiğin bir yere kaydet.
                Oturum ve erişim anahtarları dosyaya hiç girmez.
              </Text>
              
              <View style={styles.exportButtons}>
                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'json' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('json')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'json' ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <>
                      <Ionicons name="code-outline" size={20} color={colors.accent} />
                      <Text style={styles.exportButtonText}>JSON</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'excel' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('excel')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'excel' ? (
                    <ActivityIndicator size="small" color={colors.success} />
                  ) : (
                    <>
                      <Ionicons name="document-outline" size={20} color={colors.success} />
                      <Text style={styles.exportButtonText}>Excel</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'csv' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('csv')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'csv' ? (
                    <ActivityIndicator size="small" color={colors.warning} />
                  ) : (
                    <>
                      <Ionicons name="list-outline" size={20} color={colors.warning} />
                      <Text style={styles.exportButtonText}>CSV</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              {exportNotice !== null && (
                <Text style={styles.exportNotice} accessibilityLiveRegion="polite">
                  {exportNotice}
                </Text>
              )}
              <RestorePanel />
              <CsvImportPanel />
            </View>

            {/* DEMO-001B - sadece gelistirme derlemesinde. Kaynak koruma
                lib/demoSeed.ts icindedir; bu yalnizca calismayacak bir
                kontrolu kullaniciya gostermemek icin. */}
            {__DEV__ && loadDemoSeed()?.isSeedingAllowed() === true && (
              <TouchableOpacity
                style={[styles.settingItem, seedingDemo && styles.seedBtnDisabled]}
                onPress={handleSeedDemoData}
                disabled={seedingDemo}
              >
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIcon, { backgroundColor: alphaHex(colors.success, '20') }]}>
                    <Ionicons name="flask-outline" size={24} color={colors.success} />
                  </View>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingTitle}>Demo verileri doldur</Text>
                    <Text style={styles.settingSubtitle}>Test icin gorev, aliskanlik, gunluk ve odak verisi ekler</Text>
                  </View>
                </View>
                {seedingDemo ? <ActivityIndicator size="small" color={colors.success} /> : <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />}
              </TouchableOpacity>
            )}
          </View>

          {/* Account — privacy policy and the deletion the stores require */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hesap</Text>

            {renderSettingItem(
              'shield-checkmark-outline',
              'Gizlilik Politikası',
              'Hangi verilerin saklanıyor ve neden',
              () => router.push('/screens/privacy'),
              colors.info
            )}

            {/*
              Destek, YALNIZCA sayfa gerçekten yayındayken gösterilir.
              `PUBLIC_SITE_URLS_LIVE` bugün false: aderyth.com açılıyor ama
              /support 404 dönüyor (2026-09-08 tarihinde ölçüldü). Açılmayan
              bir bağlantıyı ayarlara koymak, kullanıcıya görünür biçimde
              başarısız olan bir düğme koymaktır -- bu sürümde kaldırdığımız
              söz-verip-tutamama biçiminin ta kendisi. Sayfa yayına
              girdiğinde tek satır: lib/featureGates.ts.
            */}
            {PUBLIC_SITE_URLS_LIVE && renderSettingItem(
              'help-buoy-outline',
              'Destek',
              'Yardım, hesap ve teknik sorunlar',
              () => { Linking.openURL(PUBLIC_SITE_URLS.support).catch(() => {}); },
              colors.teal
            )}

            {/* F04 (NAV-02): signing out of THIS device, above the permanent deletion */}
            <TouchableOpacity
              style={[styles.settingItem, (deletingAccount || signingOut) && styles.seedBtnDisabled]}
              onPress={openSignOut}
              disabled={deletingAccount || signingOut}
              accessibilityRole="button"
              accessibilityLabel="Oturumu kapat"
              accessibilityHint="Hesabını bu cihazdan çıkarır"
              accessibilityState={{ disabled: deletingAccount || signingOut, busy: signingOut }}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: alphaHex(colors.info, '20') }]}>
                  <Ionicons name="log-out-outline" size={24} color={colors.info} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingTitle}>Oturumu Kapat</Text>
                  <Text style={styles.settingSubtitle}>{accountEmail ?? 'Bu cihazdan çık'}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.settingItem, deletingAccount && styles.seedBtnDisabled]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
              accessibilityRole="button"
              accessibilityLabel="Hesabı sil"
              accessibilityHint="Hesabını ve kişisel verilerini kalıcı olarak siler"
              accessibilityState={{ disabled: deletingAccount, busy: deletingAccount }}
            >
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: alphaHex(colors.error, '20') }]}>
                  <Ionicons name="trash-outline" size={24} color={colors.error} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.error }]}>Hesabı Sil</Text>
                  <Text style={styles.settingSubtitle}>
                    Hesabın ve verilerin kalıcı olarak silinir. Geri alınamaz.
                  </Text>
                </View>
              </View>
              {deletingAccount
                ? <ActivityIndicator size="small" color={colors.error} />
                : <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />}
            </TouchableOpacity>
          </View>

          {/* Personalization */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Kişiselleştirme</Text>

            {renderSettingItem(
              'sparkles',
              'Başlangıç tercihleri',
              'Hedeflerini, tempoyu ve hatırlatma tercihini güncelle',
              openPersonalization,
              colors.primary
            )}
          </View>

          {/* Tracking */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Takip & Veri Araçları</Text>
            
            {renderSettingItem(
              'ban',
              'Bıraktığım Alışkanlıklar',
              'Tasarruf ve ilerlemenizi görün',
              () => setShowBadHabitsTracker(true),
              colors.error
            )}

            {renderSettingItem(
              'document-text-outline',
              'Obsidian Markdown Aktarımı',
              'Alışkanlık ve notları Obsidian kasasına kopyala',
              () => setShowObsidianModal(true),
              colors.accent
            )}

            {renderSettingItem(
              'cloud-offline-outline',
              'Çevrimdışı Senkronizasyon',
              'Bekleyen yerel işlemleri ve sunucu bağlantısını incele',
              () => setShowOutboxModal(true),
              colors.teal
            )}
          </View>

          {/* Integrations */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Entegrasyonlar</Text>

            {INTEGRATION_CATEGORIES.map((category) => (
              <IntegrationCategoryCard
                key={category.id}
                category={category}
                onPress={() => {
                  setSelectedCategoryId(category.id);
                  setCategoryDetailVisible(true);
                }}
              />
            ))}
          </View>

          {/* About */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hakkında</Text>
            
            <View style={styles.infoCard}>
              <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.14} size={108} />
              <Text style={styles.appName}>Aderyth</Text>
              <Text style={styles.appVersion}>Versiyon 1.0.0</Text>
              <Text style={styles.appDescription}>
                Minimalist, bilimsel temelli alışkanlık takip uygulaması.
                Verileriniz tamamen sizin kontrolünüzde.
              </Text>
            </View>
          </View>

          {/* Features */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Özellikler</Text>
            <Text style={styles.featureSectionIntro}>
              Aderyth’in kendi alışkanlık motoru. Dış bağlantılar için Entegrasyonlar
              bölümüne bakın.
            </Text>
            <View style={styles.featureCard}>
              <Text style={styles.featureGroupTitle}>Şu an kullanabileceğiniz</Text>
              {CURRENT_FEATURES.map(renderFeatureItem)}
              <View style={styles.featureDivider} />
              <Text style={styles.featureGroupTitle}>Yakında</Text>
              {UPCOMING_FEATURES.map(renderFeatureItem)}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Webhook Modal */}
      <Modal
        visible={showWebhookModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowWebhookModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Webhook Ekle</Text>
              <TouchableOpacity onPress={() => setShowWebhookModal(false)}>
                <Ionicons name="close" size={28} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              {`Alışkanlık veya görev tamamlandığında otomatik olarak bu URL'e POST isteği gönderilecek.`}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="https://hooks.n8n.cloud/webhook/..."
              placeholderTextColor={colors.textFaint}
              value={webhookUrl}
              onChangeText={setWebhookUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {webhooks.length > 0 && (
              <View style={styles.webhookList}>
                <Text style={styles.webhookListTitle}>{`Mevcut Webhook'lar:`}</Text>
                {webhooks.map((webhook) => (
                  <View key={webhook.id} style={styles.webhookItem}>
                    <Text style={styles.webhookUrl} numberOfLines={1}>
                      {webhook.url}
                    </Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`${webhook.url} webhook'unu sil`}
                      onPress={async () => {
                        const res = await removeWebhook(webhook.id);
                        if (!res.ok) {
                          Alert.alert('Hata', res.error);
                          return;
                        }
                        await loadWebhooks();
                      }}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={styles.addButton} onPress={handleAddWebhook}>
              <Text style={styles.addButtonText}>Webhook Ekle</Text>
            </TouchableOpacity>

            <Text style={styles.helpText}>
              💡 Örnek Payload:{' \n'}
              {JSON.stringify(
                {
                  event: 'habit_completed',
                  data: { habit_name: 'Spor', strength_score: 85 },
                },
                null,
                2
              )}
            </Text>
          </View>
        </View>
      </Modal>

      {/* Category Detail Modal */}
      <Modal
        visible={categoryDetailVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setCategoryDetailVisible(false);
          setSelectedCategoryId(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => {
                  setCategoryDetailVisible(false);
                  setSelectedCategoryId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Geri"
              >
                <Ionicons name="chevron-back" size={28} color={colors.textDim} />
              </TouchableOpacity>
              {selectedCategory ? (
                <View style={styles.categoryModalHeaderText}>
                  <Text style={styles.modalTitle}>{selectedCategory.title}</Text>
                  <Text style={styles.modalDescription} numberOfLines={2}>
                    {selectedCategory.description}
                  </Text>
                </View>
              ) : null}
              <View style={styles.categoryModalHeaderSpacer} />
            </View>

            {selectedCategory ? (
              <ScrollView
                style={styles.categoryDetailScroll}
                showsVerticalScrollIndicator={false}
              >
                {selectedCategory.items.map((item) => (
                  <IntegrationItemCard
                    key={item.id}
                    item={item}
                    accentColor={selectedCategory.accentColor}
                    onPress={
                      item.id === 'webhook' && item.status === 'available'
                        ? handleOpenWebhookFromDetail
                        : undefined
                    }
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Bad Habits Tracker */}
      <BadHabitsTracker
        visible={showBadHabitsTracker}
        onClose={() => setShowBadHabitsTracker(false)}
      />

      {/* Obsidian Export Modal */}
      <ObsidianExportModal
        visible={showObsidianModal}
        onClose={() => setShowObsidianModal(false)}
      />

      {/* Outbox Status Modal */}
      <OutboxStatusModal
        visible={showOutboxModal}
        onClose={() => setShowOutboxModal(false)}
      />

      <SignOutConfirmModal
        visible={signOutOpen}
        unsent={signOutUnsent}
        busy={signingOut}
        error={signOutError}
        onSyncFirst={() => { void handleSyncFirst(); }}
        onConfirm={() => { void handleSignOut(); }}
        onCancel={() => { if (!signingOut) setSignOutOpen(false); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  themeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  themeLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  themeLabel: { fontSize: 15, fontWeight: '600', color: colors.white },
  themeSubLabel: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  motionBlock: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginTop: 12,
    borderWidth: 1, borderColor: colors.border, gap: 12,
  },
  motionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  segRow: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  segBtnOn: { backgroundColor: alphaHex(colors.accent, '22'), borderColor: colors.accent },
  segText: { fontSize: 13, fontWeight: '700', color: colors.textFaint },
  segTextOn: { color: colors.accent },
  accentRow: { flexDirection: 'row', gap: 8 },
  accentItem: { flex: 1, alignItems: 'center', gap: 6 },
  accentDot: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  accentDotOn: { borderColor: colors.text },
  accentLabel: { fontSize: 12, fontWeight: '600', color: colors.textFaint },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.white,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textDim,
    marginBottom: 24,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.white,
    marginBottom: 12,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 4,
  },
  settingSubtitle: {
    fontSize: 13,
    color: colors.textDim,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.white,
    marginBottom: 4,
  },
  appVersion: {
    fontSize: 14,
    color: colors.accent,
    marginBottom: 12,
  },
  appDescription: {
    fontSize: 14,
    color: colors.textDim,
    textAlign: 'center',
    lineHeight: 20,
  },
  featureSectionIntro: {
    fontSize: 13,
    color: colors.textDim,
    marginBottom: 12,
    lineHeight: 18,
  },
  featureCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureGroupTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 8,
  },
  featureDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureInfo: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: 13,
    color: colors.textDim,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.white,
  },
  modalDescription: {
    fontSize: 14,
    color: colors.textDim,
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
    fontSize: 14,
    color: colors.white,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  webhookList: {
    marginBottom: 20,
  },
  webhookListTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textDim,
    marginBottom: 12,
  },
  webhookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  webhookUrl: {
    fontSize: 12,
    color: colors.neutral300,
    flex: 1,
    marginRight: 8,
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    marginBottom: 16,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.white,
  },
  helpText: {
    fontSize: 11,
    color: colors.textFaint,
    fontFamily: 'monospace',
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    lineHeight: 16,
  },
  exportContainer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
  },
  exportTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 4,
  },
  exportSubtitle: {
    fontSize: 13,
    color: colors.textDim,
    marginBottom: 16,
  },
  exportButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  exportButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: colors.border,
  },
  exportNotice: {
    marginTop: 10,
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 17,
  },
  exportButtonLoading: {
    opacity: 0.6,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  seedBtnDisabled: {
    opacity: 0.7,
  },
  categoryModalHeaderText: {
    flex: 1,
    marginHorizontal: 8,
  },
  categoryModalHeaderSpacer: {
    width: 28,
  },
  categoryDetailScroll: {
    flex: 1,
  },
});
