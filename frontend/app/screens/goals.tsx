import { colors, alphaHex, hexA } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { useEffect, useState } from 'react';
import OKRScreen from './okr';
import LifeAreasScreen from './life-areas';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useGoalStore, Goal, GoalKind } from '../../store/goalStore';
import {
  AtmosphericScreenCanvas,
  EmptyState,
  Skeleton,
  FormError,
  FormPreview,
  LoadErrorState,
  EditorialBanner,
  EmbeddedFiligree,
  EmblemMedallion,
} from '../../components/ui';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { goalProgress } from '../../lib/progressModel';

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
      accessibilityLabel={`${goal.title}, ${goalProgress(goal).label}`}
      accessibilityHint="Bu yüzde elle girilir; görev ve alışkanlık kayıtlarından hesaplanmaz. Güncellemek için aç"
    >
      <EmbeddedFiligree source={DECOR.cornerBlueprint} size={88} opacity={0.14} />
      <View style={s.goalRow}>
        <EmblemMedallion source={DECOR.goldenThreadNode} size={28} unlocked accentColor={color} />
        <Text style={[s.goalTitle, goal.progress >= 100 && s.goalTitleDone]} numberOfLines={2}>{goal.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[s.goalPct, { color }]}>{goal.progress}%</Text>
          <TouchableOpacity
            onPress={() => onDelete(goal.id)}
            accessibilityRole="button"
            accessibilityLabel={`Hedefi sil: ${goal.title}`}
          >
            <Ionicons name="trash-outline" size={14} color={colors.textGhost} />
          </TouchableOpacity>
        </View>
      </View>
      <ProgressBar pct={goal.progress} color={color} />
      {/* R03.06 — manual, and labelled as manual: never mixed with record-computed progress. */}
      <Text style={s.manualNote}>{goalProgress(goal).label}</Text>
    </TouchableOpacity>
  );
}

