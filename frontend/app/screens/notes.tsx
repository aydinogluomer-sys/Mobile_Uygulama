import { colors } from '../../lib/tokens';
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNoteStore, type Note } from '../../store/noteStore';
import { EmptyState, Skeleton } from '../../components/ui';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import ConflictChoice from '../../components/ConflictChoice';
import { useCoreOutboxSync } from '../../hooks/useCoreOutboxSync';

export default function NotesScreen() {
  const { notes, loading, loadingMore, hasMore, loadMore, fetchNotes, addNote, updateNote, removeNote, search, conflicts, resolveConflict } = useNoteStore();
  // R02.05 — re-read on every outbox change, so a conflict appears the moment delivery reports it.
  useCoreOutboxSync();
  const noteConflicts = conflicts();
  const [resolving, setResolving] = useState(false);
  const [query, setQuery] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

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
    setShowEdit(true);
  }

  function openEdit(n: Note) {
    setEditing(n);
    setTitle(n.title);
    setContent(n.content);
    setShowEdit(true);
  }

  async function handleSave() {
    if (!title.trim() && !content.trim()) return;
    if (editing) {
      await updateNote(editing.id, { title, content });
    } else {
      await addNote(title, content);
    }
    setShowEdit(false);
  }

  function confirmDelete(n: Note) {
    Alert.alert('Notu Sil', `"${n.title || 'Not'}" silinsin mi?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeNote(n.id) },
    ]);
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
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
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (!results) loadMore(); }}
        ListFooterComponent={
          // Suppressed while a search is showing: those results are a bounded
          // server query, not a page of the list, so "load more" would be
          // continuing something the user is not looking at.
          results ? null : <LoadMoreFooter hasMore={hasMore} loading={loadingMore} onPress={loadMore} />
        }
        data={visible}
        ListHeaderComponent={noteConflicts.length > 0 ? (
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
        keyExtractor={(n) => n.id}
        numColumns={2}
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
            {item.title ? <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text> : null}
            <Text style={s.cardContent} numberOfLines={6}>{item.content}</Text>
            <Text style={s.cardDate}>{formatDate(item.updated_at)}</Text>
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

      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
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
              placeholderTextColor={colors.textGhost}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={s.contentInput}
              placeholder="Notunu yaz..."
              placeholderTextColor={colors.textGhost}
              multiline
              value={content}
              onChangeText={setContent}
              autoFocus={!editing}
            />

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
    padding: 14, borderWidth: 1, borderColor: colors.border,
    marginBottom: 10, minHeight: 100,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.white, marginBottom: 6 },
  cardContent: { fontSize: 13, color: colors.textDim, lineHeight: 18, flex: 1 },
  cardDate: { fontSize: 10, color: colors.textGhost, marginTop: 8 },

  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 15, color: colors.textGhost },

  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 16, backgroundColor: colors.textDim,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
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
