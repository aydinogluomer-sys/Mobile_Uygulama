/**
 * R08.03 / R08.04 — check an exported JSON and merge what is missing back
 * in. Dry run first, always; the write only after the user has read the
 * plan, and it can be cancelled between chunks.
 *
 * The file arrives by paste: picking a file from storage needs a new native
 * dependency (expo-document-picker -- stop point S14).
 */
import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import { dryRunRestore, executeRestore, type RestoreReport } from '../services/restoreService';
import type { RestorePlan } from '../lib/restorePlan';

export default function RestorePanel() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const cancel = useRef(false);

  async function check() {
    setBusy(true); setError(null); setPlan(null); setSummary([]); setReport(null);
    const r = await dryRunRestore(text);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setPlan(r.plan); setSummary(r.summary);
  }

  function confirmMerge() {
    if (!plan) return;
    if (plan.inserts === 0) { setError('Eklenecek bir şey yok: hesabında bu dosyadaki her şey zaten var.'); return; }
    Alert.alert(
      'Eksikleri ekle',
      `${plan.inserts} kayıt eklenecek. Mevcut hiçbir kayıt değiştirilmez ya da silinmez. Alışkanlıklar kuyruğa (bekleyen) eklenir.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Ekle', onPress: () => { void run(); } },
      ],
    );
  }

  async function run() {
    if (!plan) return;
    cancel.current = false;
    setBusy(true);
    const rep = await executeRestore(plan, { shouldCancel: () => cancel.current });
    setBusy(false);
    setReport(rep);
    setPlan(null);
  }

  return (
    <View style={s.box}>
      <Text style={s.title}>Dışa aktarımı doğrula ve eksikleri ekle</Text>
      <Text style={s.sub}>
        JSON dışa aktarımının metnini buraya yapıştır. Önce yalnız kontrol edilir; hiçbir şey yazılmaz.
        Alışkanlık kayıtları (XP üretir), odak oturumları ve webhook&apos;lar geri yüklenmez.
      </Text>
      <TextInput
        style={s.input}
        value={text}
        onChangeText={(t) => { setText(t); setPlan(null); setSummary([]); setReport(null); setError(null); }}
        placeholder='{"format_version": 3, ...}'
        placeholderTextColor={colors.textFaint}
        multiline
        accessibilityLabel="Dışa aktarım metni"
      />
      <View style={s.row}>
        <TouchableOpacity style={s.btn} onPress={check} disabled={busy || !text.trim()} accessibilityRole="button" accessibilityLabel="Dışa aktarımı doğrula">
          <Text style={s.btnText}>Doğrula (kuru çalıştırma)</Text>
        </TouchableOpacity>
        {plan && (
          <TouchableOpacity style={[s.btn, s.primary]} onPress={confirmMerge} disabled={busy} accessibilityRole="button" accessibilityLabel="Eksik kayıtları ekle">
            <Text style={s.primaryText}>Eksikleri ekle</Text>
          </TouchableOpacity>
        )}
        {busy && plan === null && report === null && <ActivityIndicator color={colors.accent} />}
        {busy && (
          <TouchableOpacity onPress={() => { cancel.current = true; }} accessibilityRole="button" accessibilityLabel="İptal et">
            <Text style={s.cancel}>İptal</Text>
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      {summary.map((l) => <Text key={l} style={s.line}>• {l}</Text>)}
      {report && (
        <View style={{ gap: 4 }}>
          <Text style={s.line}>
            {report.cancelled ? 'İptal edildi. ' : ''}
            Eklenen: {Object.entries(report.inserted).map(([k, v]) => `${k} ${v}`).join(', ') || 'yok'}.
          </Text>
          {report.failed.map((f) => <Text key={f.collection} style={s.error}>{f.collection}: {f.error}</Text>)}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginTop: space.md, gap: space.sm },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  input: { minHeight: 80, maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, color: colors.text, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  btn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 13, color: colors.textDim },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { fontSize: 13, color: colors.bg, fontWeight: '700' },
  cancel: { fontSize: 13, color: colors.textFaint },
  error: { fontSize: 12, color: colors.error },
  line: { fontSize: 12, color: colors.textDim, lineHeight: 17 },
});
