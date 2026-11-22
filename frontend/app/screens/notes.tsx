import { colors, alphaHex, hexA } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { useEffect, useRef, useState } from 'react';
import ReadingListScreen from './reading-list';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, useWindowDimensions,
} from 'react-native';
import { confirm, notify } from '../../lib/dialog';
import { useFocusParam } from '../../hooks/useFocusParam';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNoteStore, type Note } from '../../store/noteStore';
import { EditorialBanner, EmptyState, FormError, LoadErrorState, Skeleton, TexturedSurface } from '../../components/ui';
import { AtmosphericScreenCanvas, EmbeddedFiligree } from '../../components/spatial';
import { BENTO_ART, CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import ConflictChoice from '../../components/ConflictChoice';
import { useCoreOutboxSync } from '../../hooks/useCoreOutboxSync';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

export default function NotesScreen() {
  const { width } = useWindowDimensions();
  const numCols = width >= 960 ? 3 : 2;
  const { notes, loading, loadingMore, hasMore, loadMore, fetchNotes, addNote, updateNote, removeNote, search, conflicts, resolveConflict, error: loadError } = useNoteStore();
  // R02.05 — re-read on every outbox change, so a conflict appears the moment delivery reports it.
  useCoreOutboxSync();
  const noteConflicts = conflicts();
  const [resolving, setResolving] = useState(false);
  const [query, setQuery] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'notes' | 'reading_list'>('notes');
  const [initialLoaded, setInitialLoaded] = useState(notes.length > 0);
  const { id: focusId, consume: consumeFocus } = useFocusParam();
  const consumedFocusRef = useRef<string | null>(null);

  useEffect(() => {
    void Promise.resolve(fetchNotes()).finally(() => setInitialLoaded(true));
  }, [fetchNotes]);

  useEffect(() => {
    if (!focusId) {
      consumedFocusRef.current = null;
      return;
    }
    if (consumedFocusRef.current === focusId) return;
    const match = notes.find((n) => n.id === focusId);
    if (match) {
      consumedFocusRef.current = focusId;
      setViewMode('notes');
      openEdit(match);
      consumeFocus();
      return;
    }
    if (initialLoaded && !loading) {
      consumedFocusRef.current = focusId;
      consumeFocus();
      void notify('Öğe bulunamadı', 'Aradığın not silinmiş ya da taşınmış olabilir.');
    }
  }, [focusId, notes, initialLoaded, loading, consumeFocus]);

  // Search is SERVER-side now, so it cannot be computed during render. The
  // previous `search(query)` filtered the in-memory array, which only ever
  // searched the rows that happened to be loaded -- and paginating the list
  // made that strictly worse. Debounced so typing does not issue a request
  // per keystroke.
  const [results, setResults] = useState<Note[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults(null); setSearching(false); return; }
    setSearching(true);
    let alive = true;
    const t = setTimeout(async () => {
      const found = await search(term);
      if (alive) { setResults(found); setSearching(false); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query, search]);

  const visible = results ?? notes;

  function openNew() {
    setEditing(null);
    setTitle('');
    setContent('');
    setSaveError(null);
    setShowEdit(true);
  }

  function openEdit(n: Note) {
    setEditing(n);
    setTitle(n.title);
    setContent(n.content);
    setSaveError(null);
    setShowEdit(true);
  }

  async function handleSave() {
    if (!title.trim() && !content.trim()) return;
    const ok = editing ? await updateNote(editing.id, { title, content }) : (await addNote(title, content)) !== null;
    if (!ok) {
      setSaveError(useNoteStore.getState().error ?? 'Not kaydedilemedi. Yazdıkların burada duruyor, tekrar dene.');
      return;
    }
    setSaveError(null);
    setShowEdit(false);
    // Not satırı eklendi ama yalnız bellekte kaldıysa (cihaza yazılamadı) uyarı liste başında kalır.
    setActionError(useNoteStore.getState().error);
  }

  async function confirmDelete(n: Note) {
    if (await confirm({ title: 'Notu Sil', message: `"${n.title || 'Not'}" silinsin mi?`, confirmText: 'Sil', destructive: true })) {
      const ok = await removeNote(n.id);
      setActionError(ok ? null : (useNoteStore.getState().error ?? 'Not silinemedi.'));
    }
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.libraryPinboard}
        textureSource={TEXTURES.archivalPaper}
        scrim={0.6}
        tintColor={colors.primary}
      />

      {/* Görünüm Geçişi: Notlar vs Okuma Listesi */}
      <View style={s.topBar}>
        <View style={s.viewSwitch}>
          <TouchableOpacity
            style={[s.viewBtn, viewMode === 'notes' && s.viewBtnActive]}
            onPress={() => { haptic.select(); setViewMode('notes'); }}
            accessibilityRole="button"
            accessibilityLabel="Notlar görünümü"
          >
            <Ionicons name="document-text-outline" size={14} color={viewMode === 'notes' ? colors.primary : colors.textDim} />
            <Text style={[s.viewText, viewMode === 'notes' && s.viewTextActive]}>Notlar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.viewBtn, viewMode === 'reading_list' && s.viewBtnActive]}
            onPress={() => { haptic.select(); setViewMode('reading_list'); }}
            accessibilityRole="button"
            accessibilityLabel="Okuma listesi görünümü"
          >
            <Ionicons name="book-outline" size={14} color={viewMode === 'reading_list' ? colors.primary : colors.textDim} />
            <Text style={[s.viewText, viewMode === 'reading_list' && s.viewTextActive]}>Okuma Listesi</Text>
          </TouchableOpacity>
        </View>
      </View>

      {viewMode === 'reading_list' ? (
        <View style={{ flex: 1 }}>
          <ReadingListScreen />
        </View>
      ) : (
        <>
          {/* Arama */}
          <View style={s.searchRow}>
            <Ionicons name="search-outline" size={16} color={colors.textFaint} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <TextInput
              style={s.searchInput}
              placeholder="Notlarda ara..."
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Aramayı temizle"
              >
                <Ionicons name="close-circle" size={16} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            key={`pinboard-${numCols}`}
            onEndReachedThreshold={0.4}
            onEndReached={() => { if (!results) loadMore(); }}
            ListFooterComponent={
              // Suppressed while a search is showing: those results are a bounded
              // server query, not a page of the list, so "load more" would be
              // continuing something the user is not looking at.
              results ? null : <LoadMoreFooter hasMore={hasMore} loading={loadingMore} onPress={loadMore} />
            }
            data={visible}
            ListHeaderComponent={
              <View>
                <View style={{ paddingHorizontal: 10 }}>
                  <FormError message={actionError} />
                </View>
                <EditorialBanner
                  source={SCREEN_BANNERS.notesAtelier}
                  textureSource={TEXTURES.archivalPaper}
                  eyebrow="BİLGİ ATÖLYESİ"
                  title="Notlar & Fikirler"
                  subtitle="Hızlı düşünceler, taslaklar ve kalıcı notların."
                  accentColor={colors.primary}
                  minHeight={90}
                  style={{ marginHorizontal: 10, marginBottom: 12 }}
                />
                {noteConflicts.length > 0 ? (
                  <View>
                    {noteConflicts.map((c) => {
                      const t = notes.find((n) => n.id === c.entityId)?.title || String((c.payload as { title?: string }).title ?? '');
                      return (
                        <ConflictChoice key={c.operationId} what={t ? `"${t}" notu` : 'Bir not'} busy={resolving}
                          onChoose={async (choice) => { setResolving(true); await resolveConflict(c.entityId, choice); setResolving(false); }} />
                      );
                    })}
                  </View>
                ) : null}
              </View>
            }
            keyExtractor={(n) => n.id}
            numColumns={numCols}
            columnWrapperStyle={s.row}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              // `loading` bugüne kadar okunmuyordu: getirme sürerken liste boş
              // olduğu için "Henüz not yok" yanıp sönüyordu — kullanıcıya olmayan
              // bir gerçeği söyleyen boş durum. Önce gelen ızgaranın şeklini kur.
              loading || searching ? (
                <View style={s.skeletonGrid}>
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} width="47%" height={100} />
                  ))}
                </View>
              ) : !query && loadError ? (
                // R06.06 — not reached is not the same as empty
                <LoadErrorState what="Notlar" onRetry={() => { void fetchNotes(); }} />
              ) : query ? (
                <EmptyState
                  icon="search-outline"
                  title="Sonuç bulunamadı"
                  hint={`"${query}" ile eşleşen not yok. Başka bir kelime dene.`}
                />
              ) : (
                <EmptyState
                  icon="document-text-outline"
                  title="Henüz not yok"
                  hint="Aklına takılanı hemen yaz — sağ alttaki artı ile başla."
                />
              )
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.card}
                onPress={() => openEdit(item)}
                onLongPress={() => confirmDelete(item)}
                accessibilityRole="button"
                accessibilityLabel={item.title || item.content.slice(0, 60) || 'Boş not'}
                accessibilityHint="Düzenlemek için dokun, silmek için basılı tut"
              >
                <TexturedSurface source={TEXTURES.archivalPaper} textureOpacity={0.07} overlayOnly />
                <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" opacity={0.15} size={78} />
                <View style={s.pinHeaderStrip} pointerEvents="none" {...decorativeA11y}>
                  <Image
                    source={BENTO_ART.noteParchment}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.surface, 0.55) }]} />
                  <View style={s.brassPinTack} />
                </View>
                <View style={s.cardInner}>
                  {item.title ? <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text> : null}
                  <Text style={s.cardContent} numberOfLines={6}>{item.content}</Text>
                  <Text style={s.cardDate}>{formatDate(item.updated_at)}</Text>
                </View>
              </TouchableOpacity>
            )}
          />

          <TouchableOpacity
            style={s.fab}
            onPress={openNew}
            accessibilityRole="button"
            accessibilityLabel="Yeni not"
          >
            <Ionicons name="add" size={26} color={colors.white} />
          </TouchableOpacity>
        </>
      )}

      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" opacity={0.14} size={120} />
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle} accessibilityRole="header">{editing ? 'Notu Düzenle' : 'Yeni Not'}</Text>
              <View style={s.sheetActions}>
                {editing && (
                  <TouchableOpacity
                    onPress={() => { confirmDelete(editing); setShowEdit(false); }}
                    style={s.deleteBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Notu sil"
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setShowEdit(false)}
                  style={s.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Kapat"
                >
                  <Ionicons name="close" size={20} color={colors.textDim} />
                </TouchableOpacity>
              </View>
            </View>

            <TextInput
              style={s.titleInput}
              placeholder="Başlık..."
              placeholderTextColor={colors.textFaint}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={s.contentInput}
              placeholder="Notunu yaz..."
              placeholderTextColor={colors.textFaint}
              multiline
              value={content}
              onChangeText={setContent}
              autoFocus={!editing}
            />

            <FormError message={saveError} />

            <TouchableOpacity
              style={[s.saveBtn, (!title.trim() && !content.trim()) && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!title.trim() && !content.trim()}
              accessibilityRole="button"
              accessibilityLabel="Kaydet"
              accessibilityState={{ disabled: !title.trim() && !content.trim() }}
            >
              <Text style={s.saveBtnText}>Kaydet</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: 'transparent',
  },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 9,
    gap: 6,
  },
  viewBtnActive: {
    backgroundColor: alphaHex(colors.primary, '20'),
    borderColor: colors.primary,
    borderWidth: 1,
  },
  viewText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
  },
  viewTextActive: {
    color: colors.primary,
  },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: 16, backgroundColor: colors.surface, borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.white },

  row: { paddingHorizontal: 10, gap: 10 },
  listContent: { paddingHorizontal: 6, paddingBottom: 100 },
  // Yükleme yer tutucusu, gerçek kart ızgarasının geometrisini taklit eder.
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 10 },
  card: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 10, minHeight: 118, overflow: 'hidden', position: 'relative',
  },
  pinHeaderStrip: {
    height: 22,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    position: 'relative',
    overflow: 'hidden',
  },
  brassPinTack: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warning,
    borderWidth: 1.5,
    borderColor: colors.bgSunk,
  },
  cardInner: {
    padding: 13,
    flex: 1,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.white, marginBottom: 6 },
  cardContent: { fontSize: 13, color: colors.textDim, lineHeight: 18, flex: 1 },
  cardDate: { fontSize: 10, color: colors.textFaint, marginTop: 8 },

  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 15, color: colors.textFaint },

  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '90%', overflow: 'hidden', position: 'relative',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  sheetActions: { flexDirection: 'row', gap: 8 },
  deleteBtn: { padding: 6 },
  closeBtn: { padding: 6 },

  titleInput: {
    fontSize: 18, fontWeight: '600', color: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingVertical: 8, marginBottom: 12,
  },
  contentInput: {
    fontSize: 14, color: colors.text, minHeight: 200,
    textAlignVertical: 'top', lineHeight: 22, marginBottom: 16,
  },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
