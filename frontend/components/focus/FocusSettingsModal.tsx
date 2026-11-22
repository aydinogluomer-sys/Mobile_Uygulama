import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { currentUser } from '../../lib/session';
import { SPOTIFY_OAUTH_ENABLED } from '../../lib/featureGates';
import { navigateTo } from '../../lib/destinations';
import { colors } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { IconButton } from '../ui';
import {
  toCSV, toExcelXML, sessionsSheet, FocusSessionRow,
  ExportFmt, EXPORT_META, webDownload,
} from '../../lib/focusReport';
import { FocusSettings, DEFAULT_SETTINGS, FOCUS_SETTING_BOUNDS } from '../../store/focusStore';
import { ensurePermission } from '../../lib/notifications';
import { todayLocal } from '../../lib/date';
import {
  allSessions as fetchAllFocusSessions,
  allTasks as fetchAllFocusTasks,
  clearAllSessions as deleteAllFocusSessions,
} from '../../services/focusService';

type Section = 'general' | 'timer' | 'tasks' | 'reports' | 'sounds' | 'account' | 'integrations' | 'advanced';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'general', label: 'Genel' },
  { key: 'timer', label: 'Zamanlayıcı' },
  { key: 'tasks', label: 'Görevler' },
  { key: 'reports', label: 'Raporlar' },
  { key: 'sounds', label: 'Sesler' },
  { key: 'account', label: 'Hesap' },
  ...(SPOTIFY_OAUTH_ENABLED ? [{ key: 'integrations' as const, label: 'Entegrasyonlar' }] : []),
  { key: 'advanced', label: 'Gelişmiş' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  settings: FocusSettings;
  accent: string;
  onSave: (patch: Partial<FocusSettings>) => void;
  onOpenTheme: () => void;
};

