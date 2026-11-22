import { colors, alphaHex, hexA } from '../../lib/tokens';
import { useEffect, useState } from 'react';
import {
  useWindowDimensions, View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput,
} from 'react-native';
import { confirm } from '../../lib/dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { EditorialBanner, FormError, LoadErrorState, listState, SheetModal, Skeleton } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { AnimatedMetricValue } from '../../components/motion';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { useDeepWorkStore } from '../../store/deepWorkStore';
import { todayLocal } from '../../lib/date';
// R05.06 — the shared duration contract (active time, breaks left out).
import { parseManualMinutes } from '../../lib/focusDuration';

const QUICK_DURATIONS = [25, 45, 60, 90];

export default function DeepWorkScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 920;
  const { sessions, loading, error: loadError, loadSessions, addSession, removeSession, todayMinutes, weekMinutes } = useDeepWorkStore();
  const [modal, setModal] = useState(false);
  const [subject, setSubject] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [entryError, setEntryError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  async function handleAdd() {
    if (!subject.trim()) return;
    const parsed = parseManualMinutes(minutes);
    if (!parsed.ok) { setEntryError(parsed.reason); return; }
    const saved = await addSession(subject.trim(), parsed.minutes);
    // A failed save keeps the sheet open with what was typed.
    if (!saved) { setEntryError('Seans kaydedilemedi. Tekrar dene.'); return; }
    setEntryError(null);
    setSubject('');
    setMinutes('60');
    setModal(false);
  }

  function formatMins(m: number) {
    if (m < 60) return `${m}dk`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}s ${rem}dk` : `${h}s`;
  }

  const todayM = todayMinutes();
  const weekM = weekMinutes();

  const today = todayLocal();
  const todaySessions = sessions.filter((sess) => sess.date === today);
  const pastSessions = sessions.filter((sess) => sess.date !== today);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.deepworkMonolith}
        textureSource={TEXTURES.sacredGrid}
        scrim={0.6}
        tintColor={colors.teal}
      />
      <ScrollView contentContainerStyle={s.scroll}>
        <EditorialBanner
          source={SCREEN_BANNERS.deepWorkChamber}
          textureSource={TEXTURES.sacredGrid}
          eyebrow="DERİN ODAK ODASI"
          title="Derin Çalışma"
          subtitle="Kesintisiz bilişsel bloklarını ve aktif üretim süreni kaydet."
          accentColor={colors.teal}
          minHeight={96}
          style={{ marginBottom: 16 }}
        />

        {/* Özet kartları */}
        <View style={s.metrics}>
          <View style={[s.metricCard, { borderColor: alphaHex(colors.info, '40') }]}>
            <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={88} opacity={0.16} />
            <Ionicons name="today-outline" size={18} color={colors.info} />
            <AnimatedMetricValue value={formatMins(todayM)} style={s.metricValue} />
            <Text style={s.metricLabel}>Bugün</Text>
          </View>
          <View style={[s.metricCard, { borderColor: alphaHex(colors.accent, '40') }]}>
            <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={88} opacity={0.16} />
            <Ionicons name="calendar-outline" size={18} color={colors.accent} />
            <AnimatedMetricValue value={formatMins(weekM)} style={s.metricValue} />
            <Text style={s.metricLabel}>Bu Hafta</Text>
          </View>
          <View style={[s.metricCard, { borderColor: alphaHex(colors.success, '40') }]}>
            <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={88} opacity={0.16} />
            <Ionicons name="layers-outline" size={18} color={colors.success} />
            <AnimatedMetricValue value={String(todaySessions.length)} style={s.metricValue} />
            <Text style={s.metricLabel}>Seans</Text>
          </View>
        </View>

        <ChapterDivider source={DECOR.dividerSundial} label="DERİN ÇALIŞMA KONSOLU" accentColor={colors.teal} />

        <View style={[s.consoleCols, isWide && pastSessions.length > 0 && s.consoleColsWide]}>
          {/* Bugünkü seanslar */}
          <View style={[s.section, isWide && pastSessions.length > 0 && { flex: 1.2 }]}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>BUGÜN</Text>
              <TouchableOpacity
                style={s.addBtn}
                onPress={() => setModal(true)}
                accessibilityRole="button"
                accessibilityLabel="Seans ekle"
              >
                <Ionicons name="add" size={16} color={colors.info} />
                <Text style={s.addBtnText}>Seans Ekle</Text>
              </TouchableOpacity>
            </View>

            <FormError message={actionError} />

            {loading ? (
              Array.from({ length: 3 }, (_, i) => (
                <View key={i} style={s.sessionRow}>
                  <Skeleton width={8} height={8} circle />
                  <View style={{ flex: 1 }}><Skeleton width="60%" height={13} /></View>
                  <Skeleton width={44} height={12} />
                </View>
              ))
            ) : listState({ loading, error: loadError, count: sessions.length }) === 'error' ? (
              <LoadErrorState what="Seanslar" onRetry={() => { void loadSessions(); }} />
            ) : todaySessions.length === 0 ? (
              <View style={s.emptyCard}>
                <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={120} opacity={0.14} />
                <Ionicons name="flash-outline" size={28} color={colors.teal} />
                <Text style={s.emptyText}>Henüz seans yok</Text>
                <Text style={s.emptyHint}>Derin çalışma seanslarını buraya kaydet</Text>
              </View>
            ) : (
              todaySessions.map((sess) => (
                <View key={sess.id} style={s.sessionRow}>
                  <View style={[s.sessionDot, { backgroundColor: colors.teal }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.sessionSubject}>{sess.subject}</Text>
                  </View>
                  <Text style={[s.sessionDuration, { color: colors.teal }]}>{formatMins(sess.duration_minutes)}</Text>
                  <TouchableOpacity
                    style={s.deleteBtn}
                    onPress={async () => {
                      if (await confirm({ title: 'Sil', message: 'Bu seans silinsin mi?', confirmText: 'Sil', destructive: true })) {
                        const ok = await removeSession(sess.id);
                        setActionError(ok ? null : (useDeepWorkStore.getState().error ?? 'Seans silinemedi.'));
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${sess.subject} seansını sil`}
                  >
                    <Ionicons name="trash-outline" size={14} color={colors.textGhost} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          {/* Geçmiş seanslar */}
          {pastSessions.length > 0 && (
            <View style={[s.section, isWide && { flex: 1 }]}>
              <Text style={[s.sectionTitle, { marginBottom: 12 }]}>GEÇMİŞ (30 GÜN)</Text>
              {pastSessions.slice(0, 20).map((sess) => (
                <View key={sess.id} style={s.sessionRow}>
                  <View style={[s.sessionDot, { backgroundColor: colors.textGhost }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.sessionSubject}>{sess.subject}</Text>
                    <Text style={s.sessionDate}>{sess.date}</Text>
                  </View>
                  <Text style={s.sessionDuration}>{formatMins(sess.duration_minutes)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Seans ekle modal */}
      <SheetModal
        visible={modal}
        align="bottom"
        onClose={() => setModal(false)}
        sheetStyle={s.modalCard}
        accessibilityLabel="Seans Ekle"
      >
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" size={110} opacity={0.14} />
        <View style={s.modalHead}>
          <Text style={s.modalTitle} accessibilityRole="header">Seans Ekle</Text>
          <TouchableOpacity
            onPress={() => setModal(false)}
            accessibilityRole="button"
            accessibilityLabel="Kapat"
          >
            <Ionicons name="close" size={20} color={colors.textFaint} />
          </TouchableOpacity>
        </View>

        <Text style={s.fieldLabel}>Konu / Proje</Text>
        <TextInput
          style={s.input}
          placeholder="Ne üzerine çalıştın?"
          placeholderTextColor={colors.textFaint}
          value={subject}
          onChangeText={setSubject}
          autoFocus
        />

        <Text style={s.fieldLabel}>Aktif süre (molalar hariç)</Text>
        <View style={s.quickRow}>
          {QUICK_DURATIONS.map((d) => (
            <TouchableOpacity
              key={d}
              style={[s.quickBtn, minutes === String(d) && s.quickBtnActive]}
              onPress={() => { setMinutes(String(d)); setEntryError(null); }}
              accessibilityRole="button"
              accessibilityLabel={`${d} dakika`}
              accessibilityState={{ selected: minutes === String(d) }}
            >
              <Text style={[s.quickBtnText, minutes === String(d) && s.quickBtnTextActive]}>
                {d}dk
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={s.input}
          placeholder="Dakika (özel)"
          placeholderTextColor={colors.textFaint}
          value={minutes}
          onChangeText={(t) => { setMinutes(t); setEntryError(null); }}
          keyboardType="numeric"
        />
        {entryError && (
          <Text style={s.entryError} accessibilityRole="alert">{entryError}</Text>
        )}

        <TouchableOpacity
          style={[s.saveBtn, (!subject.trim() || !minutes) && s.saveBtnDisabled]}
          onPress={handleAdd}
          disabled={!subject.trim() || !minutes}
          accessibilityRole="button"
          accessibilityLabel="Kaydet"
          accessibilityState={{ disabled: !subject.trim() || !minutes }}
        >
          <Text style={s.saveBtnText}>Kaydet</Text>
        </TouchableOpacity>
      </SheetModal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { width: '100%', maxWidth: 1120, alignSelf: 'center', padding: 16, paddingBottom: 48 },

  metrics: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  metricCard: {
    flex: 1, alignItems: 'center', gap: 6, padding: 16,
    overflow: 'hidden', position: 'relative',
    backgroundColor: hexA(colors.surface, 0.92), borderRadius: 14, borderWidth: 1,
  },
  metricValue: { fontSize: 20, fontWeight: '700', color: colors.white },
  metricLabel: { fontSize: 11, color: colors.textFaint },

  consoleCols: { gap: 16, marginTop: 8 },
  consoleColsWide: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },

  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: alphaHex(colors.info, '15'), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  addBtnText: { fontSize: 13, color: colors.teal, fontWeight: '600' },

  sessionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: hexA(colors.surface, 0.92), borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: colors.border, marginBottom: 6,
  },
  sessionDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  sessionSubject: { fontSize: 14, color: colors.text, fontWeight: '500' },
  sessionDate: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  sessionDuration: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  deleteBtn: { padding: 4 },

  emptyCard: {
    alignItems: 'center', gap: 6, padding: 32,
    overflow: 'hidden', position: 'relative',
    backgroundColor: hexA(colors.surface, 0.9), borderRadius: 14, borderWidth: 1, borderColor: colors.border,
  },
  emptyText: { fontSize: 14, color: colors.textDim, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center' },

  modalCard: { overflow: 'hidden', position: 'relative', backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderWidth: 1, borderColor: colors.border },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.white },

  fieldLabel: { fontSize: 12, color: colors.textFaint, marginBottom: 8, fontWeight: '600' },
  input: {
    backgroundColor: colors.coolBlack850, borderRadius: 10, padding: 14,
    fontSize: 15, color: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },

  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  quickBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: colors.coolBlack850, borderWidth: 1, borderColor: colors.border,
  },
  quickBtnActive: { backgroundColor: alphaHex(colors.info, '20'), borderColor: colors.teal },
  quickBtnText: { fontSize: 13, color: colors.textFaint },
  quickBtnTextActive: { color: colors.teal, fontWeight: '700' },

  saveBtn: { backgroundColor: colors.teal, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.4 },
  entryError: { fontSize: 12, color: colors.error, marginTop: -4, marginBottom: 12 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
