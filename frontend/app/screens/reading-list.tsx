import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useReadingListStore, ReadingType, ReadingStatus, ReadingItem } from '../../store/readingListStore';

const STATUS_TABS: { key: ReadingStatus; label: string; color: string }[] = [
  { key: 'want_to_read', label: 'Okuyacak', color: '#827E72' },
  { key: 'reading',      label: 'Okuyor',   color: '#D97757' },
  { key: 'completed',    label: 'Bitti',     color: '#87A678' },
];

const TYPE_OPTIONS: { key: ReadingType; label: string; icon: string; color: string }[] = [
  { key: 'book',    label: 'Kitap',   icon: 'book-outline',         color: '#8b5cf6' },
  { key: 'article', label: 'Makale',  icon: 'newspaper-outline',    color: '#7C97C5' },
  { key: 'video',   label: 'Video',   icon: 'videocam-outline',     color: '#C76A6A' },
  { key: 'podcast', label: 'Podcast', icon: 'headset-outline',      color: '#D4A84A' },
  { key: 'other',   label: 'Diğer',   icon: 'ellipsis-horizontal-outline', color: '#BFBBAE' },
];

const TYPE_MAP = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.key, t]));

function StarRating({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange(n)}>
          <Ionicons name={n <= (value ?? 0) ? 'star' : 'star-outline'} size={18} color="#D4A84A" />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function ReadingListScreen() {
  const { items, loading, fetchItems, addItem, updateStatus, updateRating, removeItem } = useReadingListStore();
  const [activeTab, setActiveTab] = useState<ReadingStatus>('want_to_read');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<ReadingType>('book');

  useEffect(() => { fetchItems(); }, []);

  const filtered = items.filter((i) => i.status === activeTab);

  async function handleAdd() {
    if (!title.trim()) return;
    await addItem({ title, author, type, url });
    setTitle(''); setAuthor(''); setUrl(''); setType('book');
    setShowAdd(false);
  }

  function handleDelete(item: ReadingItem) {
    Alert.alert('Sil', `"${item.title}" listeden kaldırılsın mı?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeItem(item.id) },
    ]);
  }

  function nextStatus(current: ReadingStatus): ReadingStatus {
    if (current === 'want_to_read') return 'reading';
    if (current === 'reading') return 'completed';
    return 'want_to_read';
  }

  const counts = {
    want_to_read: items.filter((i) => i.status === 'want_to_read').length,
    reading: items.filter((i) => i.status === 'reading').length,
    completed: items.filter((i) => i.status === 'completed').length,
  };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>

      {/* Segment tabs */}
      <View style={s.tabs}>
        {STATUS_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, activeTab === tab.key && { borderBottomColor: tab.color, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[s.tabText, activeTab === tab.key && { color: tab.color }]}>
              {tab.label}
            </Text>
            {counts[tab.key] > 0 && (
              <View style={[s.tabBadge, { backgroundColor: tab.color }]}>
                <Text style={s.tabBadgeText}>{counts[tab.key]}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="book-outline" size={40} color="#383528" />
            <Text style={s.emptyTitle}>
              {activeTab === 'want_to_read' ? 'Okuma listeniz boş' :
               activeTab === 'reading' ? 'Şu an okunan yok' : 'Tamamlanan yok'}
            </Text>
            <Text style={s.emptySub}>+ butonuyla ekleyin</Text>
          </View>
        ) : (
          filtered.map((item) => {
            const typeInfo = TYPE_MAP[item.type];
            return (
              <View key={item.id} style={s.card}>
                <View style={s.cardLeft}>
                  <View style={[s.typeIcon, { backgroundColor: typeInfo.color + '20' }]}>
                    <Ionicons name={typeInfo.icon as any} size={18} color={typeInfo.color} />
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
                    style={[s.statusBtn, { backgroundColor: STATUS_TABS.find(t => t.key === nextStatus(item.status))?.color + '20' }]}
                    onPress={() => updateStatus(item.id, nextStatus(item.status))}
                  >
                    <Ionicons
                      name={item.status === 'completed' ? 'refresh-outline' : 'arrow-forward-outline'}
                      size={14}
                      color={STATUS_TABS.find(t => t.key === nextStatus(item.status))?.color}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(item)}>
                    <Ionicons name="trash-outline" size={14} color="#56544B" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setShowAdd(true)}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      {/* Ekle Modal */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Listeye Ekle</Text>

            <TextInput
              style={s.input}
              placeholder="Başlık *"
              placeholderTextColor="#827E72"
              value={title}
              onChangeText={setTitle}
              autoFocus
            />
            <TextInput
              style={s.input}
              placeholder="Yazar / Kaynak"
              placeholderTextColor="#827E72"
              value={author}
              onChangeText={setAuthor}
            />
            <TextInput
              style={s.input}
              placeholder="URL (opsiyonel)"
              placeholderTextColor="#827E72"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={s.fieldLabel}>TÜR</Text>
            <View style={s.typeRow}>
              {TYPE_OPTIONS.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[s.typeBtn, type === t.key && { backgroundColor: t.color + '25', borderColor: t.color }]}
                  onPress={() => setType(t.key)}
                >
                  <Ionicons name={t.icon as any} size={16} color={type === t.key ? t.color : '#827E72'} />
                  <Text style={[s.typeBtnText, type === t.key && { color: t.color }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.sheetActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={s.cancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, !title.trim() && s.confirmDisabled]}
                onPress={handleAdd}
                disabled={!title.trim()}
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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },

  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#28261F' },
  tab: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#827E72' },
  tabBadge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },

  content: { padding: 16, paddingBottom: 100 },

  empty: { alignItems: 'center', gap: 8, paddingTop: 60 },
  emptyTitle: { fontSize: 16, color: '#56544B', fontWeight: '600' },
  emptySub: { fontSize: 13, color: '#56544B' },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    backgroundColor: '#1D1C17', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#383528', marginBottom: 10,
  },
  cardLeft: { flexDirection: 'row', gap: 12, flex: 1 },
  typeIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#EDEAE0', lineHeight: 20 },
  cardAuthor: { fontSize: 12, color: '#827E72' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  typeBadge: { fontSize: 11, fontWeight: '600' },

  cardActions: { gap: 8, marginLeft: 8 },
  statusBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  deleteBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#28261F', alignItems: 'center', justifyContent: 'center' },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: '#D97757', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#D97757', shadowOpacity: 0.4, shadowRadius: 10, elevation: 8,
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1D1C17', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 16 },
  input: { backgroundColor: '#1D1C17', borderRadius: 12, padding: 14, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#383528', marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#827E72', letterSpacing: 1, marginBottom: 8 },
  typeRow: { flexDirection: 'row', gap: 6, marginBottom: 20, flexWrap: 'wrap' },
  typeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#383528' },
  typeBtnText: { fontSize: 12, fontWeight: '600', color: '#827E72' },
  sheetActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#383528', alignItems: 'center' },
  cancelText: { fontSize: 15, color: '#BFBBAE', fontWeight: '600' },
  confirmBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: '#D97757', alignItems: 'center' },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
