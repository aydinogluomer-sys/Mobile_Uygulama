import { colors } from '../../lib/tokens';
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useGoalStore, Goal, GoalKind } from '../../store/goalStore';
import { EmptyState, Skeleton } from '../../components/ui';

const TABS: { key: GoalKind; label: string; color: string }[] = [
  { key: 'yearly', label: 'Yıllık', color: colors.accent },
  { key: 'quarterly', label: 'Çeyreklik', color: colors.warning },
  { key: 'monthly', label: 'Aylık', color: colors.success },
];

const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_QUARTER = Math.ceil((NOW.getMonth() + 1) / 3);
const CUR_MONTH = NOW.getMonth() + 1;

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={s.barBg}>
      <View style={[s.barFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function GoalCard({ goal, color, onEdit, onDelete }: {
  goal: Goal; color: string;
  onEdit: (g: Goal) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <TouchableOpacity
      style={[s.goalCard, goal.progress >= 100 && s.goalDone]}
      onPress={() => onEdit(goal)}
      accessibilityRole="button"
      accessibilityLabel={`${goal.title}, yüzde ${goal.progress} tamamlandı`}
      accessibilityHint="İlerlemeyi güncellemek için aç"
    >
      <View style={s.goalRow}>
        <Text style={[s.goalTitle, goal.progress >= 100 && s.goalTitleDone]} numberOfLines={2}>{goal.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[s.goalPct, { color }]}>{goal.progress}%</Text>
          <TouchableOpacity
            onPress={() => onDelete(goal.id)}
            accessibilityRole="button"
            accessibilityLabel={`Hedefi sil: ${goal.title}`}
          >
            <Ionicons name="trash-outline" size={14} color="#56544B" />
          </TouchableOpacity>
        </View>
      </View>
      <ProgressBar pct={goal.progress} color={color} />
    </TouchableOpacity>
  );
}

export default function GoalsScreen() {
  const { goals, loading, loadGoals, addGoal, updateProgress, removeGoal } = useGoalStore();
  const [activeTab, setActiveTab] = useState<GoalKind>('yearly');
  const [modal, setModal] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState('0');

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const tabInfo = TABS.find((t) => t.key === activeTab)!;
  const filtered = goals.filter((g) => g.kind === activeTab);

  function openAdd() {
    setEditGoal(null);
    setTitle('');
    setProgress('0');
    setModal(true);
  }

  function openEdit(g: Goal) {
    setEditGoal(g);
    setTitle(g.title);
    setProgress(String(g.progress));
    setModal(true);
  }

  async function handleSave() {
    const pct = Math.max(0, Math.min(100, parseInt(progress, 10) || 0));
    if (!title.trim()) return;
    if (editGoal) {
      await updateProgress(editGoal.id, pct);
    } else {
      await addGoal({
        kind: activeTab,
        title: title.trim(),
        progress: pct,
        year: CUR_YEAR,
        quarter: activeTab === 'quarterly' ? CUR_QUARTER : null,
        month: activeTab === 'monthly' ? CUR_MONTH : null,
      });
    }
    setModal(false);
  }

  function handleDelete(id: string) {
    Alert.alert('Sil', 'Bu hedef silinsin mi?', [
      { text: 'İptal' },
      { text: 'Sil', style: 'destructive', onPress: () => removeGoal(id) },
    ]);
  }

  const QUICK_PCT = [0, 25, 50, 75, 100];

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>

      {/* Tab bar */}
      <View style={s.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[s.tab, activeTab === t.key && { borderBottomColor: t.color, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(t.key)}
            accessibilityRole="tab"
            accessibilityLabel={`${t.label} hedefler`}
            accessibilityState={{ selected: activeTab === t.key }}
          >
            <Text style={[s.tabText, activeTab === t.key && { color: t.color }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.scroll}>

        {/* Özet */}
        <View style={s.summary}>
          <Text style={s.summaryText}>
            {filtered.length} hedef · {filtered.filter((g) => g.progress >= 100).length} tamamlandı
          </Text>
          {filtered.length > 0 && (
            <Text style={[s.summaryPct, { color: tabInfo.color }]}>
              Ort. {Math.round(filtered.reduce((a, g) => a + g.progress, 0) / filtered.length)}%
            </Text>
          )}
        </View>

        {loading && goals.length === 0 ? (
          // Hedefler yolda. Gelen şekil sabit: başlık satırı + yüzde + ilerleme
          // çubuğu. Boş durumu göstermek yanıltıcı olurdu — henüz bilmiyoruz.
          [0, 1, 2].map((i) => (
            <View key={i} style={s.goalCard}>
              <View style={s.goalRow}>
                <View style={{ flex: 1 }}><Skeleton width="70%" height={15} /></View>
                <Skeleton width={34} height={15} />
              </View>
              <Skeleton height={6} />
            </View>
          ))
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="Henüz hedef yok"
            hint={
              activeTab === 'yearly' ? 'Bu yıl için hedeflerini ekle.' :
              activeTab === 'quarterly' ? 'Bu çeyrek için hedeflerini ekle.' :
              'Bu ay için hedeflerini ekle.'
            }
            ctaLabel={`${tabInfo.label} hedef ekle`}
            onCta={openAdd}
            color={tabInfo.color}
          />
        ) : (
          filtered.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              color={tabInfo.color}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[s.fab, { backgroundColor: tabInfo.color }]}
        onPress={openAdd}
        accessibilityRole="button"
        accessibilityLabel={`Yeni ${tabInfo.label.toLowerCase()} hedef ekle`}
      >
        <Ionicons name="add" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Modal */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>{editGoal ? 'Hedefi Güncelle' : 'Yeni Hedef'}</Text>
              <TouchableOpacity
                onPress={() => setModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={20} color="#827E72" />
              </TouchableOpacity>
            </View>

            {!editGoal && (
              <>
                <Text style={s.fieldLabel}>Başlık</Text>
                <TextInput
                  style={s.input}
                  placeholder={`${tabInfo.label} hedefini yaz...`}
                  placeholderTextColor="#56544B"
                  value={title}
                  onChangeText={setTitle}
                  autoFocus
                  multiline
                />
              </>
            )}

            {editGoal && (
              <Text style={s.editTitle} numberOfLines={3}>{editGoal.title}</Text>
            )}

            <Text style={s.fieldLabel}>İlerleme (%)</Text>
            <View style={s.quickRow}>
              {QUICK_PCT.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[s.quickBtn, progress === String(p) && { backgroundColor: tabInfo.color + '20', borderColor: tabInfo.color }]}
                  onPress={() => setProgress(String(p))}
                  accessibilityRole="radio"
                  accessibilityLabel={`İlerlemeyi yüzde ${p} yap`}
                  accessibilityState={{ selected: progress === String(p), checked: progress === String(p) }}
                >
                  <Text style={[s.quickText, progress === String(p) && { color: tabInfo.color }]}>
                    {p}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={s.input}
              placeholder="Özel % gir (0-100)"
              placeholderTextColor="#56544B"
              value={progress}
              onChangeText={setProgress}
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={[s.saveBtn, { backgroundColor: tabInfo.color }, !title.trim() && !editGoal && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!title.trim() && !editGoal}
              accessibilityRole="button"
              accessibilityLabel={editGoal ? 'Hedefi kaydet' : 'Hedefi ekle'}
              accessibilityState={{ disabled: !title.trim() && !editGoal }}
            >
              <Text style={s.saveBtnText}>{editGoal ? 'Kaydet' : 'Ekle'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  tabs: { flexDirection: 'row', backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, color: colors.textFaint, fontWeight: '600' },

  scroll: { padding: 16, paddingBottom: 80 },

  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  summaryText: { fontSize: 12, color: colors.textFaint },
  summaryPct: { fontSize: 13, fontWeight: '700' },

  goalCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 10,
  },
  goalDone: { borderColor: '#87A67830', backgroundColor: '#87A67808' },
  goalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  goalTitle: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500', lineHeight: 20 },
  goalTitleDone: { textDecorationLine: 'line-through', color: colors.textFaint },
  goalPct: { fontSize: 15, fontWeight: '700' },

  barBg: { height: 6, backgroundColor: colors.border, borderRadius: 3 },
  barFill: { height: 6, borderRadius: 3 },

  emptyCard: {
    alignItems: 'center', gap: 8, padding: 40,
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginTop: 20,
  },
  emptyText: { fontSize: 14, color: colors.textGhost, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: colors.textGhost, textAlign: 'center' },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.black, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderWidth: 1, borderColor: colors.border },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  editTitle: { fontSize: 15, color: colors.text, marginBottom: 16, lineHeight: 22 },

  fieldLabel: { fontSize: 12, color: colors.textFaint, marginBottom: 8, fontWeight: '600' },
  input: {
    backgroundColor: '#111', borderRadius: 10, padding: 14,
    fontSize: 15, color: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  quickBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#111', borderWidth: 1, borderColor: colors.border,
  },
  quickText: { fontSize: 13, color: colors.textFaint },

  saveBtn: { borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
