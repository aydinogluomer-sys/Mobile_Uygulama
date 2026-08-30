import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput,
  TouchableOpacity, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRoutineStore } from '../store/routineStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { ACTION_COST } from '../lib/subscription';
import { ROUTINE_PACKS, type RoutinePack } from '../lib/routinePacks';
import { MAX_ESTIMATED_MINUTES, type ProposalCompletion } from '../lib/routineProposal';
import { DIFFICULTY_LEVELS } from '../lib/triage';
import { Chip } from './ui';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const MAX_CHARS = 200;

export default function AIRoutineModal({ visible, onClose }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const { focusPoints, fetch: fetchSub } = useSubscriptionStore();

  const {
    generating,
    generateError,
    generateRoutine,
    proposal,
    proposalErrors,
    evaluation,
    pendingProposal,
    completeProposal,
    loadPack,
    clearGenerated,
    installing,
    installError,
    installed,
    confirmInstall,
  } = useRoutineStore();

  // Tamamlama formu -- yalnızca `pendingProposal` (AI'nın difficulty/
  // estimated_minutes vermediği eksik öneri) doluyken kullanılır. Habit
  // index'ine göre hizalı; hiçbir alan otomatik doldurulmaz (bkz.
  // lib/routineProposal.ts'nin "no coercion" kuralı).
  const [completions, setCompletions] = useState<Record<number, { difficulty?: 1 | 3 | 5; estimated_minutes?: number }>>({});
  const [minutesText, setMinutesText] = useState<Record<number, string>>({});

  useEffect(() => { if (visible) fetchSub(); }, [visible, fetchSub]);

  // Yeni bir eksik öneri geldiğinde (yeni bir AI çağrısı) formu sıfırla --
  // ama başarısız bir "Devam Et" denemesinden sonra (pendingProposal AYNI
  // referans kalır, çünkü store başarısızlıkta onu temizlemez) kullanıcının
  // girdiği değerler KORUNUR.
  useEffect(() => {
    setCompletions({});
    setMinutesText({});
  }, [pendingProposal]);

  function handleClose() {
    setPrompt('');
    clearGenerated();
    onClose();
  }

  async function handleGenerate() {
    if (prompt.trim().length < 3 || generating) return;
    await generateRoutine(prompt.trim());
  }

  async function handleConfirm() {
    await confirmInstall();
  }

  function setHabitDifficulty(i: number, d: 1 | 3 | 5) {
    setCompletions((prev) => ({ ...prev, [i]: { ...prev[i], difficulty: d } }));
  }

  function setHabitMinutesText(i: number, text: string) {
    setMinutesText((prev) => ({ ...prev, [i]: text }));
    const n = Number(text);
    const valid = text.trim().length > 0 && Number.isFinite(n) && n >= 0 && n <= MAX_ESTIMATED_MINUTES;
    setCompletions((prev) => ({ ...prev, [i]: { ...prev[i], estimated_minutes: valid ? n : undefined } }));
  }

  const allHabitsComplete = !!pendingProposal && pendingProposal.habits.every((_, i) =>
    completions[i]?.difficulty !== undefined && completions[i]?.estimated_minutes !== undefined
  );

  function handleCompleteProposal() {
    if (!pendingProposal || !allHabitsComplete) return;
    const payload: ProposalCompletion[] = pendingProposal.habits.map((_, i) => ({
      difficulty: completions[i]!.difficulty!,
      estimated_minutes: completions[i]!.estimated_minutes!,
    }));
    completeProposal(payload);
  }

  // Ready-made paketten mi, AI'dan mı gösteriliyor -- ikisi de aynı doğrulama +
  // kapasite kapısından geçer (routineStore.ts loadPack/generateRoutine).
  const showPreview = !!proposal && !!evaluation && !installed;
  const showCompletion = !generating && !!pendingProposal;
  const showErrors = !generating && !!proposalErrors && proposalErrors.length > 0 && !pendingProposal;
  const showPickers = !generating && !proposal && !pendingProposal && !showErrors && !installed;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Routine AI</Text>
              <View style={styles.betaBadge}>
                <Text style={styles.betaText}>BETA</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={24} color="#BFBBAE" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">

            {/* Hata kutusu (istek/sunucu hatası) */}
            {generateError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={18} color="#C76A6A" />
                <Text style={styles.errorText}>{generateError}</Text>
              </View>
            ) : null}
            {generateError && /Focus Point/i.test(generateError) ? (
              <TouchableOpacity style={styles.upgradeRow} onPress={() => { onClose(); router.push('/screens/paywall'); }}>
                <Ionicons name="diamond-outline" size={14} color="#fff" />
                <Text style={styles.upgradeRowText}>Üyeliği Yükselt</Text>
              </TouchableOpacity>
            ) : null}

            {/* Doğrulama reddi -- AI (veya bir paket) beklenen şemaya uymadı.
                Hiçbir şey yazılmadı; sebep açıkça gösteriliyor (Gate D: AI
                başarısızlığı sessiz bir no-op ya da çökme değildir). */}
            {showErrors ? (
              <View style={styles.rejectBox}>
                <View style={styles.rejectHeader}>
                  <Ionicons name="shield-outline" size={18} color="#C76A6A" />
                  <Text style={styles.rejectTitle}>Bu öneri doğrulanamadı</Text>
                </View>
                <Text style={styles.rejectSub}>Hiçbir şey eklenmedi. Bulunan sorunlar:</Text>
                {proposalErrors!.slice(0, 6).map((msg, i) => (
                  <Text key={i} style={styles.rejectItem}>• {msg}</Text>
                ))}
                <TouchableOpacity style={styles.retryBtnWide} onPress={() => clearGenerated()}>
                  <Ionicons name="refresh-outline" size={16} color="#BFBBAE" />
                  <Text style={styles.retryText}>Yeniden dene</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Eksik-alan tamamlama -- AI, difficulty/estimated_minutes
                vermiyor (bkz. lib/routineProposal.ts). Kapasite hesaplaması
                bu iki alan olmadan yapılamaz, o yüzden AI reddedilmek yerine
                kabul edilir ama kullanıcı tamamlamadan Onayla'ya geçilemez --
                hiçbir alan otomatik doldurulmaz. */}
            {showCompletion ? (
              <View style={styles.completionBox}>
                <View style={styles.completionHeader}>
                  <Ionicons name="create-outline" size={18} color="#D4A84A" />
                  <Text style={styles.completionTitle}>Birkaç bilgi eksik</Text>
                </View>
                <Text style={styles.completionSub}>
                  AI, {pendingProposal!.title} için zorluk ve süre tahmini vermiyor. Kapasite hesaplaması
                  için her alışkanlık için bu ikisini sen belirlemelisin.
                </Text>

                {pendingProposal!.habits.map((h, i) => {
                  const sel = completions[i] || {};
                  return (
                    <View key={i} style={styles.completionCard}>
                      <Text style={styles.completionHabitName}>{h.name}</Text>

                      <Text style={styles.completionLabel}>Zorluk</Text>
                      <View style={styles.completionRow}>
                        {DIFFICULTY_LEVELS.map((d) => (
                          <Chip
                            key={d.key}
                            label={d.label}
                            color={d.color}
                            icon={d.icon as any}
                            selected={sel.difficulty === d.key}
                            onPress={() => setHabitDifficulty(i, d.key as 1 | 3 | 5)}
                          />
                        ))}
                      </View>

                      <Text style={[styles.completionLabel, { marginTop: 10 }]}>Tahmini süre (dakika)</Text>
                      <TextInput
                        style={styles.completionInput}
                        placeholder={`ör. 10 (maks ${MAX_ESTIMATED_MINUTES})`}
                        placeholderTextColor="#827E72"
                        keyboardType="numeric"
                        value={minutesText[i] ?? ''}
                        onChangeText={(t) => setHabitMinutesText(i, t)}
                      />
                    </View>
                  );
                })}

                <View style={styles.resultActions}>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => clearGenerated()}>
                    <Ionicons name="refresh-outline" size={16} color="#BFBBAE" />
                    <Text style={styles.retryText}>Yeniden dene</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addAllBtn, !allHabitsComplete && styles.generateBtnDisabled]}
                    onPress={handleCompleteProposal}
                    disabled={!allHabitsComplete}
                  >
                    <Ionicons name="arrow-forward-circle" size={18} color="#fff" />
                    <Text style={styles.addAllText}>Devam Et</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {showPickers ? (
              <>
                <Text style={styles.tagline}>Hedefini yaz, rutini AI oluştursun ✨</Text>
                <Text style={styles.hint}>
                  Örn: &quot;Sabah daha üretken olmak istiyorum&quot; veya &quot;sosyal medya bağımlılığımı azaltmak istiyorum&quot;
                </Text>

                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.textarea}
                    placeholder="Hedefini veya durumunu anlat..."
                    placeholderTextColor="#827E72"
                    multiline
                    maxLength={MAX_CHARS}
                    value={prompt}
                    onChangeText={setPrompt}
                    textAlignVertical="top"
                    editable={!generating}
                  />
                  <Text style={styles.charCount}>{prompt.length}/{MAX_CHARS}</Text>
                </View>

                <View style={styles.fpHintRow}>
                  <Ionicons name="flash" size={12} color="#D4A84A" />
                  <Text style={styles.fpHintText}>AI Rutin {ACTION_COST.routine} FP · Bakiyen {focusPoints} FP</Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.generateBtn,
                    prompt.trim().length < 3 && styles.generateBtnDisabled,
                  ]}
                  onPress={handleGenerate}
                  disabled={prompt.trim().length < 3}
                >
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={styles.generateBtnText}>Rutin Oluştur</Text>
                </TouchableOpacity>

                <View style={styles.packsHeader}>
                  <Ionicons name="albums-outline" size={14} color="#BFBBAE" />
                  <Text style={styles.packsHeaderText}>ya da hazır bir paket seç</Text>
                </View>
                {ROUTINE_PACKS.map((pack: RoutinePack) => (
                  <TouchableOpacity key={pack.key} style={styles.packCard} onPress={() => loadPack(pack.key)}>
                    <View style={styles.packIcon}>
                      <Ionicons name="layers-outline" size={18} color="#D97757" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.packTitle}>{pack.title}</Text>
                      <Text style={styles.packGoal}>{pack.goal}</Text>
                      <Text style={styles.packMeta}>{pack.habits.length} alışkanlık</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#56544B" />
                  </TouchableOpacity>
                ))}
              </>
            ) : null}

            {generating && (
              <View style={styles.loadingMsg}>
                <View style={styles.skeletonLine} />
                <View style={[styles.skeletonLine, { width: '70%' }]} />
                <View style={[styles.skeletonLine, { width: '85%' }]} />
              </View>
            )}

            {/* Doğrulanmış + kapasite değerlendirilmiş önizleme. Yazma burada
                DEĞİL -- yalnızca "Onayla ve Ekle" ile, açık kullanıcı onayından
                sonra olur (plan §13: preview -> explicit confirmation -> DB). */}
            {showPreview ? (
              <>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultName}>{proposal!.title}</Text>
                  <Text style={styles.resultDesc}>{proposal!.goal}</Text>
                </View>

                <View style={styles.capacityBox}>
                  <Text style={styles.capacityLine}>
                    Bugünkü yük: {evaluation!.currentLoad} → {evaluation!.projectedIfAllActivated} / 100
                  </Text>
                  <Text style={styles.capacitySub}>
                    {evaluation!.toActivate.length} alışkanlık hemen aktifleşecek
                    {evaluation!.toQueue.length > 0 ? `, ${evaluation!.toQueue.length} tanesi kapasite nedeniyle Bekleme Odasına kuyruğa alınacak` : ''}.
                  </Text>
                </View>

                {evaluation!.habits.map((he, i) => (
                  <View key={i} style={styles.itemCard}>
                    <View style={styles.itemLeft}>
                      <View style={[styles.itemIcon, !he.fits && styles.itemIconQueued]}>
                        <Ionicons
                          name={he.fits ? 'checkmark-circle-outline' : 'time-outline'}
                          size={20}
                          color={he.fits ? '#87A678' : '#D4A84A'}
                        />
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{he.name}</Text>
                        <Text style={[styles.itemStatus, !he.fits && styles.itemStatusQueued]}>
                          {he.fits ? 'Aktif olacak' : 'Kapasite nedeniyle kuyrukta bekleyecek'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}

                {installError ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={18} color="#C76A6A" />
                    <Text style={styles.errorText}>{installError}</Text>
                  </View>
                ) : null}

                <View style={styles.resultActions}>
                  <TouchableOpacity style={styles.retryBtn} onPress={() => clearGenerated()} disabled={installing}>
                    <Ionicons name="refresh-outline" size={16} color="#BFBBAE" />
                    <Text style={styles.retryText}>Yeniden dene</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addAllBtn, installing && styles.generateBtnDisabled]}
                    onPress={handleConfirm}
                    disabled={installing}
                  >
                    {installing ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="add-circle" size={18} color="#fff" />
                        <Text style={styles.addAllText}>Onayla ve Ekle</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {installed ? (
              <View style={styles.successMsg}>
                <Ionicons name="checkmark-circle" size={24} color="#87A678" />
                <Text style={styles.successText}>
                  Alışkanlıklar eklendi. Kapasiteye sığanlar aktif, kalanı Bekleme Odasında.
                </Text>
                <TouchableOpacity onPress={handleClose} style={styles.closeSuccessBtn}>
                  <Text style={styles.closeSuccessText}>Kapat</Text>
                </TouchableOpacity>
              </View>
            ) : null}

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1D1C17', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: '#383528',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  betaBadge: { backgroundColor: '#D9775730', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  betaText: { fontSize: 10, color: '#D97757', fontWeight: '700', letterSpacing: 1 },
  body: { padding: 20 },

  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#C76A6A15', borderWidth: 1, borderColor: '#C76A6A30',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, color: '#C76A6A', lineHeight: 18 },
  upgradeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#D4A84A', borderRadius: 10, paddingVertical: 10, marginBottom: 16,
  },
  upgradeRowText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  fpHintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 10 },
  fpHintText: { fontSize: 12, color: '#BFBBAE' },

  rejectBox: {
    backgroundColor: '#C76A6A10', borderWidth: 1, borderColor: '#C76A6A30',
    borderRadius: 14, padding: 16, marginBottom: 16,
  },
  rejectHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  rejectTitle: { fontSize: 15, fontWeight: '700', color: '#C76A6A' },
  rejectSub: { fontSize: 12.5, color: '#BFBBAE', marginBottom: 8 },
  rejectItem: { fontSize: 12, color: '#BFBBAE', lineHeight: 18, marginBottom: 2 },
  retryBtnWide: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#383528', borderRadius: 12, paddingVertical: 10, marginTop: 10,
  },

  completionBox: {
    backgroundColor: '#D4A84A10', borderWidth: 1, borderColor: '#D4A84A30',
    borderRadius: 14, padding: 16, marginBottom: 16,
  },
  completionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  completionTitle: { fontSize: 15, fontWeight: '700', color: '#D4A84A' },
  completionSub: { fontSize: 12.5, color: '#BFBBAE', lineHeight: 18, marginBottom: 14 },
  completionCard: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#383528',
  },
  completionHabitName: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 10 },
  completionLabel: { fontSize: 11.5, color: '#827E72', fontWeight: '600', marginBottom: 6 },
  completionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  completionInput: {
    backgroundColor: '#15140F', borderRadius: 10, padding: 10, fontSize: 14,
    color: '#fff', borderWidth: 1, borderColor: '#383528',
  },

  tagline: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 8, lineHeight: 26 },
  hint: { fontSize: 13, color: '#BFBBAE', marginBottom: 20, lineHeight: 19 },
  inputWrap: { marginBottom: 16 },
  textarea: {
    backgroundColor: '#1D1C17', borderRadius: 14, padding: 14, fontSize: 15,
    color: '#fff', borderWidth: 1, borderColor: '#383528', minHeight: 100,
  },
  charCount: { fontSize: 11, color: '#827E72', textAlign: 'right', marginTop: 4 },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#D97757', borderRadius: 14, paddingVertical: 15, marginBottom: 16,
  },
  generateBtnDisabled: { opacity: 0.4 },
  generateBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  loadingMsg: { gap: 10, marginTop: 8, marginBottom: 16 },
  skeletonLine: { height: 14, backgroundColor: '#383528', borderRadius: 7, width: '100%' },

  packsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  packsHeaderText: { fontSize: 12, color: '#827E72', fontWeight: '600' },
  packCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 12,
    marginBottom: 10, borderWidth: 1, borderColor: '#383528',
  },
  packIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#D9775715', alignItems: 'center', justifyContent: 'center',
  },
  packTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 2 },
  packGoal: { fontSize: 12, color: '#BFBBAE', marginBottom: 2 },
  packMeta: { fontSize: 11, color: '#827E72' },

  resultHeader: { marginBottom: 12 },
  resultName: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
  resultDesc: { fontSize: 13, color: '#BFBBAE', lineHeight: 18 },

  capacityBox: {
    backgroundColor: '#D4A84A10', borderWidth: 1, borderColor: '#D4A84A30',
    borderRadius: 12, padding: 12, marginBottom: 14,
  },
  capacityLine: { fontSize: 13, fontWeight: '700', color: '#D4A84A', marginBottom: 4 },
  capacitySub: { fontSize: 12, color: '#BFBBAE', lineHeight: 17 },

  itemCard: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#383528',
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#87A67815', alignItems: 'center', justifyContent: 'center',
  },
  itemIconQueued: { backgroundColor: '#D4A84A15' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4 },
  itemStatus: { fontSize: 11.5, color: '#87A678' },
  itemStatusQueued: { color: '#D4A84A' },

  resultActions: { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 32 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#383528', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  retryText: { fontSize: 14, color: '#BFBBAE' },
  addAllBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#87A678', borderRadius: 12, paddingVertical: 12,
  },
  addAllText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  successMsg: {
    alignItems: 'center', gap: 10,
    backgroundColor: '#87A67815', borderRadius: 12, padding: 20,
    marginTop: 16, marginBottom: 32,
  },
  successText: { fontSize: 13, color: '#87A678', lineHeight: 19, textAlign: 'center' },
  closeSuccessBtn: {
    marginTop: 4, backgroundColor: '#87A67830', borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  closeSuccessText: { fontSize: 14, fontWeight: '600', color: '#87A678' },
});
