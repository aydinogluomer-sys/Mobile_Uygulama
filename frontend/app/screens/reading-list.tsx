import { alphaHex, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { confirm } from '../../lib/dialog';
import { checkHttpUrl, MAX_URL_CHARS, URL_PROBLEM_TR } from '../../lib/inputLimits';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useReadingListStore, ReadingType, ReadingStatus, ReadingItem } from '../../store/readingListStore';
import { EditorialBanner, EmptyState, FormError, LoadErrorState, Skeleton } from '../../components/ui';
import { AtmosphericScreenCanvas, EmbeddedFiligree } from '../../components/spatial';
import { BENTO_ART, CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import LoadMoreFooter from '../../components/LoadMoreFooter';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

type StatusTab = { key: ReadingStatus; label: string; color: string };
type TypeOption = { key: ReadingType; label: string; icon: keyof typeof Ionicons.glyphMap; color: string };

const getStatusTabs = (colors: Palette): StatusTab[] => [
  { key: 'want_to_read', label: 'Okuyacak', color: colors.textFaint },
  { key: 'reading',      label: 'Okuyor',   color: colors.accent },
  { key: 'completed',    label: 'Bitti',     color: colors.success },
];

const getTypeOptions = (colors: Palette): TypeOption[] => [
  { key: 'book',    label: 'Kitap',   icon: 'book-outline',         color: colors.accent },
  { key: 'article', label: 'Makale',  icon: 'newspaper-outline',    color: colors.teal },
  { key: 'video',   label: 'Video',   icon: 'videocam-outline',     color: colors.error },
  { key: 'podcast', label: 'Podcast', icon: 'headset-outline',      color: colors.warning },
  { key: 'other',   label: 'Diğer',   icon: 'ellipsis-horizontal-outline', color: colors.textDim },
];

function StarRating({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onChange(n)}
          accessibilityRole="radio"
          accessibilityLabel={`${n} yıldız ver`}
          accessibilityState={{ selected: n === value, checked: n === value }}
        >
          <Ionicons name={n <= (value ?? 0) ? 'star' : 'star-outline'} size={18} color={colors.warning} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function ReadingListScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const STATUS_TABS = getStatusTabs(colors);
  const TYPE_OPTIONS = getTypeOptions(colors);
  const TYPE_MAP = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.key, t])) as Record<ReadingType, TypeOption>;
  // Each tab owns its own page and cursor now: the store no longer holds one
  // unbounded array that the screen slices. See store/readingListStore.ts.
  const { tabs, counts, fetchItems, loadMore, addItem, updateStatus, updateRating, removeItem, error: loadError } =
    useReadingListStore(
      useShallow((st) => ({
        tabs: st.tabs,
        counts: st.counts,
        fetchItems: st.fetchItems,
        loadMore: st.loadMore,
        addItem: st.addItem,
        updateStatus: st.updateStatus,
        updateRating: st.updateRating,
        removeItem: st.removeItem,
        error: st.error,
      })),
    );
  const [activeTab, setActiveTab] = useState<ReadingStatus>('want_to_read');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [url, setUrl] = useState('');
  const [urlProblem, setUrlProblem] = useState<string | null>(null);
  const [type, setType] = useState<ReadingType>('book');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Load the tab the user is actually looking at, and re-load when it
  // changes -- filtering happens server-side, so switching tabs is a fetch.
  useEffect(() => { fetchItems(activeTab); }, [activeTab, fetchItems]);

  const tab = tabs[activeTab];
  const filtered = tab.items;
  const loading = tab.loading;

  async function handleAdd() {
    if (!title.trim()) return;
    const urlCheck = checkHttpUrl(url);
    if (!urlCheck.ok) {
      setUrlProblem(URL_PROBLEM_TR[urlCheck.problem]);
      return;
    }
    setUrlProblem(null);
    const ok = await addItem({ title, author, type, url: urlCheck.url ?? undefined });
    if (!ok) {
      setSaveError(useReadingListStore.getState().error ?? 'Listeye eklenemedi. Yazdıkların burada duruyor, tekrar dene.');
      return;
    }
    setSaveError(null);
    setUrlProblem(null);
    setTitle(''); setAuthor(''); setUrl(''); setType('book');
    setShowAdd(false);
  }

  async function handleDelete(item: ReadingItem) {
    if (await confirm({ title: 'Sil', message: `"${item.title}" listeden kaldırılsın mı?`, confirmText: 'Sil', destructive: true })) {
      const ok = await removeItem(item.id);
      setActionError(ok ? null : (useReadingListStore.getState().error ?? 'Kayıt listeden kaldırılamadı.'));
    }
  }

  function nextStatus(current: ReadingStatus): ReadingStatus {
    if (current === 'want_to_read') return 'reading';
    if (current === 'reading') return 'completed';
    return 'want_to_read';
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.libraryPinboard}
        textureSource={TEXTURES.archivalPaper}
        scrim={0.62}
        tintColor={colors.accent}
      />

      {/* Segment tabs */}
      <View style={s.tabs}>
        {STATUS_TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[s.tab, activeTab === t.key && { borderBottomColor: t.color, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={`${t.label}${counts[t.key] > 0 ? `, ${counts[t.key]} kayıt` : ''}`}
            accessibilityState={{ selected: activeTab === t.key }}
          >
            <Text style={[s.tabText, activeTab === t.key && { color: t.color }]}>
              {t.label}
            </Text>
            {counts[t.key] > 0 && (
              <View style={[s.tabBadge, { backgroundColor: t.color }]}>
                <Text style={s.tabBadgeText}>{counts[t.key]}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <FormError message={actionError} />
        <EditorialBanner
          source={SCREEN_BANNERS.readingLibrary}
          textureSource={TEXTURES.archivalPaper}
          eyebrow="KÜTÜPHANE RAFI"
          title="Okuma Listesi"
          subtitle="Kitap, makale, podcast ve öğrenme kaynakların."
          accentColor={colors.accent}
          minHeight={90}
          style={{ marginBottom: 12 }}
        />
        {loading && filtered.length === 0 ? (
          // Kart şekli sabit: tür ikonu + başlık + yazar + tür rozeti. Boş
          // durumu göstermek yanıltıcı olurdu, veri henüz yolda.
          [0, 1, 2].map((i) => (
            <View key={i} style={s.card}>
              <View style={s.cardLeft}>
                <Skeleton width={40} height={40} />
                <View style={s.cardBody}>
                  <Skeleton width="75%" height={15} />
                  <Skeleton width="40%" height={12} />
                  <Skeleton width={54} height={11} style={{ marginTop: 4 }} />
                </View>
              </View>
            </View>
          ))
        ) : filtered.length === 0 && loadError ? (
          // R06.06 — not reached is not the same as empty
          <LoadErrorState what="Okuma listesi" onRetry={() => { void fetchItems(activeTab); }} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title={
              activeTab === 'want_to_read' ? 'Okuma listeniz boş' :
              activeTab === 'reading' ? 'Şu an okunan yok' : 'Tamamlanan yok'
            }
            hint="Kitap, makale, video ya da podcast ekleyip buradan takip et."
            ctaLabel="Listeye ekle"
            onCta={() => { setSaveError(null); setUrlProblem(null); setShowAdd(true); }}
            color={STATUS_TABS.find((t) => t.key === activeTab)?.color}
          />
        ) : (
          filtered.map((item) => {
            const typeInfo = TYPE_MAP[item.type];
            const nextColor = STATUS_TABS.find((t) => t.key === nextStatus(item.status))?.color ?? colors.accent;
            return (
              <View
                key={item.id}
                style={[s.card, { borderLeftWidth: 4, borderLeftColor: typeInfo.color }]}
              >
                <View style={s.exlibrisPlate} pointerEvents="none" {...decorativeA11y}>
                  <Image
                    source={BENTO_ART.bookExlibris}
                    style={s.exlibrisImg}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.surface, 0.72) }]} />
                </View>
                <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" opacity={0.14} size={82} />

                <View style={s.cardLeft}>
                  <View style={[s.typeIcon, { backgroundColor: alphaHex(typeInfo.color, '20') }]}>
                    <Ionicons name={typeInfo.icon} size={18} color={typeInfo.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  </View>
                  <View style={s.cardBody}>
                    <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                    {item.author ? <Text style={s.cardAuthor}>{item.author}</Text> : null}
                    <View style={s.cardMeta}>
                      <Text style={[s.typeBadge, { color: typeInfo.color }]}>{typeInfo.label}</Text>
                      {item.rating && <StarRating value={item.rating} onChange={(r) => updateRating(item.id, r)} />}
                    </View>
                  </View>
                </View>
                <View style={s.cardActions}>
                  <TouchableOpacity
                    style={[s.statusBtn, { backgroundColor: alphaHex(nextColor, '20') }]}
                    onPress={() => updateStatus(item.id, nextStatus(item.status))}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `${item.title}: ` +
                      `${STATUS_TABS.find((t) => t.key === nextStatus(item.status))?.label} durumuna taşı`
                    }
                  >
                    <Ionicons
                      name={item.status === 'completed' ? 'refresh-outline' : 'arrow-forward-outline'}
                      size={14}
                      color={nextColor}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.deleteBtn}
                    onPress={() => handleDelete(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Listeden kaldır: ${item.title}`}
                  >
                    <Ionicons name="trash-outline" size={14} color={colors.textGhost} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        <LoadMoreFooter hasMore={tab.hasMore} loading={tab.loadingMore} onPress={() => loadMore(activeTab)} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={s.fab}
        onPress={() => { setSaveError(null); setUrlProblem(null); setShowAdd(true); }}
        accessibilityRole="button"
        accessibilityLabel="Okuma listesine yeni kayıt ekle"
      >
        <Ionicons name="add" size={26} color={colors.white} />
      </TouchableOpacity>

      {/* Ekle Modal */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" opacity={0.14} size={118} />
            <Text style={s.sheetTitle}>Listeye Ekle</Text>

            <TextInput
              style={s.input}
              placeholder="Başlık *"
              placeholderTextColor={colors.textFaint}
              value={title}
              onChangeText={setTitle}
              autoFocus
            />
            <TextInput
              style={s.input}
              placeholder="Yazar / Kaynak"
              placeholderTextColor={colors.textFaint}
              value={author}
              onChangeText={setAuthor}
            />
            <TextInput
              style={s.input}
              placeholder="URL (opsiyonel)"
              placeholderTextColor={colors.textFaint}
              value={url}
              onChangeText={(v) => {
                setUrl(v);
                if (urlProblem) setUrlProblem(null);
              }}
              autoCapitalize="none"
              keyboardType="url"
              maxLength={MAX_URL_CHARS}
            />
            {urlProblem ? (
              <Text style={s.urlHint} accessibilityLiveRegion="polite">
                {urlProblem}
              </Text>
            ) : null}

            <Text style={s.fieldLabel}>TÜR</Text>
            <View style={s.typeRow}>
              {TYPE_OPTIONS.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[s.typeBtn, type === t.key && { backgroundColor: alphaHex(t.color, '25'), borderColor: t.color }]}
                  onPress={() => setType(t.key)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Tür: ${t.label}`}
                  accessibilityState={{ selected: type === t.key, checked: type === t.key }}
                >
                  <Ionicons name={t.icon} size={16} color={type === t.key ? t.color : colors.textFaint} />
                  <Text style={[s.typeBtnText, type === t.key && { color: t.color }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <FormError message={saveError} />

            <View style={s.sheetActions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setShowAdd(false)}
                accessibilityRole="button"
                accessibilityLabel="İptal"
              >
                <Text style={s.cancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, !title.trim() && s.confirmDisabled]}
                onPress={handleAdd}
                disabled={!title.trim()}
                accessibilityRole="button"
                accessibilityLabel="Listeye ekle"
                accessibilityState={{ disabled: !title.trim() }}
              >
                <Text style={s.confirmText}>Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  tab: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textFaint },
  tabBadge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontSize: 10, color: colors.white, fontWeight: '700' },

  content: { padding: 16, paddingBottom: 100 },

  empty: { alignItems: 'center', gap: 8, paddingTop: 60 },
  emptyTitle: { fontSize: 16, color: colors.textFaint, fontWeight: '600' },
  emptySub: { fontSize: 13, color: colors.textFaint },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 10,
    overflow: 'hidden', position: 'relative',
  },
  exlibrisPlate: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 104,
    overflow: 'hidden',
  },
  exlibrisImg: {
    width: '100%',
    height: '100%',
    opacity: 0.48,
  },
  cardLeft: { flexDirection: 'row', gap: 12, flex: 1 },
  typeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 20 },
  cardAuthor: { fontSize: 12, color: colors.textFaint },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  typeBadge: { fontSize: 11, fontWeight: '600' },

  cardActions: { gap: 8, marginLeft: 8 },
  statusBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  deleteBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.borderSubtle, alignItems: 'center', justifyContent: 'center' },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, overflow: 'hidden', position: 'relative',
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 16 },
  input: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  urlHint: { fontSize: 12, color: colors.warning, marginTop: -6, marginBottom: 10 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1, marginBottom: 8 },
  typeRow: { flexDirection: 'row', gap: 6, marginBottom: 20, flexWrap: 'wrap' },
  typeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  typeBtnText: { fontSize: 12, fontWeight: '600', color: colors.textFaint },
  sheetActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  confirmBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 15, color: colors.white, fontWeight: '700' },
});
