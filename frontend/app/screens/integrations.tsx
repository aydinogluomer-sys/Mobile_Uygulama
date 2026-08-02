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
import { useNotionStore } from '../../store/notionStore';
import { useGoogleCalendarStore } from '../../store/googleCalendarStore';

export default function IntegrationsScreen() {
  const [selected, setSelected] = useState<IntegrationCategory | null>(null);
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

  useEffect(() => { fetchStatus(); fetchGoogleStatus(); }, []);

  // Notion modalı açılınca OAuth URL'ini önceden çek → buton anında açılır
  useEffect(() => {
    if (notionModal && !isConnected) prefetchAuthUrl();
  }, [notionModal]);

  const connectedCount = INTEGRATION_CATEGORIES.flatMap(c => c.items).filter(i => i.status === 'connected').length + (isConnected ? 1 : 0) + (isGoogleConnected ? 1 : 0);

  function handleItemPress(item: IntegrationItem) {
    if (item.id === 'notion')   { setSelected(null); setTimeout(() => setNotionModal(true), 100); }
    if (item.id === 'calendar') { setSelected(null); setTimeout(() => setGoogleModal(true), 100); }
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
      {/* Özet bant */}
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <Ionicons name="git-network-outline" size={20} color="#D97757" />
          <View>
            <Text style={s.bannerTitle}>Entegrasyonlar</Text>
            <Text style={s.bannerSub}>
              {connectedCount > 0 ? `${connectedCount} bağlı servis` : "Harici servisleri Atlas'a bağlayın"}
            </Text>
          </View>
        </View>
        <View style={s.bannerBadge}>
          <Text style={s.bannerBadgeText}>{INTEGRATION_CATEGORIES.flatMap(c => c.items).length}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {INTEGRATION_CATEGORIES.map((cat) => (
          <IntegrationCategoryCard key={cat.id} category={cat} onPress={() => setSelected(cat)} />
        ))}

        {/* Notion öne çıkan kart */}
        <TouchableOpacity style={[s.featureCard, isConnected && s.featureCardConnected]} onPress={() => setNotionModal(true)}>
          <View style={s.featureLeft}>
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
                {isConnected ? `${connection.workspaceName} · Son sync: ${lastSynced ?? 'henüz yok'}` : 'Tek tuşla Notion hesabınıza bağlanın'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#56544B" />
        </TouchableOpacity>

{/* Google Calendar öne çıkan kart */}
        <TouchableOpacity style={[s.featureCard, isGoogleConnected && s.featureCardConnected]} onPress={() => setGoogleModal(true)}>
          <View style={s.featureLeft}>
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
              <Text style={s.featureDesc}>{isGoogleConnected ? `${googleConnection?.calendarName}` : 'Google Calendar hesabınızı bağlayın'}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#56544B" />
        </TouchableOpacity>



        <View style={s.hint}>
          <Ionicons name="information-circle-outline" size={16} color="#56544B" />
          <Text style={s.hintText}>Notion ve Google Calendar bağlantısı hazır. Diğer entegrasyonlar yakında geliyor.</Text>
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
                    <Ionicons name={selected.iconName as any} size={24} color={selected.accentColor} />
                  </View>
                  <View style={s.sheetTitleWrap}>
                    <Text style={s.sheetTitle}>{selected.title}</Text>
                    <Text style={s.sheetDesc} numberOfLines={2}>{selected.description}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelected(null)} style={s.closeBtn}>
                    <Ionicons name="close" size={22} color="#827E72" />
                  </TouchableOpacity>
                </View>
                <View style={s.divider} />
                <ScrollView contentContainerStyle={s.itemList}>
                  {selected.items.map((item) => (
                    <IntegrationItemCard
                      key={item.id}
                      item={item}
                      accentColor={selected.accentColor}
                      onPress={item.status === 'available' ? () => handleItemPress(item) : undefined}
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
                <Ionicons name="document-text-outline" size={24} color="#f97316" />
              </View>
              <View style={s.sheetTitleWrap}>
                <Text style={s.sheetTitle}>Notion</Text>
                <Text style={s.sheetDesc}>{isConnected ? connection!.workspaceName : 'Hesabınızla bağlayın'}</Text>
              </View>
              <TouchableOpacity onPress={() => setNotionModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={22} color="#827E72" />
              </TouchableOpacity>
            </View>
            <View style={s.divider} />

            <ScrollView contentContainerStyle={s.stepList}>
              {isConnected ? (
                /* ── Bağlı durum ── */
                <>
                  <View style={s.connectedBanner}>
                    <View style={s.connectedIconWrap}>
                      <Ionicons name="checkmark-circle" size={28} color="#87A678" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.connectedTitle}>{connection!.workspaceName}</Text>
                      <Text style={s.connectedSub}>Atlas veritabanları Notion&apos;da hazır</Text>
                    </View>
                  </View>

                  <View style={s.dbLinks}>
                    <TouchableOpacity style={s.dbLink} onPress={() => Linking.openURL(connection!.habitsUrl)}>
                      <Ionicons name="checkmark-circle-outline" size={16} color="#87A678" />
                      <Text style={s.dbLinkText}>Alışkanlık Takibi</Text>
                      <Ionicons name="open-outline" size={14} color="#56544B" />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.dbLink} onPress={() => Linking.openURL(connection!.tasksUrl)}>
                      <Ionicons name="list-outline" size={16} color="#D97757" />
                      <Text style={s.dbLinkText}>Görevler</Text>
                      <Ionicons name="open-outline" size={14} color="#56544B" />
                    </TouchableOpacity>
                  </View>

                  {notionStatus === 'error' && notionError && (
                    <View style={s.errorBox}>
                      <Ionicons name="warning-outline" size={15} color="#C76A6A" />
                      <Text style={s.errorText}>{notionError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.primaryBtn, notionStatus === 'syncing' && s.btnDisabled]}
                    onPress={handleSync}
                    disabled={notionStatus === 'syncing'}
                  >
                    {notionStatus === 'syncing'
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="sync-outline" size={18} color="#fff" />}
                    <Text style={s.primaryBtnText}>
                      {notionStatus === 'syncing' ? 'Senkronlanıyor…' : 'Bugünü Senkronla'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={s.secondaryBtn} onPress={handleDisconnect}>
                    <Text style={s.secondaryBtnText}>Bağlantıyı Kes</Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* ── Bağlanma ekranı ── */
                <>
                  {/* Ne yapacağını göster */}
                  <View style={s.oauthPreview}>
                    {[
                      { icon: 'checkmark-circle-outline', color: '#87A678', label: 'Alışkanlık Takibi veritabanı' },
                      { icon: 'list-outline', color: '#D97757', label: 'Görevler veritabanı' },
                      { icon: 'sync-outline', color: '#f97316', label: 'Günlük otomatik sync' },
                    ].map(f => (
                      <View key={f.label} style={s.previewRow}>
                        <Ionicons name={f.icon as any} size={18} color={f.color} />
                        <Text style={s.previewLabel}>{f.label}</Text>
                        <Ionicons name="checkmark" size={14} color="#56544B" />
                      </View>
                    ))}
                  </View>

                  <Text style={s.oauthNote}>
                    Notion hesabınızda oturum açmanız istenecek. Atlas, seçtiğiniz workspace&apos;e iki veritabanı oluşturacak.
                  </Text>

                  {notionStatus === 'error' && notionError && (
                    <View style={s.errorBox}>
                      <Ionicons name="warning-outline" size={15} color="#C76A6A" />
                      <Text style={s.errorText}>{notionError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: '#f97316' }, notionStatus === 'connecting' && s.btnDisabled]}
                    onPress={handleConnect}
                    disabled={notionStatus === 'connecting'}
                  >
                    {notionStatus === 'connecting'
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="logo-google" size={18} color="#fff" />}
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
                <Ionicons name="calendar-outline" size={24} color="#4285F4" />
              </View>
              <View style={s.sheetTitleWrap}>
                <Text style={s.sheetTitle}>Google Calendar</Text>
                <Text style={s.sheetDesc}>{isGoogleConnected ? googleConnection?.calendarName : 'Hesabınızla bağlayın'}</Text>
              </View>
              <TouchableOpacity onPress={() => setGoogleModal(false)} style={s.closeBtn}>
                <Ionicons name="close" size={22} color="#827E72" />
              </TouchableOpacity>
            </View>
            <View style={s.divider} />

            <ScrollView contentContainerStyle={s.stepList}>
              {isGoogleConnected ? (
                <>
                  <View style={s.connectedBanner}>
                    <View style={s.connectedIconWrap}>
                      <Ionicons name="checkmark-circle" size={28} color="#87A678" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.connectedTitle}>{googleConnection?.calendarName}</Text>
                      <Text style={s.connectedSub}>Google Calendar hesabınız bağlandı</Text>
                    </View>
                  </View>

                  {googleStatus === 'error' && googleError && (
                    <View style={s.errorBox}>
                      <Ionicons name="warning-outline" size={15} color="#C76A6A" />
                      <Text style={s.errorText}>{googleError}</Text>
                    </View>
                  )}

                  <TouchableOpacity style={s.secondaryBtn} onPress={handleGoogleDisconnect}>
                    <Text style={s.secondaryBtnText}>Bağlantıyı Kes</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={s.oauthPreview}>
                    {[
                      { icon: 'calendar-outline', color: '#4285F4', label: 'Google Calendar erişimi' },
                      { icon: 'checkmark-circle-outline', color: '#87A678', label: 'Habit bloklarını takvime ekle' },
                      { icon: 'sync-outline', color: '#f97316', label: 'Tek tuşla OAuth bağlanması' },
                    ].map(f => (
                      <View key={f.label} style={s.previewRow}>
                        <Ionicons name={f.icon as any} size={18} color={f.color} />
                        <Text style={s.previewLabel}>{f.label}</Text>
                        <Ionicons name="checkmark" size={14} color="#56544B" />
                      </View>
                    ))}
                  </View>

                  <Text style={s.oauthNote}>
                    Google hesabınızdan takviminize erişim izni isteyeceğiz. Atlas, bu izinle takvim blokları ve hatırlatma etkinliklerini ekleyebilir.
                  </Text>

                  {googleStatus === 'error' && googleError && (
                    <View style={s.errorBox}>
                      <Ionicons name="warning-outline" size={15} color="#C76A6A" />
                      <Text style={s.errorText}>{googleError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: '#4285F4' }, googleStatus === 'connecting' && s.btnDisabled]}
                    onPress={handleGoogleConnect}
                    disabled={googleStatus === 'connecting'}
                  >
                    {googleStatus === 'connecting'
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="logo-google" size={18} color="#fff" />}
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

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    margin: 16, padding: 14, borderRadius: 14,
    backgroundColor: '#1D1C17', borderWidth: 1, borderColor: '#383528',
  },
  bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  bannerSub: { fontSize: 12, color: '#827E72', marginTop: 2 },
  bannerBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#D9775720', alignItems: 'center', justifyContent: 'center' },
  bannerBadgeText: { fontSize: 13, fontWeight: '700', color: '#D97757' },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  featureCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1D1C17', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#383528', marginBottom: 10,
  },
  featureCardConnected: { borderColor: '#87A67830' },
  featureLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureBody: { flex: 1 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  featureDesc: { fontSize: 12, color: '#827E72', lineHeight: 16 },

  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeAvailable: { backgroundColor: '#87A67818' },
  badgeConnected: { backgroundColor: '#87A67820' },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextAvailable: { color: '#87A678' },
  badgeTextConnected: { color: '#87A678' },

  hint: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    marginTop: 4, padding: 12, borderRadius: 10,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#28261F',
  },
  hintText: { flex: 1, fontSize: 12, color: '#56544B', lineHeight: 18 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1D1C17', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 20, paddingBottom: 16 },
  sheetIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetTitleWrap: { flex: 1 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 4 },
  sheetDesc: { fontSize: 13, color: '#BFBBAE', lineHeight: 18 },
  closeBtn: { padding: 4 },
  divider: { height: 1, backgroundColor: '#383528' },
  itemList: { padding: 16 },
  stepList: { padding: 16, gap: 10 },

  // Notion bağlı
  connectedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#87A67812', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#87A67830', marginBottom: 4,
  },
  connectedIconWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  connectedTitle: { fontSize: 15, fontWeight: '700', color: '#87A678' },
  connectedSub: { fontSize: 12, color: '#827E72', marginTop: 2 },
  dbLinks: { gap: 8, marginBottom: 8 },
  dbLink: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1D1C17', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#383528',
  },
  dbLinkText: { flex: 1, fontSize: 14, color: '#EDEAE0', fontWeight: '500' },

  // Notion bağlanma
  oauthPreview: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#383528', gap: 12, marginBottom: 12,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewLabel: { flex: 1, fontSize: 14, color: '#EDEAE0' },
  oauthNote: { fontSize: 12, color: '#827E72', lineHeight: 18, marginBottom: 16 },

  // Buttons
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#D97757', borderRadius: 14, padding: 16, marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  btnDisabled: { opacity: 0.55 },
  secondaryBtn: {
    marginTop: 10, paddingVertical: 13, borderRadius: 12,
    backgroundColor: '#28261F', alignItems: 'center',
    borderWidth: 1, borderColor: '#383528',
  },
  secondaryBtnText: { fontSize: 14, color: '#827E72', fontWeight: '600' },

  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#C76A6A10', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#C76A6A28', marginBottom: 8,
  },
  errorText: { flex: 1, fontSize: 12, color: '#C76A6A', lineHeight: 17 },

  // Obsidian
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#56544B', letterSpacing: 1.2, marginTop: 4, marginBottom: 4 },
  featureChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#1D1C17', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#383528',
  },
  featureChip2: {},
  featureChipText: { fontSize: 12, color: '#BFBBAE' },
  stepCard: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#383528',
  },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#D97757', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  stepTitle: { fontSize: 14, fontWeight: '600', color: '#EDEAE0' },
  stepDesc: { fontSize: 12, color: '#827E72', lineHeight: 17 },
  pathBox: { backgroundColor: '#0a0a0a', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#28261F' },
  pathLabel: { fontSize: 10, fontWeight: '700', color: '#56544B', letterSpacing: 1, marginBottom: 4 },
  pathValue: { fontSize: 13, fontFamily: 'monospace', color: '#D97757' },
  docsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#D9775710', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#D9775730',
  },
  docsBtnText: { fontSize: 13, color: '#D97757', fontWeight: '500' },
});
