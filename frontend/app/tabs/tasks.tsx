import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore, type Task, type ListType, type TaskPriority } from '../../store/taskStore';
import { useProjectStore } from '../../store/projectStore';
import { colors, space } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import InlineComposer from '../../components/InlineComposer';
import { todayLocal } from '../../lib/date';
import LoadMoreFooter from '../../components/LoadMoreFooter';

const TABS: { key: ListType | 'done'; label: string }[] = [
  { key: 'inbox', label: 'Gelen' },
  { key: 'this_week', label: 'Bu Hafta' },
  { key: 'someday', label: 'Bir Gün' },
  { key: 'done', label: 'Arşiv' },
];

const PRIORITY_META: Record<TaskPriority, { color: string; label: string }> = {
  high: { color: colors.error, label: 'Yüksek' },
  medium: { color: colors.warning, label: 'Orta' },
  low: { color: colors.success, label: 'Düşük' },
  none: { color: colors.textGhost, label: 'Yok' },
};

export default function TasksScreen() {
  const [activeTab, setActiveTab] = useState<ListType | 'done'>('inbox');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [listType, setListType] = useState<ListType>('inbox');

  const { tasks, loadingMore, hasMore, loadMore, fetchTasks, addTask, toggleDone, removeTask, byList } = useTaskStore();
  const { projects, fetchProjects } = useProjectStore();

  useEffect(() => { fetchTasks(); fetchProjects(); }, [fetchTasks, fetchProjects]);

  const visibleTasks = activeTab === 'done'
    ? tasks.filter((t) => t.completed || t.status === 'cancelled')
    : byList(activeTab as ListType);

  async function handleAdd() {
    if (!title.trim()) return;
    await addTask({ title: title.trim(), priority, list_type: listType });
    setTitle('');
    setShowAdd(false);
  }

  function openAdd(list: ListType) {
    setListType(list);
    setTitle('');
    setPriority('none');
    setShowAdd(true);
  }

  function confirmDelete(t: Task) {
    Alert.alert('Görevi Sil', `"${t.title}" silinsin mi?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeTask(t.id) },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* Segment tabs */}
      <View style={s.tabRow}>
        {TABS.map((tab) => {
          const count = tab.key === 'done'
            ? tasks.filter((t) => t.completed).length
            : byList(tab.key as ListType).length;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[s.tabBtn, activeTab === tab.key && s.tabBtnActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[s.tabLabel, activeTab === tab.key && s.tabLabelActive]}>
                {tab.label}
              </Text>
              {count > 0 && (
                <View style={[s.tabBadge, activeTab === tab.key && s.tabBadgeActive]}>
                  <Text style={s.tabBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Görev listesi */}
      <FlatList
        data={visibleTasks}
        keyExtractor={(t) => t.id}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListFooterComponent={<LoadMoreFooter hasMore={hasMore} loading={loadingMore} onPress={loadMore} />}
        style={s.list}
        contentContainerStyle={s.listContent}
        ListHeaderComponent={
          activeTab !== 'done' ? (
            <View style={{ marginBottom: space.md }}>
              <InlineComposer
                placeholder="Hızlı görev ekle…"
                onSubmit={async (t) => { await addTask({ title: t, priority: 'none', list_type: activeTab as ListType }); }}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="checkmark-done-outline" size={40} color="#383528" />
            <Text style={s.emptyText}>Görev yok</Text>
            {activeTab !== 'done' && (
              <TouchableOpacity onPress={() => openAdd(activeTab as ListType)} style={s.emptyAdd}>
                <Text style={s.emptyAddText}>+ Görev Ekle</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[s.row, item.completed && s.rowDone]}>
            <TouchableOpacity style={s.check} onPress={() => { haptic.success(); toggleDone(item.id); }}>
              <View style={[
                s.checkBox,
                { borderColor: PRIORITY_META[item.priority].color },
                item.completed && { backgroundColor: PRIORITY_META[item.priority].color, borderColor: PRIORITY_META[item.priority].color },
              ]}>
                {item.completed && <Ionicons name="checkmark" size={12} color="#fff" />}
              </View>
            </TouchableOpacity>

            <View style={s.rowBody}>
              <Text style={[s.rowTitle, item.completed && s.rowTitleDone]} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={s.rowMeta}>
                {item.priority !== 'none' && (
                  <View style={[s.priorityDot, { backgroundColor: PRIORITY_META[item.priority].color }]} />
                )}
                {item.due_date && (
                  <Text style={[
                    s.dueText,
                    item.due_date < todayLocal() && !item.completed && s.duePast,
                  ]}>
                    {item.due_date}
                  </Text>
                )}
                {item.project_id && (
                  <Text style={s.projectLabel}>
                    {projects.find((p) => p.id === item.project_id)?.name ?? ''}
                  </Text>
                )}
              </View>
            </View>

            <TouchableOpacity style={s.deleteBtn} onPress={() => confirmDelete(item)}>
              <Ionicons name="trash-outline" size={16} color="#56544B" />
            </TouchableOpacity>
          </View>
        )}
      />

      {/* FAB */}
      {activeTab !== 'done' && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => openAdd(activeTab as ListType)}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Ekle modal */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Yeni Görev</Text>

            <TextInput
              style={s.input}
              placeholder="Görev başlığı..."
              placeholderTextColor="#827E72"
              value={title}
              onChangeText={setTitle}
              autoFocus
              multiline
            />

            {/* Liste seçimi */}
            <Text style={s.fieldLabel}>Liste</Text>
            <View style={s.optRow}>
              {(['inbox','this_week','someday'] as ListType[]).map((l) => (
                <TouchableOpacity
                  key={l}
                  style={[s.optBtn, listType === l && s.optBtnActive]}
                  onPress={() => setListType(l)}
                >
                  <Text style={[s.optText, listType === l && s.optTextActive]}>
                    {l === 'inbox' ? 'Gelen' : l === 'this_week' ? 'Bu Hafta' : 'Bir Gün'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Öncelik seçimi */}
            <Text style={s.fieldLabel}>Öncelik</Text>
            <View style={s.optRow}>
              {(['none','low','medium','high'] as TaskPriority[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[s.optBtn, priority === p && { backgroundColor: PRIORITY_META[p].color + '30', borderColor: PRIORITY_META[p].color }]}
                  onPress={() => setPriority(p)}
                >
                  <View style={[s.priorityDot, { backgroundColor: PRIORITY_META[p].color }]} />
                  <Text style={[s.optText, priority === p && { color: PRIORITY_META[p].color }]}>
                    {PRIORITY_META[p].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={s.cancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.addBtn, !title.trim() && s.addBtnDisabled]}
                onPress={handleAdd}
                disabled={!title.trim()}
              >
                <Text style={s.addBtnText}>Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  tabRow: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10,
    gap: 6, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  tabBtnActive: { backgroundColor: '#D9775720', borderColor: colors.accent },
  tabLabel: { fontSize: 13, color: colors.textFaint, fontWeight: '500' },
  tabLabelActive: { color: colors.accent },
  tabBadge: { backgroundColor: colors.border, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  tabBadgeActive: { backgroundColor: '#D9775730' },
  tabBadgeText: { fontSize: 11, color: colors.textDim },

  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  rowDone: { opacity: 0.5 },
  check: { padding: 2 },
  checkBox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 14, color: colors.text, marginBottom: 4 },
  rowTitleDone: { textDecorationLine: 'line-through', color: colors.textGhost },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityDot: { width: 6, height: 6, borderRadius: 3 },
  dueText: { fontSize: 11, color: colors.textFaint },
  duePast: { color: colors.error },
  projectLabel: { fontSize: 11, color: colors.accent },
  deleteBtn: { padding: 4 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 15, color: colors.textGhost },
  emptyAdd: { marginTop: 8 },
  emptyAddText: { fontSize: 14, color: colors.accent },

  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 8,
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.white, marginBottom: 16 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15,
    color: colors.white, borderWidth: 1, borderColor: colors.border, minHeight: 60, marginBottom: 16,
  },
  fieldLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
  optRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  optBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  optBtnActive: { backgroundColor: '#D9775720', borderColor: colors.accent },
  optText: { fontSize: 13, color: colors.textDim },
  optTextActive: { color: colors.accent },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12,
    backgroundColor: colors.border, alignItems: 'center',
  },
  cancelText: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  addBtn: {
    flex: 2, paddingVertical: 13, borderRadius: 12,
    backgroundColor: colors.accent, alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { fontSize: 15, color: colors.white, fontWeight: '700' },
});
