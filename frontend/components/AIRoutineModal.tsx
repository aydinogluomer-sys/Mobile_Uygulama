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

interface Props {
  visible: boolean;
  onClose: () => void;
}

const MAX_CHARS = 200;

function freqLabel(item: { tracking_type: string; frequency_config?: { kind?: string; part_of_day?: string[] } }): string {
  const kind = item.frequency_config?.kind;
  const part = item.frequency_config?.part_of_day?.[0];

  const partLabel: Record<string, string> = {
    morning: '🌅 Sabah',
    noon: '☀️ Öğlen',
    afternoon: '🌤 Öğleden Sonra',
    evening: '🌙 Akşam',
    night: '🌃 Gece',
  };

  if (part && partLabel[part]) return partLabel[part];

  const kindLabel: Record<string, string> = {
    daily: '📅 Günlük',
    weekly: '📆 Haftalık',
    monthly: '🗓 Aylık',
  };
  return kindLabel[kind ?? 'daily'] ?? '📅 Günlük';
}

export default function AIRoutineModal({ visible, onClose }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [added, setAdded] = useState(false);
  const { focusPoints, fetch: fetchSub } = useSubscriptionStore();

  const {
    generatedRoutine,
    generating,
    generateError,
    generateRoutine,
    clearGenerated,
    addGeneratedToHabits,
  } = useRoutineStore();

  useEffect(() => { if (visible) fetchSub(); }, [visible]);

  function handleClose() {
    setPrompt('');
    setAdded(false);
    clearGenerated();
    onClose();
  }

  async function handleGenerate() {
    if (prompt.trim().length < 3 || generating) return;
    await generateRoutine(prompt.trim());
  }

  async function handleAddAll() {
    if (!generatedRoutine) return;
    await addGeneratedToHabits(generatedRoutine.items as any);
    setAdded(true);
  }

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

            {/* Hata kutusu */}
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

            {!generatedRoutine ? (
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
                    (prompt.trim().length < 3 || generating) && styles.generateBtnDisabled,
                  ]}
                  onPress={handleGenerate}
                  disabled={prompt.trim().length < 3 || generating}
                >
                  {generating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={18} color="#fff" />
                      <Text style={styles.generateBtnText}>Rutin Oluştur</Text>
                    </>
                  )}
                </TouchableOpacity>

                {generating && (
                  <View style={styles.loadingMsg}>
                    <View style={styles.skeletonLine} />
                    <View style={[styles.skeletonLine, { width: '70%' }]} />
                    <View style={[styles.skeletonLine, { width: '85%' }]} />
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultName}>{generatedRoutine.name}</Text>
                  <Text style={styles.resultDesc}>{generatedRoutine.description}</Text>
                </View>

                {generatedRoutine.items.map((item: any, i: number) => (
                  <View key={i} style={styles.itemCard}>
                    <View style={styles.itemLeft}>
                      <View style={styles.itemIcon}>
                        <Ionicons name={(item.icon ?? 'star-outline') as any} size={20} color="#D97757" />
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <View style={styles.itemBadges}>
                          <View style={styles.costBadge}>
                            <Ionicons name="flash" size={10} color="#D4A84A" />
                            <Text style={styles.costText}>{item.willpower_cost}</Text>
                          </View>
                          {item.tracking_type === 'numeric' && item.daily_goal != null && (
                            <Text style={styles.unitText}>
                              {item.daily_goal} {item.unit ?? ''}
                            </Text>
                          )}
                          <Text style={styles.freqText}>{freqLabel(item)}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ))}

                {generatedRoutine.items.length > 0 && !added ? (
                  <View style={styles.resultActions}>
                    <TouchableOpacity style={styles.retryBtn} onPress={() => clearGenerated()}>
                      <Ionicons name="refresh-outline" size={16} color="#BFBBAE" />
                      <Text style={styles.retryText}>Yeniden dene</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.addAllBtn} onPress={handleAddAll}>
                      <Ionicons name="add-circle" size={18} color="#fff" />
                      <Text style={styles.addAllText}>Beklemeye Ekle</Text>
                    </TouchableOpacity>
                  </View>
                ) : added ? (
                  <View style={styles.successMsg}>
                    <Ionicons name="checkmark-circle" size={24} color="#87A678" />
                    <Text style={styles.successText}>
                      Tüm alışkanlıklar Bekleme Odasına eklendi. Hazır olunca aktifleştirebilirsin!
                    </Text>
                    <TouchableOpacity onPress={handleClose} style={styles.closeSuccessBtn}>
                      <Text style={styles.closeSuccessText}>Kapat</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </>
            )}

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
  loadingMsg: { gap: 10, marginTop: 8 },
  skeletonLine: { height: 14, backgroundColor: '#383528', borderRadius: 7, width: '100%' },

  resultHeader: { marginBottom: 16 },
  resultName: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
  resultDesc: { fontSize: 13, color: '#BFBBAE', lineHeight: 18 },
  itemCard: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#383528',
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#D9775715', alignItems: 'center', justifyContent: 'center',
  },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 4 },
  itemBadges: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  costBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  costText: { fontSize: 11, color: '#D4A84A' },
  unitText: { fontSize: 11, color: '#BFBBAE' },
  freqText: { fontSize: 11, color: '#BFBBAE' },

  resultActions: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 32 },
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
