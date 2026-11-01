import { colors, alphaHex } from '../../lib/tokens';
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  Linking, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { INTEGRATION_CATEGORIES, type IntegrationCategory, type IntegrationItem } from '../../constants/integrations';
import IntegrationCategoryCard from '../../components/IntegrationCategoryCard';
import IntegrationItemCard from '../../components/IntegrationItemCard';
import IntegrationDetailModal from '../../components/IntegrationDetailModal';
import { AtmosphericScreenCanvas, ChapterDivider, EditorialBanner, EmbeddedFiligree } from '../../components/ui';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { useNotionStore } from '../../store/notionStore';
import { useGoogleCalendarStore } from '../../store/googleCalendarStore';
import {
  NOTION_INTEGRATION_ENABLED,
  GOOGLE_CALENDAR_INTEGRATION_ENABLED,
  INTEGRATION_UNAVAILABLE_REASON,
} from '../../lib/featureGates';

export default function IntegrationsScreen() {
  const [selected, setSelected] = useState<IntegrationCategory | null>(null);
  const [detailItem, setDetailItem] = useState<IntegrationItem | null>(null);
  const [notionModal, setNotionModal] = useState(false);
  const [googleModal, setGoogleModal] = useState(false);

  const { connection, status: notionStatus, lastSynced, error: notionError, fetchStatus, prefetchAuthUrl, connect, disconnect, sync } = useNotionStore();
  const {
    connection: googleConnection,
    status: googleStatus,
    error: googleError,
    fetchStatus: fetchGoogleStatus,
    connect: connectGoogle,
    disconnect: disconnectGoogle,
  } = useGoogleCalendarStore();
  const isConnected = !!connection;
  const isGoogleConnected = !!googleConnection;

  // Both of these are network calls, and both used to run on every open of
  // this screen. `fetchGoogleStatus` hit `google-auth?action=status`, which is
  // not deployed -- so simply arriving here produced a 404 before the user had
  // touched anything. Gated at the source rather than at the button, because a
  // disabled button does not stop an effect.
  useEffect(() => {
    if (NOTION_INTEGRATION_ENABLED) fetchStatus();
    if (GOOGLE_CALENDAR_INTEGRATION_ENABLED) fetchGoogleStatus();
  }, [fetchStatus, fetchGoogleStatus]);

  // Notion modalı açılınca OAuth URL'ini önceden çek → buton anında açılır
  useEffect(() => {
    if (!NOTION_INTEGRATION_ENABLED) return;
    if (notionModal && !isConnected) prefetchAuthUrl();
  }, [notionModal, isConnected, prefetchAuthUrl]);

  const connectedCount = INTEGRATION_CATEGORIES.flatMap(c => c.items).filter(i => i.status === 'connected').length + (isConnected ? 1 : 0) + (isGoogleConnected ? 1 : 0);

  function handleItemPress(item: IntegrationItem) {
    if (item.id === 'notion' && !NOTION_INTEGRATION_ENABLED) return;
    if (item.id === 'notion') {
      setSelected(null);
      setTimeout(() => setNotionModal(true), 120);
      return;
    }
    if (item.id === 'calendar' && !GOOGLE_CALENDAR_INTEGRATION_ENABLED) return;
    if (item.id === 'calendar') {
      setSelected(null);
      setTimeout(() => setGoogleModal(true), 120);
      return;
    }
    setSelected(null);
    setTimeout(() => setDetailItem(item), 120);
  }

  async function handleConnect() {
    const ok = await connect();
    if (ok) Alert.alert('✅ Notion Bağlandı', `${connection?.workspaceName ?? 'Workspace'} bağlandı. Alışkanlık ve görev veritabanları Notion'a eklendi.`);
  }

  async function handleGoogleConnect() {
    const ok = await connectGoogle();
    if (ok) Alert.alert('✅ Google Calendar Bağlandı', 'Google Calendar hesabınız başarıyla bağlandı.');
  }

  function handleGoogleDisconnect() {
    Alert.alert('Bağlantıyı Kes', 'Google Calendar bağlantısı kaldırılsın mı?', [
      { text: 'İptal', style: 'cancel' },
      { text: 'Kes', style: 'destructive', onPress: disconnectGoogle },
    ]);
  }

  async function handleSync() {
    const result = await sync();
    if (result) Alert.alert('✅ Senkronlandı', `${result.habits} alışkanlık ve ${result.tasks} görev Notion'a aktarıldı.`);
  }

  function handleDisconnect() {
    Alert.alert("Bağlantıyı Kes", "Notion entegrasyonu kaldırılsın mı?", [
      { text: 'İptal', style: 'cancel' },
      { text: 'Kes', style: 'destructive', onPress: disconnect },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.observatoryStats}
        textureSource={TEXTURES.neural}
        scrim={0.62}
        tintColor={colors.accent}
      />
      {/* Özet bant */}
      <View style={s.banner}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.15} size={86} />
        <View style={s.bannerLeft}>
          <Ionicons name="git-network-outline" size={20} color={colors.accent} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View>
            <Text style={s.bannerTitle}>Entegrasyonlar</Text>
            <Text style={s.bannerSub}>
              {connectedCount > 0 ? `${connectedCount} bağlı servis` : "Harici servisleri Aderyth'e bağlayın"}
            </Text>
          </View>
        </View>
        <View style={s.bannerBadge}>
          <Text style={s.bannerBadgeText}>{INTEGRATION_CATEGORIES.flatMap(c => c.items).length}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <EditorialBanner
          source={SCREEN_BANNERS.integrationsOrrery}
          textureSource={TEXTURES.neural}
          eyebrow="EKOSİSTEM KÖPRÜSÜ"
          title="Bağlı Servisler"
          subtitle="Takvim, bilgi tabanı ve otomasyon akışları."
          accentColor={colors.accent}
          minHeight={88}
          style={{ marginBottom: 12 }}
        />
        {INTEGRATION_CATEGORIES.map((cat) => (
          <IntegrationCategoryCard key={cat.id} category={cat} onPress={() => setSelected(cat)} />
        ))}

        {/* Notion öne çıkan kart */}
        <ChapterDivider source={DECOR.dividerSundial} label="ÖNE ÇIKAN BAĞLANTILAR" style={{ marginVertical: 10 }} />
        <TouchableOpacity
          style={[s.featureCard, isConnected && s.featureCardConnected]}
          onPress={NOTION_INTEGRATION_ENABLED ? () => setNotionModal(true) : undefined}
          disabled={!NOTION_INTEGRATION_ENABLED}
          accessibilityRole="button"
          accessibilityLabel={isConnected ? 'Notion, bağlı' : 'Notion, entegrasyon ayarları'}
          accessibilityHint="Notion entegrasyon ayarlarını açar"
        >
          <View style={s.featureLeft}>
            <EmbeddedFiligree source={DECOR.obsidianPrism} anchor="bottom-right" opacity={0.14} size={88} />
            <View style={[s.featureIcon, { backgroundColor: '#f9731620' }]}>
              <Ionicons name="document-text-outline" size={22} color="#f97316" />
            </View>
            <View style={s.featureBody}>
              <View style={s.featureRow}>
                <Text style={s.featureTitle}>Notion</Text>
                <View style={[s.badge, isConnected ? s.badgeConnected : s.badgeAvailable]}>
                  <Text style={[s.badgeText, isConnected ? s.badgeTextConnected : s.badgeTextAvailable]}>
                    {isConnected ? '● Bağlı' : 'Hazır'}
                  </Text>
                </View>
              </View>
              <Text style={s.featureDesc}>
                {isConnected
                  ? `${connection.workspaceName} · Son sync: ${lastSynced ?? 'henüz yok'}`
                  : NOTION_INTEGRATION_ENABLED
                    ? 'Notion veritabanlarınızı bağlayın veya yönetin'
                    : INTEGRATION_UNAVAILABLE_REASON}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textGhost} />
        </TouchableOpacity>

        {/* Google Calendar öne çıkan kart */}
        <TouchableOpacity
          style={[s.featureCard, isGoogleConnected && s.featureCardConnected]}
          onPress={GOOGLE_CALENDAR_INTEGRATION_ENABLED ? () => setGoogleModal(true) : undefined}
          disabled={!GOOGLE_CALENDAR_INTEGRATION_ENABLED}
          accessibilityRole="button"
          accessibilityLabel={isGoogleConnected ? 'Takvim, bağlı' : 'Takvim, entegrasyon ayarları'}
          accessibilityHint="Google Calendar entegrasyon ayarlarını açar"
        >
          <View style={s.featureLeft}>
            <EmbeddedFiligree source={DECOR.obsidianPrism} anchor="bottom-right" opacity={0.14} size={88} />
            <View style={[s.featureIcon, { backgroundColor: '#4285F420' }]}> 
              <Ionicons name="calendar-outline" size={22} color="#4285F4" />
            </View>
            <View style={s.featureBody}>
              <View style={s.featureRow}>
                <Text style={s.featureTitle}>Takvim</Text>
                <View style={[s.badge, isGoogleConnected ? s.badgeConnected : s.badgeAvailable]}>
                  <Text style={[s.badgeText, isGoogleConnected ? s.badgeTextConnected : s.badgeTextAvailable]}>
                    {isGoogleConnected ? '● Bağlı' : 'Hazır'}
                  </Text>
                </View>
              </View>
              <Text style={s.featureDesc}>
                {isGoogleConnected ? `${googleConnection?.calendarName}` : 'Google Calendar hesabınızı bağlayın'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textGhost} />
        </TouchableOpacity>



        <View style={s.hint}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textGhost} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <Text style={s.hintText}>Entegrasyonlar yakında geliyor.</Text>
        </View>
      </ScrollView>

      {/* Kategori detay modal */}
      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            {selected && (
              <>
                <View style={s.sheetHeader}>
                  <View style={[s.sheetIcon, { backgroundColor: selected.accentColor + '20' }]}>
                    <Ionicons name={selected.iconName as any} size={24} color={selected.accentColor} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  </View>
                  <View style={s.sheetTitleWrap}>
                    <Text style={s.sheetTitle}>{selected.title}</Text>
                    <Text style={s.sheetDesc} numberOfLines={2}>{selected.description}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelected(null)}
                    style={s.closeBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Kapat"
                  >
                    <Ionicons name="close" size={22} color={colors.textFaint} />
                  </TouchableOpacity>
                </View>
                <View style={s.divider} />
                <ScrollView contentContainerStyle={s.itemList}>
                  {selected.items.map((item) => (
                    <IntegrationItemCard
                      key={item.id}
                      item={item}
                      accentColor={selected.accentColor}
                      onPress={() => handleItemPress(item)}
                    />
                  ))}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Notion Modal ─────────────────────────────────────────────────────── */}
      <Modal visible={notionModal} transparent animationType="slide" onRequestClose={() => setNotionModal(false)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '70%' }]}>
            <View style={s.sheetHeader}>
              <View style={[s.sheetIcon, { backgroundColor: '#f9731620' }]}>
                <Ionicons name="document-text-outline" size={24} color="#f97316" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              </View>
              <View style={s.sheetTitleWrap}>
                <Text style={s.sheetTitle}>Notion</Text>
                <Text style={s.sheetDesc}>{isConnected ? connection!.workspaceName : 'Hesabınızla bağlayın'}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setNotionModal(false)}
                style={s.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={22} color={colors.textFaint} />
              </TouchableOpacity>
            </View>
            <View style={s.divider} />

            <ScrollView contentContainerStyle={s.stepList}>
              {isConnected ? (
                /* ── Bağlı durum ── */
                <>
                  <View style={s.connectedBanner}>
                    <View style={s.connectedIconWrap}>
                      <Ionicons name="checkmark-circle" size={28} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.connectedTitle}>{connection!.workspaceName}</Text>
                      <Text style={s.connectedSub}>Aderyth veritabanları Notion&apos;da hazır</Text>
                    </View>
                  </View>

                  <View style={s.dbLinks}>
                    <TouchableOpacity
                      style={s.dbLink}
                      onPress={() => Linking.openURL(connection!.habitsUrl)}
                      accessibilityRole="link"
                      accessibilityLabel="Alışkanlık Takibi veritabanını Notion'da aç"
                    >
                      <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                      <Text style={s.dbLinkText}>Alışkanlık Takibi</Text>
                      <Ionicons name="open-outline" size={14} color={colors.textGhost} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.dbLink}
                      onPress={() => Linking.openURL(connection!.tasksUrl)}
                      accessibilityRole="link"
                      accessibilityLabel="Görevler veritabanını Notion'da aç"
                    >
                      <Ionicons name="list-outline" size={16} color={colors.accent} />
                      <Text style={s.dbLinkText}>Görevler</Text>
                      <Ionicons name="open-outline" size={14} color={colors.textGhost} />
                    </TouchableOpacity>
                  </View>

                  {notionStatus === 'error' && notionError && (
                    <View style={s.errorBox} accessibilityRole="alert">
                      <Ionicons name="warning-outline" size={15} color={colors.error} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                      <Text style={s.errorText}>{notionError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.primaryBtn, notionStatus === 'syncing' && s.btnDisabled]}
                    onPress={handleSync}
                    disabled={notionStatus === 'syncing'}
                    accessibilityRole="button"
                    accessibilityLabel={notionStatus === 'syncing' ? 'Senkronlanıyor' : 'Bugünü Notion ile senkronla'}
                    accessibilityState={{ disabled: notionStatus === 'syncing', busy: notionStatus === 'syncing' }}
                  >
                    {notionStatus === 'syncing'
                      ? <ActivityIndicator size="small" color={colors.white} />
                      : <Ionicons name="sync-outline" size={18} color={colors.white} />}
                    <Text style={s.primaryBtnText}>
                      {notionStatus === 'syncing' ? 'Senkronlanıyor…' : 'Bugünü Senkronla'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={handleDisconnect}
                    accessibilityRole="button"
                    accessibilityLabel="Notion bağlantısını kes"
                  >
                    <Text style={s.secondaryBtnText}>Bağlantıyı Kes</Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* ── Bağlanma ekranı ── */
                <>
                  {/* Ne yapacağını göster */}
                  <View style={s.oauthPreview}>
                    {[
                      { icon: 'checkmark-circle-outline', color: colors.success, label: 'Alışkanlık Takibi veritabanı' },
                      { icon: 'list-outline', color: colors.accent, label: 'Görevler veritabanı' },
                      { icon: 'sync-outline', color: '#f97316', label: 'Günlük otomatik sync' },
                    ].map(f => (
                      <View key={f.label} style={s.previewRow}>
                        <Ionicons name={f.icon as any} size={18} color={f.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                        <Text style={s.previewLabel}>{f.label}</Text>
                        <Ionicons name="checkmark" size={14} color={colors.textGhost} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                      </View>
                    ))}
                  </View>

                  <Text style={s.oauthNote}>
                    Notion hesabınızda oturum açmanız istenecek. Aderyth, seçtiğiniz workspace&apos;e iki veritabanı oluşturacak.
                  </Text>

                  {notionStatus === 'error' && notionError && (
                    <View style={s.errorBox} accessibilityRole="alert">
                      <Ionicons name="warning-outline" size={15} color={colors.error} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                      <Text style={s.errorText}>{notionError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: '#f97316' }, notionStatus === 'connecting' && s.btnDisabled]}
                    onPress={handleConnect}
                    disabled={notionStatus === 'connecting'}
                    accessibilityRole="button"
                    accessibilityLabel={notionStatus === 'connecting' ? 'Notion’a bağlanılıyor' : 'Notion ile bağlan'}
                    accessibilityState={{ disabled: notionStatus === 'connecting', busy: notionStatus === 'connecting' }}
                  >
                    {notionStatus === 'connecting'
                      ? <ActivityIndicator size="small" color={colors.white} />
                      : <Ionicons name="logo-google" size={18} color={colors.white} />}
                    <Text style={s.primaryBtnText}>
                      {notionStatus === 'connecting' ? 'Bağlanıyor…' : 'Notion ile Bağlan'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Google Calendar Modal ───────────────────────────────────────────── */}
      <Modal visible={googleModal} transparent animationType="slide" onRequestClose={() => setGoogleModal(false)}>
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '70%' }]}> 
            <View style={s.sheetHeader}>
              <View style={[s.sheetIcon, { backgroundColor: '#4285F420' }]}> 
                <Ionicons name="calendar-outline" size={24} color="#4285F4" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              </View>
              <View style={s.sheetTitleWrap}>
                <Text style={s.sheetTitle}>Google Calendar</Text>
                <Text style={s.sheetDesc}>{isGoogleConnected ? googleConnection?.calendarName : 'Hesabınızla bağlayın'}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setGoogleModal(false)}
                style={s.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={22} color={colors.textFaint} />
              </TouchableOpacity>
            </View>
            <View style={s.divider} />

            <ScrollView contentContainerStyle={s.stepList}>
              {isGoogleConnected ? (
                <>
                  <View style={s.connectedBanner}>
                    <View style={s.connectedIconWrap}>
                      <Ionicons name="checkmark-circle" size={28} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.connectedTitle}>{googleConnection?.calendarName}</Text>
                      <Text style={s.connectedSub}>Google Calendar hesabınız bağlandı</Text>
                    </View>
                  </View>

                  {googleStatus === 'error' && googleError && (
                    <View style={s.errorBox} accessibilityRole="alert">
                      <Ionicons name="warning-outline" size={15} color={colors.error} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                      <Text style={s.errorText}>{googleError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={s.secondaryBtn}
                    onPress={handleGoogleDisconnect}
                    accessibilityRole="button"
                    accessibilityLabel="Google Calendar bağlantısını kes"
                  >
                    <Text style={s.secondaryBtnText}>Bağlantıyı Kes</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={s.oauthPreview}>
                    {[
                      { icon: 'calendar-outline', color: '#4285F4', label: 'Google Calendar erişimi' },
                      { icon: 'checkmark-circle-outline', color: colors.success, label: 'Habit bloklarını takvime ekle' },
                      { icon: 'sync-outline', color: '#f97316', label: 'Tek tuşla OAuth bağlanması' },
                    ].map(f => (
                      <View key={f.label} style={s.previewRow}>
                        <Ionicons name={f.icon as any} size={18} color={f.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                        <Text style={s.previewLabel}>{f.label}</Text>
                        <Ionicons name="checkmark" size={14} color={colors.textGhost} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                      </View>
                    ))}
                  </View>

                  <Text style={s.oauthNote}>
                    Google hesabınızdan takviminize erişim izni isteyeceğiz. Aderyth, bu izinle takvim blokları ve hatırlatma etkinliklerini ekleyebilir.
                  </Text>

                  {googleStatus === 'error' && googleError && (
                    <View style={s.errorBox} accessibilityRole="alert">
                      <Ionicons name="warning-outline" size={15} color={colors.error} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                      <Text style={s.errorText}>{googleError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: '#4285F4' }, googleStatus === 'connecting' && s.btnDisabled]}
                    onPress={handleGoogleConnect}
                    disabled={googleStatus === 'connecting'}
                    accessibilityRole="button"
                    accessibilityLabel={googleStatus === 'connecting' ? 'Google Calendar’a bağlanılıyor' : 'Google Calendar ile bağlan'}
                    accessibilityState={{ disabled: googleStatus === 'connecting', busy: googleStatus === 'connecting' }}
                  >
                    {googleStatus === 'connecting'
                      ? <ActivityIndicator size="small" color={colors.white} />
                      : <Ionicons name="logo-google" size={18} color={colors.white} />}
                    <Text style={s.primaryBtnText}>
                      {googleStatus === 'connecting' ? 'Bağlanıyor…' : 'Google Calendar ile Bağlan'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Universal Integration Detail Modal ─────────────────────────────── */}
      <IntegrationDetailModal
        item={detailItem}
        visible={detailItem !== null}
        onClose={() => setDetailItem(null)}
        accentColor={selected?.accentColor || colors.accent}
      />

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    margin: 16, padding: 14, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', position: 'relative',
  },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: colors.white },
  bannerSub: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  bannerBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: alphaHex(colors.accent, '20'), alignItems: 'center', justifyContent: 'center' },
  bannerBadgeText: { fontSize: 13, fontWeight: '700', color: colors.accent },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  featureCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 10, overflow: 'hidden', position: 'relative',
  },
  featureCardConnected: { borderColor: alphaHex(colors.success, '30') },
  featureLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureBody: { flex: 1 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: colors.white },
  featureDesc: { fontSize: 12, color: colors.textFaint, lineHeight: 16 },

  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeAvailable: { backgroundColor: alphaHex(colors.success, '18') },
  badgeConnected: { backgroundColor: alphaHex(colors.success, '20') },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextAvailable: { color: colors.success },
  badgeTextConnected: { color: colors.success },

  hint: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    marginTop: 4, padding: 12, borderRadius: 10,
    backgroundColor: colors.coolBlack850, borderWidth: 1, borderColor: colors.borderSubtle,
  },
  hintText: { flex: 1, fontSize: 12, color: colors.textGhost, lineHeight: 18 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 20, paddingBottom: 16 },
  sheetIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetTitleWrap: { flex: 1 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.white, marginBottom: 4 },
  sheetDesc: { fontSize: 13, color: colors.textDim, lineHeight: 18 },
  closeBtn: { padding: 4 },
  divider: { height: 1, backgroundColor: colors.border },
  itemList: { padding: 16 },
  stepList: { padding: 16, gap: 10 },

  // Notion bağlı
  connectedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: alphaHex(colors.success, '12'), borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: alphaHex(colors.success, '30'), marginBottom: 4,
  },
  connectedIconWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  connectedTitle: { fontSize: 15, fontWeight: '700', color: colors.success },
  connectedSub: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  dbLinks: { gap: 8, marginBottom: 8 },
  dbLink: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  dbLinkText: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' },

  // Notion bağlanma
  oauthPreview: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 12, marginBottom: 12,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewLabel: { flex: 1, fontSize: 14, color: colors.text },
  oauthNote: { fontSize: 12, color: colors.textFaint, lineHeight: 18, marginBottom: 16 },

  // Buttons
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.accent, borderRadius: 14, padding: 16, marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: colors.white },
  btnDisabled: { opacity: 0.55 },
  secondaryBtn: {
    marginTop: 10, paddingVertical: 13, borderRadius: 12,
    backgroundColor: colors.borderSubtle, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  secondaryBtnText: { fontSize: 14, color: colors.textFaint, fontWeight: '600' },

  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: alphaHex(colors.error, '10'), borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: alphaHex(colors.error, '28'), marginBottom: 8,
  },
  errorText: { flex: 1, fontSize: 12, color: colors.error, lineHeight: 17 },

  // Obsidian
  sectionLabel: { fontSize: 10, fontWeight: '700', color: colors.textGhost, letterSpacing: 1.2, marginTop: 4, marginBottom: 4 },
  featureChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  featureChip2: {},
  featureChipText: { fontSize: 12, color: colors.textDim },
  stepCard: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { fontSize: 12, fontWeight: '700', color: colors.white },
  stepTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  stepDesc: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  pathBox: { backgroundColor: colors.coolBlack950, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.borderSubtle },
  pathLabel: { fontSize: 10, fontWeight: '700', color: colors.textGhost, letterSpacing: 1, marginBottom: 4 },
  pathValue: { fontSize: 13, fontFamily: 'monospace', color: colors.accent },
  docsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: alphaHex(colors.accent, '10'), borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: alphaHex(colors.accent, '30'),
  },
  docsBtnText: { fontSize: 13, color: colors.accent, fontWeight: '500' },
});
