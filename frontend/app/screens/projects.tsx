import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useProjectStore, type Project } from '../../store/projectStore';
import { useTaskStore } from '../../store/taskStore';
import InlineComposer from '../../components/InlineComposer';

const PRESET_COLORS = [
  '#D97757','#8b5cf6','#ec4899','#C76A6A','#f97316',
  '#D4A84A','#87A678','#7C97C5','#3b82f6','#84cc16',
];

export default function ProjectsScreen() {
  const router = useRouter();
  const { projects, fetchProjects, addProject, removeProject } = useProjectStore();
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

  useEffect(() => { fetchProjects(); fetchTasks(); }, []);

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
        style={s.list}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="folder-open-outline" size={40} color="#383528" />
            <Text style={s.emptyText}>Henüz proje yok</Text>
            <TouchableOpacity onPress={() => setShowAdd(true)} style={s.emptyAdd}>
              <Text style={s.emptyAddText}>+ Yeni Proje</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={s.row} onPress={() => setDetailId(item.id)} onLongPress={() => confirmDelete(item)}>
            <View style={[s.colorDot, { backgroundColor: item.color }]} />
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

      <TouchableOpacity style={s.fab} onPress={() => setShowAdd(true)}>
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
                >
                  {color === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.actions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={s.cancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.addBtn, { backgroundColor: color }, !name.trim() && s.addBtnDisabled]}
                onPress={handleAdd}
                disabled={!name.trim()}
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
                  <View style={[s.colorDot, { backgroundColor: detailProject.color, width: 16, height: 16, borderRadius: 8 }]} />
                  <Text style={s.detailTitle} numberOfLines={1}>{detailProject.name}</Text>
                  <TouchableOpacity onPress={() => setDetailId(null)}>
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
                  <View style={[s.progressFill, { width: `${detailPct * 100}%`, backgroundColor: detailProject.color }]} />
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
                  ListEmptyComponent={<Text style={s.detailEmpty}>Henüz görev yok</Text>}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={s.taskRow} onPress={() => toggleDone(item.id)} activeOpacity={0.7}>
                      <View style={[s.taskCheck, item.completed && { backgroundColor: detailProject.color, borderColor: detailProject.color }]}>
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
  safe: { flex: 1, backgroundColor: '#15140F' },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1D1C17', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#383528', marginBottom: 10,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  rowBody: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  rowDesc: { fontSize: 12, color: '#827E72', marginTop: 2 },
  badge: {
    backgroundColor: '#383528', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeText: { fontSize: 12, color: '#BFBBAE' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 15, color: '#56544B' },
  emptyAdd: { marginTop: 8 },
  emptyAddText: { fontSize: 14, color: '#D97757' },
  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 16, backgroundColor: '#D97757',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#D97757', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1D1C17', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 16 },
  input: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14, fontSize: 15,
    color: '#fff', borderWidth: 1, borderColor: '#383528', marginBottom: 12,
  },
  fieldLabel: { fontSize: 12, color: '#827E72', fontWeight: '600', marginBottom: 8, letterSpacing: 0.5 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  colorBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  colorSelected: { borderWidth: 3, borderColor: '#fff' },
  actions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#383528', alignItems: 'center' },
  cancelText: { fontSize: 15, color: '#BFBBAE', fontWeight: '600' },
  addBtn: { flex: 2, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },

  // Proje detayı
  detailSheet: { backgroundColor: '#1D1C17', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  detailTitle: { flex: 1, fontSize: 19, fontWeight: '700', color: '#fff' },
  detailDesc: { fontSize: 13, color: '#827E72', marginBottom: 14, lineHeight: 18 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  progressText: { fontSize: 13, color: '#BFBBAE' },
  progressPct: { fontSize: 13, color: '#EDEAE0', fontWeight: '700', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#28261F', marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  detailEmpty: { fontSize: 13, color: '#56544B', textAlign: 'center', paddingVertical: 24 },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: '#28261F',
  },
  taskCheck: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#56544B',
    alignItems: 'center', justifyContent: 'center',
  },
  taskTitle: { flex: 1, fontSize: 14, color: '#EDEAE0' },
  taskTitleDone: { color: '#56544B', textDecorationLine: 'line-through' },
});
