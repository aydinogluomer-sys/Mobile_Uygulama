import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNoteStore, type Note } from '../../store/noteStore';

export default function NotesScreen() {
  const { notes, loading, fetchNotes, addNote, updateNote, removeNote, search } = useNoteStore();
  const [query, setQuery] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => { fetchNotes(); }, []);

  const visible = query.trim() ? search(query) : notes;

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
        <Ionicons name="search-outline" size={16} color="#827E72" />
        <TextInput
          style={s.searchInput}
          placeholder="Notlarda ara..."
          placeholderTextColor="#827E72"
          value={query}
          onChangeText={setQuery}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={16} color="#827E72" />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(n) => n.id}
        numColumns={2}
        columnWrapperStyle={s.row}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="document-text-outline" size={40} color="#383528" />
            <Text style={s.emptyText}>{query ? 'Sonuç bulunamadı' : 'Henüz not yok'}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} onPress={() => openEdit(item)} onLongPress={() => confirmDelete(item)}>
            {item.title ? <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text> : null}
            <Text style={s.cardContent} numberOfLines={6}>{item.content}</Text>
            <Text style={s.cardDate}>{formatDate(item.updated_at)}</Text>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={s.fab} onPress={openNew}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>{editing ? 'Notu Düzenle' : 'Yeni Not'}</Text>
              <View style={s.sheetActions}>
                {editing && (
                  <TouchableOpacity onPress={() => { confirmDelete(editing); setShowEdit(false); }} style={s.deleteBtn}>
                    <Ionicons name="trash-outline" size={18} color="#C76A6A" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowEdit(false)} style={s.closeBtn}>
                  <Ionicons name="close" size={20} color="#BFBBAE" />
                </TouchableOpacity>
              </View>
            </View>

            <TextInput
              style={s.titleInput}
              placeholder="Başlık..."
              placeholderTextColor="#56544B"
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={s.contentInput}
              placeholder="Notunu yaz..."
              placeholderTextColor="#56544B"
              multiline
              value={content}
              onChangeText={setContent}
              autoFocus={!editing}
            />

            <TouchableOpacity
              style={[s.saveBtn, (!title.trim() && !content.trim()) && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!title.trim() && !content.trim()}
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
  safe: { flex: 1, backgroundColor: '#15140F' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    margin: 16, backgroundColor: '#1D1C17', borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: '#383528',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#fff' },

  row: { paddingHorizontal: 10, gap: 10 },
  listContent: { paddingHorizontal: 6, paddingBottom: 100 },
  card: {
    flex: 1, backgroundColor: '#1D1C17', borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: '#383528',
    marginBottom: 10, minHeight: 100,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#fff', marginBottom: 6 },
  cardContent: { fontSize: 13, color: '#BFBBAE', lineHeight: 18, flex: 1 },
  cardDate: { fontSize: 10, color: '#56544B', marginTop: 8 },

  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 15, color: '#56544B' },

  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 16, backgroundColor: '#BFBBAE',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1D1C17', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  sheetActions: { flexDirection: 'row', gap: 8 },
  deleteBtn: { padding: 6 },
  closeBtn: { padding: 6 },

  titleInput: {
    fontSize: 18, fontWeight: '600', color: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#383528',
    paddingVertical: 8, marginBottom: 12,
  },
  contentInput: {
    fontSize: 14, color: '#EDEAE0', minHeight: 200,
    textAlignVertical: 'top', lineHeight: 22, marginBottom: 16,
  },
  saveBtn: { backgroundColor: '#D97757', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
