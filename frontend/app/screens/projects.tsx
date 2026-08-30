import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useProjectStore, type Project } from '../../store/projectStore';
import { useTaskStore } from '../../store/taskStore';
import InlineComposer from '../../components/InlineComposer';
import { EmptyState } from '../../components/ui';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import { colors } from '../../lib/tokens';

const PRESET_COLORS = [
  colors.accent,'#8b5cf6','#ec4899',colors.error,'#f97316',
  colors.warning,colors.success,colors.teal,'#3b82f6','#84cc16',
];

export default function ProjectsScreen() {
  const { projects, hasMore, loadingMore, loadMore, fetchProjects, addProject, removeProject } = useProjectStore();
  const { tasks, fetchTasks, toggleDone, addTask } = useTaskStore();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [detailId, setDetailId] = useState<string | null>(null);

  const detailProject = projects.find((p) => p.id === detailId) ?? null;
  const detailTasks = detailId ? tasks.filter((t) => t.project_id === detailId) : [];
  const detailDone = detailTasks.filter((t) => t.completed).length;
  const detailPct = detailTasks.length > 0 ? detailDone / detailTasks.length : 0;

  useEffect(() => { fetchProjects(); fetchTasks(); }, [fetchProjects, fetchTasks]);

  async function handleAdd() {
    if (!name.trim()) return;
    await addProject({ name: name.trim(), color, description: desc.trim() || undefined });
    setName(''); setDesc(''); setColor(PRESET_COLORS[0]);
    setShowAdd(false);
  }

  function confirmDelete(p: Project) {
    Alert.alert('Projeyi Sil', `"${p.name}" silinsin mi?`, [
      { text: 'İptal', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => removeProject(p.id) },
    ]);
  }

  const taskCount = (pid: string) => tasks.filter((t) => t.project_id === pid && !t.completed).length;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListFooterComponent={<LoadMoreFooter hasMore={hasMore} loading={loadingMore} onPress={loadMore} />}
        style={s.list}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          <EmptyState
            icon="folder-open-outline"
            title="Henüz proje yok"
            hint="Görevlerini bir projede toplamak için ilk projeni oluştur."
            ctaLabel="Yeni Proje"
            onCta={() => setShowAdd(true)}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.row}
            onPress={() => setDetailId(item.id)}
            onLongPress={() => confirmDelete(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${taskCount(item.id)} açık görev`}
            accessibilityHint="Açmak için dokun, silmek için uzun bas"
          >
            <View style={[s.colorDot, { backgroundColor: item.color ?? colors.primary }]} />
            <View style={s.rowBody}>
              <Text style={s.rowName}>{item.name}</Text>
              {item.description ? <Text style={s.rowDesc} numberOfLines={1}>{item.description}</Text> : null}
            </View>
            <View style={s.badge}>
              <Text style={s.badgeText}>{taskCount(item.id)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#56544B" />
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity
        style={s.fab}
        onPress={() => setShowAdd(true)}
        accessibilityRole="button"
        accessibilityLabel="Yeni proje ekle"
      >
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Yeni Proje</Text>

            <TextInput
              style={s.input}
              placeholder="Proje adı..."
              placeholderTextColor="#827E72"
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <TextInput
              style={s.input}
              placeholder="Açıklama (isteğe bağlı)..."
              placeholderTextColor="#827E72"
              value={desc}
              onChangeText={setDesc}
            />

            <Text style={s.fieldLabel}>Renk</Text>
            <View style={s.colorGrid}>
              {PRESET_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.colorBtn, { backgroundColor: c }, color === c && s.colorSelected]}
                  onPress={() => setColor(c)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Proje rengi ${PRESET_COLORS.indexOf(c) + 1}`}
                  accessibilityState={{ selected: color === c, checked: color === c }}
                >
                  {color === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.actions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setShowAdd(false)}
                accessibilityRole="button"
                accessibilityLabel="İptal"
              >
                <Text style={s.cancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.addBtn, { backgroundColor: color }, !name.trim() && s.addBtnDisabled]}
                onPress={handleAdd}
                disabled={!name.trim()}
                accessibilityRole="button"
                accessibilityLabel="Projeyi oluştur"
                accessibilityState={{ disabled: !name.trim() }}
              >
                <Text style={s.addBtnText}>Oluştur</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Proje detayı */}
      <Modal visible={!!detailProject} transparent animationType="slide" onRequestClose={() => setDetailId(null)}>
        <View style={s.overlay}>
          <View style={s.detailSheet}>
            {detailProject && (
              <>
                <View style={s.detailHead}>
                  <View style={[s.colorDot, { backgroundColor: detailProject.color ?? colors.primary, width: 16, height: 16, borderRadius: 8 }]} />
                  <Text style={s.detailTitle} numberOfLines={1}>{detailProject.name}</Text>
                  <TouchableOpacity
                    onPress={() => setDetailId(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Proje detayını kapat"
                  >
                    <Ionicons name="close" size={22} color="#827E72" />
                  </TouchableOpacity>
                </View>
                {detailProject.description ? <Text style={s.detailDesc}>{detailProject.description}</Text> : null}

                {/* İlerleme */}
                <View style={s.progressRow}>
                  <Text style={s.progressText}>{detailDone}/{detailTasks.length} tamamlandı</Text>
                  <Text style={s.progressPct}>{Math.round(detailPct * 100)}%</Text>
                </View>
                <View style={s.progressTrack}>
                  <View style={[s.progressFill, { width: `${detailPct * 100}%`, backgroundColor: detailProject.color ?? colors.primary }]} />
                </View>

                <View style={{ marginTop: 14, marginBottom: 8 }}>
                  <InlineComposer
                    placeholder="Bu projeye görev ekle…"
                    onSubmit={async (t) => { await addTask({ title: t, priority: 'none', list_type: 'inbox', project_id: detailProject.id }); }}
                  />
                </View>

                <FlatList
                  data={detailTasks}
                  keyExtractor={(t) => t.id}
                  style={{ maxHeight: 320 }}
                  ListEmptyComponent={
                    <EmptyState
                      variant="editorial"
                      compact
                      icon="checkbox-outline"
                      title="Henüz görev yok"
                      hint="Yukarıdaki alandan bu projeye ilk görevini ekle."
                    />
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={s.taskRow}
                      onPress={() => toggleDone(item.id)}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityLabel={item.title}
                      accessibilityState={{ checked: item.completed }}
                    >
                      <View style={[s.taskCheck, item.completed && { backgroundColor: detailProject.color ?? colors.primary, borderColor: detailProject.color ?? colors.primary }]}>
                        {item.completed && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                      <Text style={[s.taskTitle, item.completed && s.taskTitleDone]} numberOfLines={1}>{item.title}</Text>
                    </TouchableOpacity>
                  )}
                />
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginBottom: 10,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  rowBody: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.white },
  rowDesc: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  badge: {
    backgroundColor: colors.border, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeText: { fontSize: 12, color: colors.textDim },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 15, color: colors.textGhost },
  emptyAdd: { marginTop: 8 },
  emptyAddText: { fontSize: 14, color: colors.accent },
  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 16, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.white, marginBottom: 16 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15,
    color: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  fieldLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  colorBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  colorSelected: { borderWidth: 3, borderColor: colors.white },
  actions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  addBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { fontSize: 15, color: colors.white, fontWeight: '700' },

  // Proje detayı
  detailSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  detailTitle: { flex: 1, fontSize: 19, fontWeight: '700', color: colors.white },
  detailDesc: { fontSize: 13, color: colors.textFaint, marginBottom: 14, lineHeight: 18 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  progressText: { fontSize: 13, color: colors.textDim },
  progressPct: { fontSize: 13, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.borderSubtle, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  detailEmpty: { fontSize: 13, color: colors.textGhost, textAlign: 'center', paddingVertical: 24 },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  taskCheck: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.textGhost,
    alignItems: 'center', justifyContent: 'center',
  },
  taskTitle: { flex: 1, fontSize: 14, color: colors.text },
  taskTitleDone: { color: colors.textGhost, textDecorationLine: 'line-through' },
});
