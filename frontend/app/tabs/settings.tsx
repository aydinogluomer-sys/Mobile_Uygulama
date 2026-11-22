import React, { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { confirm, notify } from '../../lib/dialog';
import { setHapticsEnabled, useHapticsEnabled } from '../../lib/haptics';
import { runDeleteAccountFlow } from '../../lib/deleteAccountFlow';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { accentsFor, alphaHex, font, onColor, radius, space, type AccentKey, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemeMode, useThemedStyles } from '../../hooks/useThemeColors';
import { useAccent } from '../../lib/useAccent';
import type { SeasonalMotionIntensity } from '../../components/seasonalMotion/types';
import { buildBackup, isBackupComplete, renderBackup, MAX_ROWS, type ExportFormat } from '../../services/exportService';
import { shareOrDownload } from '../../lib/shareFile';
import { EXPORT_META } from '../../lib/focusReport';
import { todayLocal } from '../../lib/date';
import { deleteAccount, signOutCurrentAccount, unsentChangeCount } from '../../services/accountService';
import { flushAllOutboxes } from '../../services/unifiedOutbox';
import SignOutConfirmModal from '../../components/SignOutConfirmModal';
import { LIGHT_THEME_ENABLED } from '../../lib/featureGates';
import { useRouter } from 'expo-router';
import { navigateTo } from '../../lib/destinations';
import BadHabitsTracker from '../../components/BadHabitsTracker';
import { useOnboardingStore } from '../../store/onboardingStore';
// F06 (PRF-03): the seeder is loaded through its __DEV__-only gate, never imported statically
import { loadDemoSeed } from '../../lib/demoSeedGate';
// R08 — check an export and merge what is missing; never a full restore.
import RestorePanel from '../../components/RestorePanel';
import CsvImportPanel from '../../components/CsvImportPanel';
import OutboxStatusModal from '../../components/OutboxStatusModal';
import ObsidianExportModal from '../../components/ObsidianExportModal';
import { currentUser } from '../../lib/session';
import { CURRENT_FEATURES, type FeatureHighlight } from '../../constants/features';
import { reportError } from '../../lib/crashReporting';
import { Chip, EditorialBanner, EmblemMedallion } from '../../components/ui';
import TodayToolsSection from '../../components/settings/TodayToolsSection';
import SettingRow from '../../components/settings/SettingRow';
import AccountSection from '../../components/settings/AccountSection';
import WebhookModal from '../../components/settings/WebhookModal';
import {
  listWebhooks,
  registerWebhook,
  removeWebhook,
  type WebhookRow,
} from '../../services/webhookService';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { t, type StringKey } from '../../lib/i18n';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const SEASONAL_OPTIONS = [
  { v: 'off', labelKey: 'settings.motion.off', label: () => t('settings.motion.off') },
  { v: 'subtle', labelKey: 'settings.motion.subtle', label: () => t('settings.motion.subtle') },
  { v: 'normal', labelKey: 'settings.motion.normal', label: () => t('settings.motion.normal') },
] as const satisfies readonly { v: SeasonalMotionIntensity; labelKey: StringKey; label: () => string }[];

function ThemeModeRow({ isDark, onSelectDark }: { isDark: boolean; onSelectDark: (dark: boolean) => void }) {
  const c = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.motionBlock} accessibilityRole="radiogroup" accessibilityLabel={t('settings.theme.title')}>
      <View style={styles.motionHead}>
        <Ionicons
          name={isDark ? 'moon-outline' : 'sunny-outline'}
          size={18}
          color={isDark ? c.accent : c.warning}
        />
        <View style={styles.flex1}>
          <Text style={styles.themeLabel}>{t('settings.theme.title')}</Text>
          <Text style={styles.themeSubLabel}>{t('settings.theme.sub')}</Text>
        </View>
      </View>
      <View style={styles.segRow}>
        <Chip
          label={t('settings.theme.dark')}
          color={c.accent}
          selected={isDark}
          onPress={() => onSelectDark(true)}
          accessibilityRole="radio"
          style={[styles.segBtn, styles.themeRadioBtn, isDark && styles.segBtnOn]}
        />
        <Chip
          label={t('settings.theme.light')}
          color={c.accent}
          selected={!isDark}
          onPress={() => onSelectDark(false)}
          accessibilityRole="radio"
          style={[styles.segBtn, styles.themeRadioBtn, !isDark && styles.segBtnOn]}
        />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const c = useThemeColors();
  const mode = useThemeMode();
  const styles = useThemedStyles(makeStyles);
  const accentTheme = useAccent();
  const isDark = useThemeStore((st) => st.isDark);
  const setDark = useThemeStore((st) => st.setDark);
  const seasonalMotion = useThemeStore((st) => st.seasonalMotion);
  const setSeasonalMotion = useThemeStore((st) => st.setSeasonalMotion);
  const accent = useThemeStore((st) => st.accent);
  const setAccent = useThemeStore((st) => st.setAccent);
  const hapticsEnabled = useHapticsEnabled();
  const modeAccents = accentsFor(mode);

  const [showBadHabitsTracker, setShowBadHabitsTracker] = useState(false);
  const [showOutboxModal, setShowOutboxModal] = useState(false);
  const [showObsidianModal, setShowObsidianModal] = useState(false);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [latestSigningSecret, setLatestSigningSecret] = useState<string | null>(null);
  const router = useRouter();
  const beginPersonalization = useOnboardingStore((s) => s.beginPersonalization);

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
    currentUser()
      .then((u) => {
        if (alive) setAccountEmail(u?.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const handleExportData = async (format: ExportFormat) => {
    try {
      setExportingFormat(format);
      setExportNotice(null);

      const me = await currentUser();
      const backup = await buildBackup(new Date(), { userId: me?.id ?? null });
      const notices: string[] = [];

      if (!isBackupComplete(backup)) {
        if (backup.truncated.length > 0) {
          const sections = backup.truncated.join(', ');
          notices.push(
            t('settings.export.truncated.notice', { max: MAX_ROWS, sections }),
          );
          void notify(
            t('settings.export.truncated.title'),
            t('settings.export.truncated.body', { max: MAX_ROWS, sections }),
          );
        }
        if (backup.failed.length > 0) {
          const failedSections = backup.failed.map((f) => f.collection).join(', ');
          notices.push(t('settings.export.failed.notice', { sections: failedSections }));
          void notify(
            t('settings.export.failed.title'),
            t('settings.export.failed.body', { sections: failedSections }),
          );
        }
      }

      const out = await shareOrDownload({
        filename: `aderyth-disa-aktarim-${todayLocal()}.${EXPORT_META[format].ext}`,
        mime: EXPORT_META[format].mime,
        content: renderBackup(backup, format),
        title: t('settings.export.shareTitle', { format: format.toUpperCase() }),
      });
      if (out === 'downloaded') {
        notices.push(t('settings.export.downloaded'));
      } else if (out === 'too_large') {
        notices.push(t('settings.export.tooLarge'));
      }
      const nextNotice = notices.filter(Boolean).join(' ');
      setExportNotice(nextNotice || null);
    } catch (error) {
      if (error instanceof Error && error.message === 'DOWNLOAD_UNAVAILABLE') {
        setExportNotice(t('settings.export.downloadBlocked'));
      } else {
        void notify(t('common.error'), t('settings.export.errorAlert'));
        setExportNotice(t('settings.export.errorNotice'));
        reportError(error, 'manual', 'export');
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const deleteFlowRef = useRef(false);
  const handleDeleteAccount = async () => {
    if (deletingAccount || deleteFlowRef.current) return;
    deleteFlowRef.current = true;
    try {
      await runDeleteAccountFlow({
        unsent: unsentChangeCount(),
        confirm,
        notify,
        deleteAccount,
        onBusy: setDeletingAccount,
      });
    } finally {
      deleteFlowRef.current = false;
    }
  };

  const handleSeedDemoData = async () => {
    const demo = loadDemoSeed();
    if (!demo) return;
    try {
      setSeedingDemo(true);
      const result = await demo.seedDemoData();
      void notify(
        t('settings.dev.seed.doneTitle'),
        t('settings.dev.seed.doneBody', {
          projects: result.projects,
          tasks: result.tasks,
          habits: result.habits,
          logs: result.logs,
          focusTasks: result.focusTasks,
          recoveryPlans: result.recoveryPlans,
          journalEntries: result.journalEntries,
        }),
      );
    } catch (error) {
      void notify(t('common.error'), t('settings.dev.seed.error'));
      reportError(error, 'manual', 'demo-seed');
    } finally {
      setSeedingDemo(false);
    }
  };

  const renderFeatureItem = (item: FeatureHighlight) => (
    <View key={item.id} style={styles.featureItem}>
      <View style={[styles.featureIcon, { backgroundColor: alphaHex(item.color, '20') }]}>
        <Ionicons name={item.icon as IoniconName} size={20} color={item.color} />
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
    if (!res.ok) {
      setSignOutError(res.error);
      return;
    }
    setSignOutOpen(false);
  };

  const handleSyncFirst = async () => {
    setSigningOut(true);
    try {
      await flushAllOutboxes();
    } catch {
      /* the count below says what is still waiting */
    }
    setSignOutUnsent(unsentChangeCount());
    setSigningOut(false);
  };

  const loadWebhooks = async () => {
    setWebhooksLoading(true);
    setWebhookError(null);
    const res = await listWebhooks();
    setWebhooksLoading(false);
    if (res.ok) {
      setWebhooks(res.data);
    } else {
      setWebhookError(res.error);
    }
  };

  const openWebhookModal = () => {
    setLatestSigningSecret(null);
    setWebhookError(null);
    setShowWebhookModal(true);
    void loadWebhooks();
  };

  const handleAddWebhook = async () => {
    if (webhookBusy) return;
    setWebhookBusy(true);
    setWebhookError(null);
    const res = await registerWebhook({ url: webhookUrl });
    setWebhookBusy(false);
    if (!res.ok) {
      setWebhookError(res.error);
      return;
    }
    setWebhookUrl('');
    setLatestSigningSecret(res.signingSecret);
    void notify(
      t('settings.webhook.secretTitle'),
      t('settings.webhook.secretBody'),
    );
    await loadWebhooks();
  };

  const handleRemoveWebhook = async (id: string) => {
    if (webhookBusy) return;
    setWebhookBusy(true);
    setWebhookError(null);
    const res = await removeWebhook(id);
    setWebhookBusy(false);
    if (!res.ok) {
      setWebhookError(res.error);
      return;
    }
    await loadWebhooks();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <AtmosphericScreenCanvas
        source={CANVASES.treasuryVault}
        textureSource={TEXTURES.linen}
        scrim={0.64}
        tintColor={c.accent}
      />
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <EditorialBanner
            source={SCREEN_BANNERS.privacyVaultSeal}
            textureSource={TEXTURES.linen}
            eyebrow={t('settings.banner.overline')}
            title={t('settings.banner.title')}
            subtitle={t('settings.banner.sub')}
            accentColor={c.accent}
            minHeight={94}
            style={styles.bannerGap}
            rightSlot={
              <EmblemMedallion
                source={SCREEN_BANNERS.privacyVaultSeal}
                size={44}
                unlocked
                accentColor={c.accent}
              />
            }
          />
          <Text style={styles.title}>{t('settings.header.title')}</Text>
          <Text style={styles.subtitle}>{t('settings.header.sub')}</Text>

          {/* Görünüm */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.appearance.title')}</Text>
            {LIGHT_THEME_ENABLED ? <ThemeModeRow isDark={isDark} onSelectDark={setDark} /> : null}

            {/* Mevsimsel arka plan animasyonları (contract §13) */}
            <View style={styles.motionBlock}>
              <View style={styles.motionHead}>
                <Ionicons name="sparkles-outline" size={18} color={c.accent} />
                <View style={styles.flex1}>
                  <Text style={styles.themeLabel}>{t('settings.motion.title')}</Text>
                  <Text style={styles.themeSubLabel}>
                    {t('settings.motion.sub')}
                  </Text>
                </View>
              </View>
              <View style={styles.segRow}>
                {SEASONAL_OPTIONS.map((o) => {
                  const on = seasonalMotion === o.v;
                  const optLabel = o.label();
                  return (
                    <TouchableOpacity
                      key={o.v}
                      style={[styles.segBtn, on && styles.segBtnOn]}
                      onPress={() => setSeasonalMotion(o.v)}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.motion.option.a11y', { label: optLabel })}
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.segText, on && styles.segTextOn]}>{optLabel}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Aksan rengi seçici (Atlas: clay/moss/slate/amber) */}
            <View style={styles.motionBlock}>
              <View style={styles.motionHead}>
                <Ionicons name="color-palette-outline" size={18} color={accentTheme.primary} />
                <View style={styles.flex1}>
                  <Text style={styles.themeLabel}>{t('settings.accent.title')}</Text>
                  <Text style={styles.themeSubLabel}>
                    {t('settings.accent.sub')}
                  </Text>
                </View>
              </View>
              <View style={styles.accentRow}>
                {(Object.keys(modeAccents) as AccentKey[]).map((k) => {
                  const a = modeAccents[k];
                  const on = accent === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={styles.accentItem}
                      onPress={() => setAccent(k)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.accent.option.a11y', { label: a.label })}
                      accessibilityState={{ selected: on }}
                    >
                      <View style={[styles.accentDot, { backgroundColor: a.primary }, on && styles.accentDotOn]}>
                        {on && <Ionicons name="checkmark" size={16} color={onColor(a.primary)} />}
                      </View>
                      <Text style={[styles.accentLabel, on && { color: a.primary, fontWeight: '700' }]}>
                        {a.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Dokunsal geri bildirim (DSA-12) */}
            <View style={styles.motionBlock}>
              <View style={styles.hapticRow}>
                <Ionicons name="radio-button-on-outline" size={18} color={c.accent} />
                <View style={styles.flex1}>
                  <Text style={styles.themeLabel}>{t('settings.haptics.title')}</Text>
                  <Text style={styles.themeSubLabel}>
                    {t('settings.haptics.sub')}
                  </Text>
                </View>
                <Switch
                  value={hapticsEnabled}
                  onValueChange={setHapticsEnabled}
                  trackColor={{ false: c.border, true: alphaHex(accentTheme.primary, '66') }}
                  thumbColor={hapticsEnabled ? accentTheme.primary : c.textFaint}
                  accessibilityRole="switch"
                  accessibilityLabel={t('settings.haptics.title')}
                  accessibilityState={{ checked: hapticsEnabled }}
                  style={styles.hapticSwitch}
                />
              </View>
            </View>
          </View>

          <TodayToolsSection />

          <ChapterDivider source={DECOR.dividerSundial} label={t('settings.vault.overline')} style={styles.dividerGap} />

          {/* Veri ve Gizlilik */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.privacy.title')}</Text>

            <View style={styles.exportContainer}>
              <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.11} />
              <Text style={styles.exportTitle}>{t('settings.export.title')}</Text>
              <Text style={styles.exportSubtitle}>
                {t('settings.export.toolsSub')}
              </Text>
              <Text style={styles.exportSubtitle}>
                {t('settings.export.disclaimer')}
              </Text>
              {/* R08.03 — the chosen protection boundary, said before sharing (docs/implementation-v3/R08_BACKUP_PROTECTION.md). */}
              <Text style={styles.exportSubtitle} accessibilityRole="text">
                {t('settings.export.notEncrypted')}
              </Text>

              <View style={styles.exportButtons}>
                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'json' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('json')}
                  disabled={exportingFormat !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.export.json.a11y')}
                >
                  {exportingFormat === 'json' ? (
                    <ActivityIndicator size="small" color={c.accent} />
                  ) : (
                    <>
                      <Ionicons name="code-outline" size={20} color={c.accent} />
                      <Text style={styles.exportButtonText}>JSON</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'excel' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('excel')}
                  disabled={exportingFormat !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.export.excel.a11y')}
                >
                  {exportingFormat === 'excel' ? (
                    <ActivityIndicator size="small" color={c.success} />
                  ) : (
                    <>
                      <Ionicons name="document-outline" size={20} color={c.success} />
                      <Text style={styles.exportButtonText}>Excel</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportButton, exportingFormat === 'csv' && styles.exportButtonLoading]}
                  onPress={() => handleExportData('csv')}
                  disabled={exportingFormat !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.export.csv.a11y')}
                >
                  {exportingFormat === 'csv' ? (
                    <ActivityIndicator size="small" color={c.warning} />
                  ) : (
                    <>
                      <Ionicons name="list-outline" size={20} color={c.warning} />
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

            {/* DEMO-001B - sadece gelistirme derlemesinde. */}
            {__DEV__ && loadDemoSeed()?.isSeedingAllowed() === true && (
              <View style={styles.seedRowGap}>
                <SettingRow
                  icon="flask-outline"
                  label={t('settings.dev.seed.label')}
                  hint={t('settings.dev.seed.hint')}
                  tone={c.success}
                  disabled={seedingDemo}
                  busy={seedingDemo}
                  onPress={handleSeedDemoData}
                />
              </View>
            )}
          </View>

          {/* Hesap */}
          <AccountSection
            email={accountEmail}
            onSignOut={openSignOut}
            onDeleteAccount={handleDeleteAccount}
            signingOut={signingOut}
            deletingAccount={deletingAccount}
          />

          {/* Kişiselleştirme */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.personalization.title')}</Text>
            <SettingRow
              icon="sparkles"
              label={t('settings.personalization.label')}
              hint={t('settings.personalization.hint')}
              tone={c.primary}
              onPress={openPersonalization}
            />
          </View>

          {/* Takip & Veri Araçları */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.tools.title')}</Text>

            <SettingRow
              icon="ban"
              label={t('settings.tools.badHabits.label')}
              hint={t('settings.tools.badHabits.hint')}
              tone={c.error}
              onPress={() => setShowBadHabitsTracker(true)}
            />

            <SettingRow
              icon="document-text-outline"
              label={t('settings.tools.obsidian.label')}
              hint={t('settings.tools.obsidian.hint')}
              tone={c.accent}
              onPress={() => setShowObsidianModal(true)}
            />

            <SettingRow
              icon="cloud-offline-outline"
              label={t('settings.tools.offline.label')}
              hint={t('settings.tools.offline.hint')}
              tone={c.teal}
              onPress={() => setShowOutboxModal(true)}
            />
          </View>

          {/* Bağlantılar (NAV-14: dürüst tek giriş) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.connections.title')}</Text>
            <SettingRow
              icon="git-network-outline"
              label={t('settings.connections.title')}
              hint={t('settings.connections.integrations.hint')}
              tone={c.teal}
              onPress={() => navigateTo(router, 'integrations')}
            />
            <SettingRow
              icon="link-outline"
              label={t('settings.connections.webhooks.label')}
              hint={t('settings.connections.webhooks.hint')}
              tone={c.accent}
              onPress={openWebhookModal}
            />
          </View>

          {/* Hakkında & Neler var */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.about.title')}</Text>

            <View style={styles.infoCard}>
              <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.14} size={108} />
              <Text style={styles.appName}>Aderyth</Text>
              <Text style={styles.appVersion}>{t('settings.about.version')}</Text>
              <Text style={styles.appDescription}>
                {t('settings.about.description')}
              </Text>
            </View>

            <View style={styles.featureCard}>
              <Text style={styles.featureGroupTitle}>{t('settings.about.featuresTitle')}</Text>
              {CURRENT_FEATURES.map(renderFeatureItem)}
            </View>
          </View>
        </View>
      </ScrollView>

      <BadHabitsTracker
        visible={showBadHabitsTracker}
        onClose={() => setShowBadHabitsTracker(false)}
      />

      <ObsidianExportModal
        visible={showObsidianModal}
        onClose={() => setShowObsidianModal(false)}
      />

      <OutboxStatusModal
        visible={showOutboxModal}
        onClose={() => setShowOutboxModal(false)}
      />

      <WebhookModal
        visible={showWebhookModal}
        webhooks={webhooks}
        loading={webhooksLoading}
        busy={webhookBusy}
        url={webhookUrl}
        error={webhookError}
        signingSecret={latestSigningSecret}
        onChangeUrl={setWebhookUrl}
        onAdd={() => {
          void handleAddWebhook();
        }}
        onRemove={(id) => {
          void handleRemoveWebhook(id);
        }}
        onClose={() => {
          setLatestSigningSecret(null);
          setShowWebhookModal(false);
        }}
      />

      <SignOutConfirmModal
        visible={signOutOpen}
        unsent={signOutUnsent}
        busy={signingOut}
        error={signOutError}
        onSyncFirst={() => {
          void handleSyncFirst();
        }}
        onConfirm={() => {
          void handleSignOut();
        }}
        onCancel={() => {
          if (!signingOut) setSignOutOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex1: { flex: 1 },
    bannerGap: { marginBottom: space.md },
    dividerGap: { marginBottom: space.lg },
    seedRowGap: { marginTop: space.md },
    themeLabel: { ...font.body, fontWeight: '600', color: c.text },
    themeSubLabel: { ...font.caption, color: c.textFaint, marginTop: space.xs },
    motionBlock: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: space.md,
      marginTop: space.md,
      borderWidth: 1,
      borderColor: c.border,
      gap: space.md,
    },
    motionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
    hapticRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
    hapticSwitch: { minHeight: 44 },
    segRow: { flexDirection: 'row', gap: space.sm },
    segBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.sm,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      minHeight: 44,
    },
    themeRadioBtn: { minHeight: 44 },
    segBtnOn: { backgroundColor: alphaHex(c.accent, '22'), borderColor: c.accent },
    segText: { ...font.bodySm, fontWeight: '700', color: c.textFaint },
    segTextOn: { color: c.accent },
    accentRow: { flexDirection: 'row', gap: space.sm },
    accentItem: { flex: 1, alignItems: 'center', gap: space.xs, minHeight: 44 },
    accentDot: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    accentDotOn: { borderColor: c.text },
    accentLabel: { ...font.caption, fontWeight: '600', color: c.textFaint },
    container: { flex: 1, backgroundColor: c.bg },
    scrollView: { flex: 1 },
    content: { padding: space.md, overflow: 'hidden', position: 'relative' },
    title: { ...font.display, fontWeight: 'bold', color: c.text, marginBottom: space.xs },
    subtitle: { ...font.body, color: c.textDim, marginBottom: space.xl },
    section: { marginBottom: space.xxl },
    sectionTitle: { ...font.h3, fontWeight: 'bold', color: c.text, marginBottom: space.md },
    infoCard: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: space.lg,
      overflow: 'hidden',
      position: 'relative',
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      marginBottom: space.md,
    },
    appName: { ...font.h2, fontWeight: 'bold', color: c.text, marginBottom: space.xs },
    appVersion: { ...font.bodySm, color: c.accent, marginBottom: space.md },
    appDescription: { ...font.bodySm, color: c.textDim, textAlign: 'center' },
    featureCard: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: space.md,
      overflow: 'hidden',
      position: 'relative',
      borderWidth: 1,
      borderColor: c.border,
    },
    featureGroupTitle: { ...font.body, fontWeight: '600', color: c.text, marginBottom: space.sm },
    featureItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: space.sm,
    },
    featureIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: space.md,
    },
    featureInfo: { flex: 1 },
    featureTitle: { ...font.body, fontWeight: '600', color: c.text, marginBottom: space.xs },
    featureDescription: { ...font.bodySm, color: c.textDim },
    exportContainer: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: space.md,
      overflow: 'hidden',
      position: 'relative',
      borderWidth: 1,
      borderColor: c.border,
    },
    exportTitle: { ...font.body, fontWeight: '600', color: c.text, marginBottom: space.xs },
    exportSubtitle: { ...font.bodySm, color: c.textDim, marginBottom: space.md },
    exportButtons: { flexDirection: 'row', gap: space.md },
    exportButton: {
      flex: 1,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: space.md,
      paddingHorizontal: space.md,
      borderWidth: 2,
      borderColor: c.border,
    },
    exportNotice: { marginTop: space.sm, ...font.caption, color: c.textDim },
    exportButtonLoading: { opacity: 0.6 },
    exportButtonText: { ...font.bodySm, fontWeight: '600', color: c.text },
  });