export default function GoalsScreen() {
  const { goals, loading, loadGoals, addGoal, updateProgress, removeGoal, error: loadError } = useGoalStore();
  const [activeTab, setActiveTab] = useState<GoalKind>('yearly');
  const [modal, setModal] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState('0');
  const [visionMode, setVisionMode] = useState<'goals' | 'okr' | 'life_areas'>('goals');
  // R06.03 — a failed save keeps the form and says why; a cancelled NEW goal
  // keeps its draft for the next "add" (no "are you sure" screen needed).
  const [formError, setFormError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<{ title: string; progress: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const tabInfo = TABS.find((t) => t.key === activeTab)!;
  const filtered = goals.filter((g) => g.kind === activeTab);

  function openAdd() {
    setEditGoal(null);
    setTitle(newDraft?.title ?? '');
    setProgress(newDraft?.progress ?? '0');
    setFormError(null);
    setModal(true);
  }

  function closeForm() {
    if (!editGoal && (title.trim() || progress !== '0')) setNewDraft({ title, progress });
    setModal(false);
  }

  function openEdit(g: Goal) {
    setEditGoal(g);
    setTitle(g.title);
    setProgress(String(g.progress));
    setFormError(null);
    setModal(true);
  }

  async function handleSave() {
    const pct = Math.max(0, Math.min(100, parseInt(progress, 10) || 0));
    if (!title.trim()) return;
    setSaving(true);
    let ok: boolean;
    if (editGoal) {
      ok = await updateProgress(editGoal.id, pct);
    } else {
      ok = await addGoal({
        kind: activeTab,
        title: title.trim(),
        progress: pct,
        year: CUR_YEAR,
        quarter: activeTab === 'quarterly' ? CUR_QUARTER : null,
        month: activeTab === 'monthly' ? CUR_MONTH : null,
      });
    }
    setSaving(false);
    if (!ok) {
      setFormError(useGoalStore.getState().error ?? 'Kaydedilemedi. Girdiğin bilgiler duruyor; tekrar deneyebilirsin.');
      return;
    }
    if (!editGoal) setNewDraft(null);
    setFormError(null);
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
      <AtmosphericScreenCanvas
        source={CANVASES.strategyAltitude}
        textureSource={TEXTURES.topographic}
        scrim={0.62}
        tintColor={colors.accent}
      />

      {/* Üst Switcher: Hedefler vs OKR vs Yaşam Alanları */}
      <View style={s.topBar}>
        <View style={s.viewSwitch}>
          <TouchableOpacity
            style={[s.viewBtn, visionMode === 'goals' && s.viewBtnActive]}
            onPress={() => { haptic.select(); setVisionMode('goals'); }}
            accessibilityRole="button"
            accessibilityLabel="Hedefler görünümü"
          >
            <Ionicons name="trophy-outline" size={13} color={visionMode === 'goals' ? colors.warning : colors.textDim} />
            <Text style={[s.viewText, visionMode === 'goals' && { color: colors.warning }]}>Hedefler</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.viewBtn, visionMode === 'okr' && s.viewBtnActive]}
            onPress={() => { haptic.select(); setVisionMode('okr'); }}
            accessibilityRole="button"
            accessibilityLabel="OKR görünümü"
          >
            <Ionicons name="flag-outline" size={13} color={visionMode === 'okr' ? colors.error : colors.textDim} />
            <Text style={[s.viewText, visionMode === 'okr' && { color: colors.error }]}>OKR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.viewBtn, visionMode === 'life_areas' && s.viewBtnActive]}
            onPress={() => { haptic.select(); setVisionMode('life_areas'); }}
            accessibilityRole="button"
            accessibilityLabel="Yaşam alanları görünümü"
          >
            <Ionicons name="radio-button-on-outline" size={13} color={visionMode === 'life_areas' ? colors.success : colors.textDim} />
            <Text style={[s.viewText, visionMode === 'life_areas' && { color: colors.success }]}>Yaşam Alanları</Text>
          </TouchableOpacity>
        </View>
      </View>

      {visionMode === 'okr' ? (
        <View style={{ flex: 1 }}>
          <OKRScreen />
        </View>
      ) : visionMode === 'life_areas' ? (
        <View style={{ flex: 1 }}>
          <LifeAreasScreen />
        </View>
      ) : (
        <>
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
            <EditorialBanner
              source={SCREEN_BANNERS.goalsSummit}
              textureSource={TEXTURES.topographic}
              eyebrow="STRATEJİ ZİRVESİ"
              title="Hedefler"
              subtitle="Yıllık, çeyreklik ve aylık kilometre taşların."
              accentColor={tabInfo.color}
              minHeight={90}
              style={{ marginBottom: 14 }}
            />

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
            ) : goals.length === 0 && loadError ? (
              // R06.06 — not reached is not the same as empty
              <LoadErrorState what="Hedefler" onRetry={() => { void loadGoals(); }} />
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
              <View style={s.goldenThreadSpine}>
                {filtered.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    color={tabInfo.color}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </View>
            )}
          </ScrollView>

          {/* FAB */}
          <TouchableOpacity
            style={[s.fab, { backgroundColor: tabInfo.color }]}
            onPress={openAdd}
            accessibilityRole="button"
            accessibilityLabel={`Yeni ${tabInfo.label.toLowerCase()} hedef ekle`}
          >
            <Ionicons name="add" size={24} color={colors.white} />
          </TouchableOpacity>
        </>
      )}

      {/* Modal */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={closeForm}>
        <View style={s.modalBg}>
          <View style={s.modalCard}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>{editGoal ? 'Hedefi Güncelle' : 'Yeni Hedef'}</Text>
              <TouchableOpacity
                onPress={closeForm}
                accessibilityRole="button"
                accessibilityLabel="Kapat"
              >
                <Ionicons name="close" size={20} color={colors.textFaint} />
              </TouchableOpacity>
            </View>

            {!editGoal && (
              <>
                <Text style={s.fieldLabel}>Başlık</Text>
                <TextInput
                  style={s.input}
                  placeholder={`${tabInfo.label} hedefini yaz...`}
                  placeholderTextColor={colors.textFaint}
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
                  style={[s.quickBtn, progress === String(p) && { backgroundColor: alphaHex(tabInfo.color, '20'), borderColor: tabInfo.color }]}
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
              placeholderTextColor={colors.textFaint}
              value={progress}
              onChangeText={setProgress}
              keyboardType="numeric"
            />

            <FormPreview>{`Kaydedilecek: ${goalProgress({ progress: parseInt(progress, 10) || 0 }).label}`}</FormPreview>
            <FormError message={formError} />

            <TouchableOpacity
              style={[s.saveBtn, { backgroundColor: tabInfo.color }, !title.trim() && !editGoal && s.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving || (!title.trim() && !editGoal)}
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

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: hexA(colors.bg, 0.72),
  },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: hexA(colors.surface, 0.92),
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
    gap: 5,
  },
  viewBtnActive: {
    backgroundColor: alphaHex(colors.primary, '20'),
    borderColor: colors.primary,
    borderWidth: 1,
  },
  viewText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textDim,
  },
  viewTextActive: {
    color: colors.primary,
  },

  tabs: { flexDirection: 'row', backgroundColor: hexA(colors.coolBlack850, 0.88), borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, color: colors.textFaint, fontWeight: '600' },

  scroll: { padding: 16, paddingBottom: 80 },

  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  summaryText: { fontSize: 12, color: colors.textFaint },
  summaryPct: { fontSize: 13, fontWeight: '700' },

  goldenThreadSpine: {
    borderLeftWidth: 2,
    borderLeftColor: hexA(colors.warning, 0.38),
    paddingLeft: 12,
  },
  goalCard: {
    backgroundColor: hexA(colors.surface, 0.92), borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 10,
    overflow: 'hidden', position: 'relative',
  },
  goalDone: { borderColor: alphaHex(colors.success, '30'), backgroundColor: alphaHex(colors.success, '08') },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  goalTitle: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500', lineHeight: 20 },
  goalTitleDone: { textDecorationLine: 'line-through', color: colors.textFaint },
  goalPct: { fontSize: 15, fontWeight: '700' },
  manualNote: { fontSize: 11, color: colors.textFaint, marginTop: 6 },

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
    backgroundColor: colors.coolBlack850, borderRadius: 10, padding: 14,
    fontSize: 15, color: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  quickBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: colors.coolBlack850, borderWidth: 1, borderColor: colors.border,
  },
  quickText: { fontSize: 13, color: colors.textFaint },

  saveBtn: { borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