export default function FocusSettingsModal({ visible, onClose, settings: st, accent, onSave, onOpenTheme }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Section>('general');
  const [email, setEmail] = useState<string>('');
  const [flash, setFlash] = useState<string>('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showFlash(msg: string) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2600);
  }

  useEffect(() => {
    if (!visible) return;
    setTab('general');
    setFlash('');
    currentUser().then((u) => setEmail(u?.email ?? ''));
  }, [visible]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  function openIntegrations() {
    onClose();
    setTimeout(() => navigateTo(router, 'integrations'), 120);
  }

  async function exportAll(fmt: ExportFmt) {
    const user = await currentUser();
    if (!user) return;
    const [tasksRes, sessionsRes] = await Promise.all([
      fetchAllFocusTasks(),
      fetchAllFocusSessions(),
    ]);
    const tasks = tasksRes.ok ? tasksRes.data : [];
    const sessions: FocusSessionRow[] = sessionsRes.ok ? sessionsRes.data : [];

    let message: string;
    if (fmt === 'json') {
      message = JSON.stringify({ settings: st, focus_tasks: tasks, focus_sessions: sessions }, null, 2);
    } else if (fmt === 'csv') {
      message = toCSV(sessions);
    } else {
      message = toExcelXML([
        {
          name: 'Ayarlar',
          headers: ['Ayar', 'Değer'],
          rows: Object.entries(st).map(([k, v]) => [k, v as any]),
        },
        {
          name: 'Görevler',
          headers: ['Başlık', 'Tamamlandı', 'Tahmini', 'Yapılan', 'Toplam sn', 'Oluşturma'],
          rows: tasks.map((t) => [
            t.title ?? '', !!t.completed, t.estimated_pomodoros ?? 0,
            t.completed_pomodoros ?? 0, t.total_focus_seconds ?? 0, t.created_at ?? '',
          ]),
        },
        sessionsSheet(sessions),
      ]);
    }
    const { ext, mime } = EXPORT_META[fmt];
    const filename = `odak-verisi-${todayLocal()}.${ext}`;

    // Web: gerçek dosya indir (Share masaüstü tarayıcılarda yok/no-op).
    if (Platform.OS === 'web') {
      const ok = webDownload(filename, mime, message);
      showFlash(ok ? `${fmt.toUpperCase()} indirildi · ${filename}` : 'Dışa aktarma bu tarayıcıda desteklenmiyor');
      return;
    }
    // iOS: paylaşım sayfası Modal üstünde açılamaz → önce kapat, sonra paylaş.
    if (Platform.OS === 'ios') {
      onClose();
      setTimeout(() => { Share.share({ message, title: `Odak verisi (${fmt.toUpperCase()})` }).catch(() => {}); }, 350);
      return;
    }
    // Android: doğrudan paylaş.
    try { await Share.share({ message, title: `Odak verisi (${fmt.toUpperCase()})` }); showFlash(`${fmt.toUpperCase()} paylaşıldı`); }
    catch { /* iptal */ }
  }

  async function doClearReports() {
    const user = await currentUser();
    if (!user) return;
    await deleteAllFocusSessions();
    try { haptic.success(); } catch { /* yoksay */ }
    showFlash('Rapor verisi temizlendi.');
  }

  function doReset() {
    onSave({ ...DEFAULT_SETTINGS });
    try { haptic.success(); } catch { /* yoksay */ }
    showFlash('Odak ayarları varsayılana döndürüldü.');
  }

  async function toggleNotify() {
    if (st.notifyOnFinish) { onSave({ notifyOnFinish: false }); return; }
    const ok = await ensurePermission();
    if (!ok) { showFlash('Bildirim izni kapalı. Bitiş bildirimi için cihaz ayarlarından izin ver.'); return; }
    onSave({ notifyOnFinish: true });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>Ayarlar</Text>
          <IconButton icon="close" size={24} color={colors.textFaint} label="Ayarları kapat" onPress={onClose} />
        </View>

        <View style={s.body}>
          {/* Sol dikey bölüm menüsü */}
          <ScrollView style={s.sidebar} contentContainerStyle={s.sidebarContent} showsVerticalScrollIndicator={false} accessibilityRole="tablist">
            {SECTIONS.map((sec) => {
              const on = tab === sec.key;
              return (
                <TouchableOpacity
                  key={sec.key}
                  style={[s.sideTab, on && { backgroundColor: accent + '22' }]}
                  onPress={() => setTab(sec.key)}
                  accessibilityRole="tab"
                  accessibilityLabel={sec.label}
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[s.sideTabText, on && { color: accent }]} numberOfLines={1}>{sec.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Sağ içerik */}
          <ScrollView style={s.contentWrap} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {flash ? (
            <View style={[s.flash, { borderColor: accent + '55', backgroundColor: accent + '18' }]}>
              <Ionicons name="checkmark-circle" size={16} color={accent} />
              <Text style={[s.flashText, { color: accent }]} numberOfLines={2}>{flash}</Text>
            </View>
          ) : null}
          {tab === 'general' && (
            <>
              <NavRow label="Tema & arka plan" hint="Arka plan ve zemin koyuluğu" onPress={onOpenTheme} />
              <SegBlock label="Saat formatı" value={st.hourFormat} accent={accent}
                options={[{ v: '24h', l: '24 saat' }, { v: '12h', l: '12 saat' }]}
                onChange={(v) => onSave({ hourFormat: v as FocusSettings['hourFormat'] })} />
              <Toggle label="Bitince bildirim" value={st.notifyOnFinish} accent={accent} onToggle={() => { void toggleNotify(); }} />
            </>
          )}

          {tab === 'timer' && (
            <>
              <Stepper label="Çalışma (dk)" value={st.workMinutes} min={FOCUS_SETTING_BOUNDS.workMinutes[0]} max={FOCUS_SETTING_BOUNDS.workMinutes[1]} step={5} accent={accent} onChange={(v) => onSave({ workMinutes: v })} />
              <Stepper label="Kısa mola (dk)" value={st.shortBreakMinutes} min={FOCUS_SETTING_BOUNDS.shortBreakMinutes[0]} max={FOCUS_SETTING_BOUNDS.shortBreakMinutes[1]} step={1} accent={accent} onChange={(v) => onSave({ shortBreakMinutes: v })} />
              <Stepper label="Uzun mola (dk)" value={st.longBreakMinutes} min={FOCUS_SETTING_BOUNDS.longBreakMinutes[0]} max={FOCUS_SETTING_BOUNDS.longBreakMinutes[1]} step={1} accent={accent} onChange={(v) => onSave({ longBreakMinutes: v })} />
              <Stepper label="Uzun mola aralığı" value={st.longBreakInterval} min={FOCUS_SETTING_BOUNDS.longBreakInterval[0]} max={FOCUS_SETTING_BOUNDS.longBreakInterval[1]} step={1} accent={accent} onChange={(v) => onSave({ longBreakInterval: v })} />
              <Toggle label="Molaları otomatik başlat" value={st.autoStartBreaks} accent={accent} onToggle={() => onSave({ autoStartBreaks: !st.autoStartBreaks })} />
              <Toggle label="Pomodoroları otomatik başlat" value={st.autoStartPomodoros} accent={accent} onToggle={() => onSave({ autoStartPomodoros: !st.autoStartPomodoros })} />
              <Toggle
                label="Uygulamadan çıkınca duraklat"
                value={st.pauseInBackground}
                accent={accent}
                hint="Açıksa süre, uygulamadan çıkınca durur. Kapalıyken süre arka planda da akar."
                onToggle={() => onSave({ pauseInBackground: !st.pauseInBackground })}
              />
              <Toggle
                label="Başlamadan önce niyet sor"
                value={st.intentPrompt}
                accent={accent}
                hint="Açıkken odak başlamadan önce bir nefes ve tek satırlık niyet sorulur; her zaman atlanabilir."
                onToggle={() => onSave({ intentPrompt: !st.intentPrompt })}
              />
            </>
          )}

          {tab === 'tasks' && (
            <>
              <Toggle label="Başlamadan görev seç" value={st.requireTaskBeforeStart} accent={accent} hint="Çalışma için bir görev seçili olmalı" onToggle={() => onSave({ requireTaskBeforeStart: !st.requireTaskBeforeStart })} />
              <Toggle label="Tahmini bitince otomatik tamamla" value={st.autoCheckTasks} accent={accent} hint="Hedef pomodoroya ulaşan görev kapanır" onToggle={() => onSave({ autoCheckTasks: !st.autoCheckTasks })} />
            </>
          )}

          {tab === 'reports' && (
            <>
              <Toggle label="Yerel raporları etkinleştir" value={st.enableLocalReports} accent={accent} onToggle={() => onSave({ enableLocalReports: !st.enableLocalReports })} />
              <SegBlock label="Varsayılan aralık" value={st.defaultReportRange} accent={accent}
                options={[{ v: 'today', l: 'Bugün' }, { v: 'week', l: 'Hafta' }, { v: 'month', l: 'Ay' }, { v: 'year', l: 'Yıl' }]}
                onChange={(v) => onSave({ defaultReportRange: v as FocusSettings['defaultReportRange'] })} />
              <Toggle label="Grafik göster" value={st.showFocusChart} accent={accent} onToggle={() => onSave({ showFocusChart: !st.showFocusChart })} />
              <Toggle label="Sıralama göster" value={st.showRanking} accent={accent} onToggle={() => onSave({ showRanking: !st.showRanking })} />
              <ConfirmRow label="Rapor verisini temizle" confirmLabel="Tüm oturum kayıtları silinsin mi?" onConfirm={doClearReports} />
            </>
          )}

          {tab === 'sounds' && (
            <>
              <Toggle label="Bitince titreşim" value={st.soundOnFinish} accent={accent} onToggle={() => onSave({ soundOnFinish: !st.soundOnFinish })} />
              <Toggle label="Bitince bildirim" value={st.notifyOnFinish} accent={accent} onToggle={() => { void toggleNotify(); }} />
            </>
          )}

          {tab === 'account' && (
            <>
              <Text style={s.note}>Hesap senkronizasyonu için backend gerekir. Şu an yerel mod aktif — ayarların yalnızca bu cihazda saklanıyor.</Text>
              <View style={s.row}><Text style={s.rowLabel}>E-posta</Text><Text style={s.rowValue} numberOfLines={1}>{email || '—'}</Text></View>
            </>
          )}

          {tab === 'integrations' && SPOTIFY_OAUTH_ENABLED && (
            <>
              <Text style={s.note}>Notion, takvim ve diğer servisleri Entegrasyonlar ekranından yönet.</Text>
              <NavRow label="Entegrasyonları yönet" hint="Notion · Google · diğer" onPress={openIntegrations} />
            </>
          )}

          {tab === 'advanced' && (
            <>
              <ExportRow accent={accent} onExport={exportAll} />
              <ConfirmRow label="Odak ayarlarını sıfırla" confirmLabel="Tüm ayarlar varsayılana dönsün mü?" onConfirm={doReset} />
            </>
          )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function NavRow({ label, hint, onPress }: { label: string; hint?: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {hint ? <Text style={s.rowHint}>{hint}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textGhost} />
    </TouchableOpacity>
  );
}

// Modal içi iki-aşamalı onay (Alert native popup'ı Modal üstünde/web'de açılmaz).
function ConfirmRow({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => setArmed(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[s.rowLabel, { color: colors.error }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.error} />
      </TouchableOpacity>
    );
  }
  return (
    <View style={s.row}>
      <Text style={[s.rowLabel, { color: colors.text }]} numberOfLines={2} accessibilityLiveRegion="polite">{confirmLabel}</Text>
      <View style={s.confirmBtns}>
        <TouchableOpacity
          style={s.confirmCancel}
          onPress={() => setArmed(false)}
          accessibilityRole="button"
          accessibilityLabel="Vazgeç"
        >
          <Text style={s.confirmCancelText}>Vazgeç</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.confirmYes}
          onPress={() => { setArmed(false); onConfirm(); }}
          accessibilityRole="button"
          accessibilityLabel="Evet"
        >
          <Text style={s.confirmYesText}>Evet</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ExportRow({ accent, onExport }: { accent: string; onExport: (fmt: ExportFmt) => void }) {
  const opts: { v: ExportFmt; l: string }[] = [
    { v: 'json', l: 'JSON' },
    { v: 'csv', l: 'CSV' },
    { v: 'excel', l: 'Excel' },
  ];
  return (
    <View style={s.block}>
      <View>
        <Text style={s.rowLabel}>Verini dışa aktar</Text>
        <Text style={s.rowHint}>Görevler · oturumlar · ayarlar — paylaş veya kaydet</Text>
      </View>
      <View style={s.segRow}>
        {opts.map((o) => (
          <TouchableOpacity
            key={o.v}
            style={[s.segBtn, { borderColor: accent }]}
            onPress={() => onExport(o.v)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Verini ${o.l} olarak dışa aktar`}
          >
            <Text style={[s.segText, { color: accent }]}>{o.l}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function Stepper({ label, value, min, max, step, accent, onChange }: {
  label: string; value: number; min: number; max: number; step: number; accent: string; onChange: (v: number) => void;
}) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.stepper}>
        <TouchableOpacity
          style={s.stepBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`${label} azalt`}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Ionicons name="remove" size={16} color={colors.textDim} />
        </TouchableOpacity>
        <Text style={[s.stepValue, { color: accent }]} accessibilityLiveRegion="polite">{value}</Text>
        <TouchableOpacity
          style={s.stepBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`${label} artır`}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Ionicons name="add" size={16} color={colors.textDim} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Toggle({ label, value, accent, onToggle, hint }: {
  label: string; value: boolean; accent: string; onToggle: () => void; hint?: string;
}) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {hint ? <Text style={s.rowHint}>{hint}</Text> : null}
      </View>
      <TouchableOpacity
        style={[s.toggle, value ? { backgroundColor: accent } : { backgroundColor: colors.border }]}
        onPress={onToggle}
        activeOpacity={0.8}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        accessibilityLabel={label}
        accessibilityHint={hint}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      >
        <View style={[s.knob, value && { transform: [{ translateX: 18 }] }]} />
      </TouchableOpacity>
    </View>
  );
}

function SegBlock({ label, value, options, accent, onChange }: {
  label: string; value: string; options: { v: string; l: string }[]; accent: string; onChange: (v: string) => void;
}) {
  return (
    <View style={s.block}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.segRow}>
        {options.map((o) => {
          const on = value === o.v;
          return (
            <TouchableOpacity
              key={o.v}
              style={[s.segBtn, on && { backgroundColor: accent + '22', borderColor: accent }]}
              onPress={() => onChange(o.v)}
              accessibilityRole="radio"
              accessibilityLabel={o.l}
              accessibilityState={{ selected: on, checked: on }}
            >
              <Text style={[s.segText, on && { color: accent }]}>{o.l}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },

  body: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 132, borderRightWidth: 1, borderRightColor: colors.borderSubtle },
  sidebarContent: { padding: 8, gap: 2 },
  sideTab: { paddingVertical: 11, paddingHorizontal: 10, borderRadius: 8 },
  sideTabText: { fontSize: 13, fontWeight: '600', color: colors.textFaint },
  contentWrap: { flex: 1 },

  content: { padding: 16, paddingBottom: 40 },

  flash: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  flashText: { flex: 1, fontSize: 12.5, fontWeight: '600' },

  confirmBtns: { flexDirection: 'row', gap: 8 },
  confirmCancel: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  confirmCancelText: { fontSize: 12.5, fontWeight: '700', color: colors.textDim },
  confirmYes: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.error },
  confirmYesText: { fontSize: 12.5, fontWeight: '800', color: colors.white },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowLabel: { fontSize: 14, color: colors.textDim, flex: 1 },
  rowHint: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  rowValue: { fontSize: 13, color: colors.textFaint, maxWidth: '60%' },
  note: { fontSize: 12.5, color: colors.textFaint, lineHeight: 18, marginBottom: 6, paddingVertical: 8 },

  block: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, gap: 10 },
  segRow: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated },
  segText: { fontSize: 12, fontWeight: '700', color: colors.textFaint },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 34, textAlign: 'center', fontSize: 15, fontWeight: '700' },

  toggle: { width: 42, height: 24, borderRadius: 12, padding: 3, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.white },
});
