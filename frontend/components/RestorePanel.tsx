/**
 * R08.03 / R08.04 / F20 (SYN-19, GAP2-05) — check an exported JSON and merge
 * what is missing back in. Dry run first, always; the write only after the
 * user has read the plan, and it can be cancelled between chunks.
 *
 * The file arrives by paste: picking a file from storage needs a new native
 * dependency (expo-document-picker -- stop point S14).
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import { dryRunRestore, executeRestore, loadRestoreJob, type RestoreReport } from '../services/restoreService';
import { isInterrupted, interruptedText, type RestoreJob } from '../lib/restoreJob';
import { loadLocalBackupStatus, runLocalBackup, latestCompleteLocalBackup } from '../services/localBackupService';
import { statusText, EMPTY_STATUS, type LocalBackupStatus } from '../lib/backupRotation';
import { currentUser } from '../lib/session';
import type { RestorePlan } from '../lib/restorePlan';

export default function RestorePanel() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const cancel = useRef(false);
  // R08.04 — the job this file is (same file = same job), and an interrupted one from before.
  const [job, setJob] = useState<{ id: string; fileCreatedAt: string; resumes: boolean } | null>(null);
  const [lastJob, setLastJob] = useState<RestoreJob | null>(null);
  useEffect(() => { void loadRestoreJob().then(setLastJob).catch(() => undefined); }, []);
  // R08.02 — the automatic local copy: honest status, a manual run, and a check of the newest complete copy.
  const [local, setLocal] = useState<LocalBackupStatus>(EMPTY_STATUS);
  const [localBusy, setLocalBusy] = useState(false);
  useEffect(() => {
    void currentUser().then((u) => (u ? loadLocalBackupStatus(u.id) : EMPTY_STATUS)).then(setLocal).catch(() => undefined);
  }, []);
  async function backupNow() {
    setLocalBusy(true);
    const r = await runLocalBackup();
    setLocal(r.status);
    setLocalBusy(false);
    if (!r.ok) setError(r.error);
  }
  async function checkLocal() {
    const b = await latestCompleteLocalBackup();
    if (!b) { setError('Cihazda tam bir yerel yedek yok.'); return; }
    setBusy(true); setError(null); setPlan(null); setSummary([]); setNotices([]); setReport(null);
    const r = await dryRunRestore(b.text);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setPlan(r.plan); setSummary(r.summary); setNotices(r.notices ?? []); setJob(r.job);
  }

  async function check() {
    setBusy(true); setError(null); setPlan(null); setSummary([]); setNotices([]); setReport(null);
    const r = await dryRunRestore(text);
    setBusy(false);
    if (!r.ok) { setError(r.reason); return; }
    setPlan(r.plan); setSummary(r.summary); setNotices(r.notices ?? []); setJob(r.job);
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
    const rep = await executeRestore(plan, { shouldCancel: () => cancel.current, job: job ?? undefined });
    setBusy(false);
    setReport(rep);
    setPlan(null);
    setLastJob(await loadRestoreJob());
  }

  return (
    <View style={s.box}>
      <Text style={s.title}>Yerel yedek</Text>
      <Text style={s.sub} accessibilityLiveRegion="polite">{statusText(local, new Date())}</Text>
      <Text style={s.sub}>Uygulamayı açtığında günde en fazla bir kez, bu cihazda alınır (son 3 kopya). Uygulama açılmazsa yedek alınmaz.</Text>
      <View style={s.row}>
        <TouchableOpacity style={s.btn} onPress={backupNow} disabled={localBusy} accessibilityRole="button" accessibilityLabel="Şimdi yerel yedek al">
          <Text style={s.btnText}>{localBusy ? 'Yedekleniyor…' : 'Şimdi yerel yedek al'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btn} onPress={checkLocal} disabled={busy || localBusy} accessibilityRole="button" accessibilityLabel="Son yerel yedeği doğrula">
          <Text style={s.btnText}>Son yerel yedeği doğrula</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.title}>Dışa aktarımı doğrula ve eksikleri ekle</Text>
      {isInterrupted(lastJob) && !plan && (
        <Text style={s.line} accessibilityRole="alert">{interruptedText(lastJob!)}</Text>
      )}
      <Text style={s.sub}>
        JSON dışa aktarımının metnini buraya yapıştır. Önce yalnız kontrol edilir; hiçbir şey yazılmaz.
        Odak oturumları ve webhook&apos;lar geri yüklenmez. Alışkanlık tarihçen (habit_logs) dosyada tam durur ama bu uygulama onu geri yükleyemez: her kayıt için sunucu XP verdiği için güvenli bir yol henüz yok.
      </Text>
      <TextInput
        style={s.input}
        value={text}
        onChangeText={(t) => { setText(t); setPlan(null); setSummary([]); setNotices([]); setReport(null); setError(null); }}
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
          <TouchableOpacity style={[s.btn, s.primary]} onPress={confirmMerge} disabled={busy} accessibilityRole="button"
            accessibilityLabel={job?.resumes ? 'Yarım kalan geri yüklemeyi sürdür' : 'Eksik kayıtları ekle'}>
            <Text style={s.primaryText}>{job?.resumes ? 'Sürdür' : 'Eksikleri ekle'}</Text>
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
      {notices.length > 0 && (
        <View style={s.noticeBox} accessibilityRole="summary">
          <Text style={s.title}>Bu dosyadan geri yüklenemeyenler</Text>
          {notices.map((n) => <Text key={n} style={s.line}>• {n}</Text>)}
        </View>
      )}
      {report && (
        report.failed[0]?.collection === '*' ? (
          <Text style={s.line} accessibilityRole="alert">Oturum değişti; dosyayı yeniden doğrula.</Text>
        ) : (
          <View style={{ gap: 4 }}>
            <Text style={s.line}>
              {report.cancelled ? 'İptal edildi. ' : ''}
              Eklenen: {Object.entries(report.inserted).map(([k, v]) => `${k} ${v}`).join(', ') || 'yok'}.
            </Text>
            {Object.keys(report.skipped ?? {}).length > 0 && (
              <Text style={s.line}>
                Zaten vardı: {Object.entries(report.skipped).map(([k, v]) => `${k} ${v}`).join(', ')}.
              </Text>
            )}
            {report.failed.map((f) => <Text key={f.collection} style={s.error}>{f.collection}: {f.error}</Text>)}
          </View>
        )
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
  btn: { minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 13, color: colors.textDim },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { fontSize: 13, color: colors.bg, fontWeight: '700' },
  cancel: { fontSize: 13, color: colors.textFaint },
  error: { fontSize: 12, color: colors.error },
  line: { fontSize: 12, color: colors.textDim, lineHeight: 17 },
  noticeBox: { gap: 4, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
});
