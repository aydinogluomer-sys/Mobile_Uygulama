/**
 * R08.06 — paste a CSV, map its columns, preview, see what is invalid or
 * duplicated, import only the rest. No app-specific adapter is claimed.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { space, radius, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { guessMapping, parseCsv, TARGET_FIELDS, type ImportReport, type ImportTarget, type Mapping } from '../lib/csvImport';
import { previewImport, runImport } from '../services/csvImportService';

export default function CsvImportPanel() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<ImportTarget>('tasks');
  const [hasHeader, setHasHeader] = useState(true);
  const rows = useMemo(() => parseCsv(text), [text]);
  const header = hasHeader ? rows[0] ?? [] : (rows[0] ?? []).map((_, i) => `Sütun ${i + 1}`);
  const [mapping, setMapping] = useState<Mapping>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [resuming, setResuming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset(nextTarget = target, nextRows = rows) {
    setReport(null); setResuming(false); setMsg(null);
    setMapping(guessMapping(nextTarget, hasHeader ? nextRows[0] ?? [] : []));
  }

  function cycle(field: string) {
    const cur = mapping[field];
    const next = cur === undefined ? 0 : cur + 1 >= header.length ? undefined : cur + 1;
    setMapping({ ...mapping, [field]: next });
    setReport(null);
    setResuming(false);
  }

  async function check() {
    setBusy(true); setMsg(null); setResuming(false);
    const r = await previewImport({ target, rows, mapping, hasHeader });
    setBusy(false);
    if (!r.ok) { setMsg(`Hesaptaki kayıtlar okunamadı: ${r.error}`); return; }
    setReport(r.report);
  }

  async function doImport() {
    if (!report) return;
    setBusy(true);
    const r = await runImport(target, report);
    setBusy(false);
    if (r.ok) {
      setMsg(`${r.inserted} kayıt eklendi${r.skipped ? `, ${r.skipped} kayıt zaten vardı` : ''}.`);
      setReport(null);
      setResuming(false);
    } else {
      setMsg(`${r.inserted} kayıt eklendi, sonra durdu: ${r.error}. Kalanı için "Kaldığı yerden sürdür"e bas.`);
      setReport(r.remaining);
      setResuming(true);
    }
  }

  return (
    <View style={s.box}>
      <Text style={s.title}>CSV içe aktar</Text>
      <Text style={s.sub}>Görev ya da günlük kaydı. Alışkanlık kayıtları içe aktarılamaz (her biri XP üretir). Uygulamaya özel dönüştürücü yoktur; sütunları sen eşlersin.</Text>
      <View style={s.row}>
        {(['tasks', 'journal_entries'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.chip, target === t && s.chipOn]}
            onPress={() => { setTarget(t); reset(t); }}
            accessibilityRole="button"
            accessibilityLabel={t === 'tasks' ? 'Hedef tür: Görevler' : 'Hedef tür: Günlük'}
            accessibilityState={{ selected: target === t }}
          >
            <Text style={s.chipText}>{t === 'tasks' ? 'Görevler' : 'Günlük'}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[s.chip, hasHeader && s.chipOn]}
          onPress={() => { setHasHeader((h) => !h); setReport(null); }}
          accessibilityRole="switch"
          accessibilityLabel="İlk satır başlık"
          accessibilityState={{ checked: hasHeader }}
        >
          <Text style={s.chipText}>İlk satır başlık</Text>
        </TouchableOpacity>
      </View>
      <TextInput style={s.input} value={text} multiline placeholder="title,date&#10;Rapor yaz,2026-10-12" placeholderTextColor={colors.textFaint}
        onChangeText={(t) => { setText(t); const next = parseCsv(t); reset(target, next); }} accessibilityLabel="CSV metni" />
      {rows.length > 0 && (
        <>
          <Text style={s.label}>EŞLEME (sütunu değiştirmek için dokun)</Text>
          {TARGET_FIELDS[target].map((f) => (
            <TouchableOpacity key={f.field} style={s.mapRow} onPress={() => cycle(f.field)} accessibilityRole="button" accessibilityLabel={`${f.label} alanının sütununu değiştir`}>
              <Text style={s.mapField}>{f.label}{f.required ? ' *' : ''}</Text>
              <Text style={s.mapCol}>{mapping[f.field] === undefined ? '— eşlenmedi —' : header[mapping[f.field]!] ?? '?'}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.btn} onPress={check} disabled={busy} accessibilityRole="button" accessibilityLabel="Önizle">
            <Text style={s.btnText}>Önizle</Text>
          </TouchableOpacity>
        </>
      )}
      {report && (
        <View style={{ gap: 4 }}>
          <Text style={s.line}>{report.ok.length} eklenecek · {report.invalid.length} geçersiz · {report.duplicateInFile.length} dosyada tekrar · {report.alreadyThere.length} hesapta zaten var</Text>
          {report.ok.slice(0, 5).map((r) => <Text key={r.line} style={s.preview}>{r.line}. satır → {Object.values(r.values).join(' · ')}</Text>)}
          {report.invalid.slice(0, 5).map((r) => <Text key={`i${r.line}`} style={s.err}>{r.line ? `${r.line}. satır: ` : ''}{r.reason}</Text>)}
          {report.ok.length > 0 && (
            <TouchableOpacity
              style={[s.btn, s.primary]}
              onPress={doImport}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={resuming ? 'Kaldığı yerden sürdür' : 'Geçerli satırları içe aktar'}
            >
              <Text style={s.primaryText}>{resuming ? 'Kaldığı yerden sürdür' : `${report.ok.length} satırı içe aktar`}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {msg && <Text style={s.line} accessibilityRole="alert">{msg}</Text>}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    box: { marginTop: space.lg, gap: space.sm },
    title: { fontSize: 14, fontWeight: '700', color: colors.text },
    sub: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
    row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
    chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
    chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
    chipText: { fontSize: 12, color: colors.textDim },
    input: { minHeight: 70, maxHeight: 150, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, color: colors.text, fontSize: 12 },
    label: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint, marginTop: space.sm },
    mapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
    mapField: { fontSize: 13, color: colors.text },
    mapCol: { fontSize: 13, color: colors.accent },
    btn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: space.sm },
    btnText: { fontSize: 13, color: colors.textDim },
    primary: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryText: { fontSize: 13, color: colors.bg, fontWeight: '700' },
    line: { fontSize: 12, color: colors.textDim },
    preview: { fontSize: 12, color: colors.text },
    err: { fontSize: 12, color: colors.error },
  });
