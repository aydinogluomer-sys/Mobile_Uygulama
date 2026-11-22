import { colors, alphaHex, hexA } from '../../lib/tokens';
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  Platform,
} from 'react-native';
import { confirm } from '../../lib/dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOKRStore, krProgress, objectiveProgress, type KeyResult, type OKR } from '../../store/okrStore';
import { EmptyState, Skeleton, EditorialBanner, EmblemMedallion } from '../../components/ui';
import { AtmosphericScreenCanvas, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

const now = new Date();
const CUR_Q = Math.floor(now.getMonth() / 3) + 1;
const CUR_Y = now.getFullYear();

export default function OKRScreen() {
  const { okrs, loading, loadOKRs, addObjective, addKeyResult, updateKRValue, removeObjective, removeKR } = useOKRStore();

  const [objModal, setObjModal] = useState(false);
  const [objText, setObjText] = useState('');
  const [objYear, setObjYear] = useState(CUR_Y);
  const [objQuarter, setObjQuarter] = useState(CUR_Q);

  const [krFor, setKrFor] = useState<string | null>(null);
  const [krTitle, setKrTitle] = useState('');
  const [krTarget, setKrTarget] = useState('');
  const [krUnit, setKrUnit] = useState('');

  const [editKr, setEditKr] = useState<KeyResult | null>(null);
  const [editVal, setEditVal] = useState('');

  useEffect(() => { loadOKRs(); }, [loadOKRs]);

  async function submitObjective() {
    if (!objText.trim()) return;
    await addObjective(objText, objYear, objQuarter);
    setObjText(''); setObjModal(false);
  }
  async function submitKR() {
    const t = parseFloat(krTarget);
    if (!krFor || !krTitle.trim() || !(t > 0)) return;
    await addKeyResult(krFor, krTitle, t, krUnit || null);
    setKrTitle(''); setKrTarget(''); setKrUnit(''); setKrFor(null);
  }
  async function submitEdit() {
    if (!editKr) return;
    const v = parseFloat(editVal);
    if (!isNaN(v)) await updateKRValue(editKr.id, v);
    setEditKr(null); setEditVal('');
  }
  async function confirmRemoveObj(o: OKR) {
    if (await confirm({ title: 'Objective Sil', message: `"${o.objective}" ve anahtar sonuçları silinecek.`, confirmText: 'Sil', destructive: true })) {
      await removeObjective(o.id);
    }
  }

  if (loading && okrs.length === 0) {
    // Gelen içerik biliniyor: çeyrek rozeti + objective satırı + ilerleme çubuğu
    // + birkaç KR. Şeklini göster ki gerçek kartlar geldiğinde düzen zıplamasın.
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.strategyAltitude} textureSource={TEXTURES.topographic} scrim={0.62} tintColor={colors.accent} />

        <View style={s.content}>
          {[0, 1].map((i) => (
            <View key={i} style={s.objCard}>
              <View style={s.objHead}><Skeleton width={54} height={18} /></View>
              <Skeleton width="80%" height={16} style={{ marginBottom: 12 }} />
              <View style={s.objProgRow}>
                <View style={{ flex: 1 }}><Skeleton height={8} /></View>
                <Skeleton width={42} height={13} />
              </View>
              {[0, 1].map((k) => (
                <View key={k} style={s.krRow}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Skeleton width="65%" height={14} />
                    <Skeleton height={5} />
                  </View>
                  <View style={s.krRight}><Skeleton width={60} height={12} /></View>
                </View>
              ))}
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.strategyAltitude} textureSource={TEXTURES.topographic} scrim={0.62} tintColor={colors.accent} />
      <ScrollView contentContainerStyle={s.content}>
        <EditorialBanner
          source={SCREEN_BANNERS.goalsSummit}
          textureSource={TEXTURES.topographic}
          eyebrow="ALTIN İPLİK · OKR"
          title="Amaçlar & Anahtar Sonuçlar"
          subtitle="Vizyonunu ölçülebilir çeyreklik çıktılara bağla."
          accentColor={colors.accent}
          minHeight={90}
          style={{ marginBottom: 14 }}
        />
        {okrs.length === 0 ? (
          <EmptyState
            icon="flag-outline"
            title="Henüz hedef yok"
            hint="Bir Objective ekle, altına ölçülebilir Key Results bağla."
            ctaLabel="Objective ekle"
            onCta={() => { setObjYear(CUR_Y); setObjQuarter(CUR_Q); setObjModal(true); }}
            color={colors.accent}
          />
        ) : (
          okrs.map((o) => {
            const prog = objectiveProgress(o);
            return (
              <View key={o.id} style={s.objCard}>
                <EmbeddedFiligree source={DECOR.cornerBlueprint} size={108} opacity={0.14} />
                <View style={s.objHead}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <EmblemMedallion source={DECOR.goldenThreadNode} size={26} unlocked accentColor={colors.warning} />
                    <View style={s.qBadge}><Text style={s.qBadgeText}>{o.year} Ç{o.quarter}</Text></View>
                  </View>
                  <TouchableOpacity
                    onPress={() => confirmRemoveObj(o)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Objective sil: ${o.objective}`}
                    accessibilityHint="Bu hedefi ve tüm anahtar sonuçlarını siler"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>
                <Text style={s.objText}>{o.objective}</Text>

                <View style={s.objProgRow}>
                  <View style={s.objBarBg}>
                    <View style={[s.objBarFill, { width: `${prog}%` as any }]} />
                  </View>
                  <Text style={s.objProgVal}>{prog}%</Text>
                </View>

                {o.key_results.map((k) => {
                  const p = krProgress(k);
                  return (
                    <TouchableOpacity
                      key={k.id}
                      style={s.krRow}
                      onPress={() => { setEditKr(k); setEditVal(String(k.current_value)); }}
                      onLongPress={() => removeKR(k.id)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${k.title}. ${k.current_value} / ${k.target_value}${k.unit ? ` ${k.unit}` : ''}, yüzde ${p}`}
                      accessibilityHint="Değeri güncellemek için dokun, silmek için uzun bas"
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.krTitle}>{k.title}</Text>
                        <View style={s.krBarBg}>
                          <View style={[s.krBarFill, { width: `${p}%` as any }]} />
                        </View>
                      </View>
                      <View style={s.krRight}>
                        <Text style={s.krVal}>{k.current_value}/{k.target_value}{k.unit ? ` ${k.unit}` : ''}</Text>
                        <Text style={s.krPct}>{p}%</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <TouchableOpacity
                  style={s.addKrBtn}
                  onPress={() => setKrFor(o.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Key Result ekle: ${o.objective}`}
                >
                  <Ionicons name="add" size={15} color={colors.accent} />
                  <Text style={s.addKrText}>Key Result ekle</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
        <Text style={s.tip}>İpucu: bir KR&apos;ye dokun → değeri güncelle · uzun bas → sil</Text>
      </ScrollView>

      <TouchableOpacity
        style={s.fab}
        onPress={() => { setObjYear(CUR_Y); setObjQuarter(CUR_Q); setObjModal(true); }}
        accessibilityRole="button"
        accessibilityLabel="Yeni Objective ekle"
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      {/* Objective modal */}
      <Modal visible={objModal} animationType="slide" transparent onRequestClose={() => setObjModal(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Yeni Objective</Text>
            <TextInput style={s.input} placeholder="Hedefin ne? (örn. Sağlığımı iyileştir)" placeholderTextColor={colors.textFaint} value={objText} onChangeText={setObjText} multiline />
            <Text style={s.label}>Yıl</Text>
            <View style={s.row}>
              {[CUR_Y - 1, CUR_Y, CUR_Y + 1].map((y) => (
                <TouchableOpacity
                  key={y}
                  style={[s.chip, objYear === y && s.chipSel]}
                  onPress={() => setObjYear(y)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${y} yılı`}
                  accessibilityState={{ selected: objYear === y, checked: objYear === y }}
                >
                  <Text style={[s.chipText, objYear === y && s.chipTextSel]}>{y}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>Çeyrek</Text>
            <View style={s.row}>
              {[1, 2, 3, 4].map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[s.chip, objQuarter === q && s.chipSel]}
                  onPress={() => setObjQuarter(q)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${q}. çeyrek`}
                  accessibilityState={{ selected: objQuarter === q, checked: objQuarter === q }}
                >
                  <Text style={[s.chipText, objQuarter === q && s.chipTextSel]}>Ç{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.actions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setObjModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Vazgeç"
              >
                <Text style={s.cancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.okBtn, !objText.trim() && s.okBtnDisabled]}
                onPress={submitObjective}
                disabled={!objText.trim()}
                accessibilityRole="button"
                accessibilityLabel="Objective ekle"
                accessibilityState={{ disabled: !objText.trim() }}
              >
                <Text style={s.okText}>Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Key Result modal */}
      <Modal visible={krFor !== null} animationType="slide" transparent onRequestClose={() => setKrFor(null)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Yeni Key Result</Text>
            <TextInput style={s.input} placeholder="Ölçülebilir sonuç (örn. Haftada 3 antrenman)" placeholderTextColor={colors.textFaint} value={krTitle} onChangeText={setKrTitle} />
            <View style={s.row}>
              <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="Hedef (örn. 12)" placeholderTextColor={colors.textFaint} keyboardType="numeric" value={krTarget} onChangeText={setKrTarget} />
              <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="Birim (ops.)" placeholderTextColor={colors.textFaint} value={krUnit} onChangeText={setKrUnit} />
            </View>
            <View style={s.actions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setKrFor(null)}
                accessibilityRole="button"
                accessibilityLabel="Vazgeç"
              >
                <Text style={s.cancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.okBtn, !(krTitle.trim() && parseFloat(krTarget) > 0) && s.okBtnDisabled]}
                onPress={submitKR}
                disabled={!(krTitle.trim() && parseFloat(krTarget) > 0)}
                accessibilityRole="button"
                accessibilityLabel="Key Result ekle"
                accessibilityState={{ disabled: !(krTitle.trim() && parseFloat(krTarget) > 0) }}
              >
                <Text style={s.okText}>Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* KR değer güncelle modal */}
      <Modal visible={editKr !== null} animationType="fade" transparent onRequestClose={() => setEditKr(null)}>
        <View style={s.overlayCenter}>
          <View style={s.editSheet}>
            <Text style={s.sheetTitle}>İlerlemeyi Güncelle</Text>
            <Text style={s.editSub} numberOfLines={2}>{editKr?.title}</Text>
            <TextInput style={[s.input, { textAlign: 'center', fontSize: 22 }]} keyboardType="numeric" value={editVal} onChangeText={setEditVal} autoFocus
              placeholder="0" placeholderTextColor={colors.textFaint} />
            <Text style={s.editTarget}>Hedef: {editKr?.target_value}{editKr?.unit ? ` ${editKr.unit}` : ''}</Text>
            <View style={s.actions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setEditKr(null)}
                accessibilityRole="button"
                accessibilityLabel="Vazgeç"
              >
                <Text style={s.cancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.okBtn}
                onPress={submitEdit}
                accessibilityRole="button"
                accessibilityLabel="İlerlemeyi kaydet"
              >
                <Text style={s.okText}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 90 },

  empty: { alignItems: 'center', paddingTop: 70, gap: 8 },
  emptyText: { fontSize: 17, color: colors.textDim, fontWeight: '600' },
  emptyHint: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },
  tip: { fontSize: 11, color: colors.textFaint, textAlign: 'center', marginTop: 8 },

  objCard: { backgroundColor: hexA(colors.surface, 0.92), borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 2, borderLeftColor: hexA(colors.warning, 0.42), marginBottom: 14, overflow: 'hidden', position: 'relative' },
  objHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  qBadge: { backgroundColor: alphaHex(colors.accent, '20'), borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  qBadgeText: { fontSize: 11, color: colors.accent, fontWeight: '700' },
  objText: { fontSize: 16, fontWeight: '700', color: colors.white, marginBottom: 12 },
  objProgRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  objBarBg: { flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  objBarFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  objProgVal: { fontSize: 13, fontWeight: '800', color: colors.accent, width: 42, textAlign: 'right' },

  krRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  krTitle: { fontSize: 14, color: colors.text, marginBottom: 6 },
  krBarBg: { height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  krBarFill: { height: '100%', backgroundColor: colors.success, borderRadius: 3 },
  krRight: { alignItems: 'flex-end', minWidth: 70 },
  krVal: { fontSize: 12, color: colors.textDim },
  krPct: { fontSize: 13, fontWeight: '700', color: colors.success, marginTop: 2 },

  addKrBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start' },
  addKrText: { fontSize: 13, color: colors.accent, fontWeight: '600' },

  fab: {
    position: 'absolute', right: 16, bottom: Platform.OS === 'ios' ? 34 : 24,
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  overlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24 },
  editSheet: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.border },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.white, marginBottom: 14 },
  editSub: { fontSize: 13, color: colors.textDim, marginBottom: 14 },
  editTarget: { fontSize: 12, color: colors.textFaint, textAlign: 'center', marginTop: 4, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textDim, marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  chip: { flex: 1, alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  chipSel: { backgroundColor: alphaHex(colors.accent, '20'), borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  chipTextSel: { color: colors.accent },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: colors.text },
  okBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  okBtnDisabled: { opacity: 0.4 },
  okText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
