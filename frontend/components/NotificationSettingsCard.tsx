/**
 * R04.02 / R04.05 / F17 — device-wide reminder settings: four-state permission
 * status with OS Settings link (DOM-18), web progressive disclosure (GAP2-10),
 * same-day quiet deferral, Calm-Tech daily cap chips & honest reconcile summary
 * (DOM-15), and hiding habit names on the lock screen.
 */
import { useEffect, useState } from 'react';
import { AppState, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import { notificationAccess, ensurePermission, openNotificationSettings, syncAllReminders, type NotificationAccess } from '../lib/notifications';
import { getLastReconcileReport, loadReminderSettings, saveReminderSettings, type ReconcileReport } from '../services/reminderService';
import { DEFAULT_REMINDER_SETTINGS, MAX_PER_DAY_CHOICES, type ReminderSettings } from '../lib/reminderPlan';

const QUIET = [
  { key: 'off', label: 'Kapalı', start: null, end: null },
  { key: '22-07', label: '22:00–07:00', start: '22:00', end: '07:00' },
  { key: '23-08', label: '23:00–08:00', start: '23:00', end: '08:00' },
] as const;

export default function NotificationSettingsCard() {
  const [access, setAccess] = useState<NotificationAccess | null>(null);
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [report, setReport] = useState<ReconcileReport | null>(null);

  useEffect(() => {
    void notificationAccess().then(setAccess);
    void loadReminderSettings().then(setSettings);
    setReport(getLastReconcileReport());
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void notificationAccess().then(setAccess);
        setReport(getLastReconcileReport());
      }
    });
    return () => sub.remove();
  }, []);

  async function update(next: ReminderSettings) {
    setSettings(next);
    await saveReminderSettings(next);
    await syncAllReminders([]);
    setReport(getLastReconcileReport());
  }

  return (
    <View style={s.box}>
      <Text style={s.head} accessibilityRole="header">BİLDİRİMLER</Text>
      {access === null && <Text style={s.sub}>İzin durumu okunuyor.</Text>}
      {access === 'granted' && <Text style={s.sub}>Bildirim izni açık.</Text>}
      {access === 'ask' && (
        <View style={s.permBlock}>
          <Text style={s.warn}>Bildirim izni kapalı: hiçbir hatırlatıcı gönderilmiyor.</Text>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={async () => {
              await ensurePermission();
              setAccess(await notificationAccess());
              setReport(getLastReconcileReport());
            }}
            accessibilityRole="button"
            accessibilityLabel="Bildirim izni iste"
          >
            <Text style={s.link}>İzin iste</Text>
          </TouchableOpacity>
        </View>
      )}
      {access === 'blocked' && (
        <View style={s.permBlock}>
          <Text style={s.warn}>Bildirim izni kapalı: hiçbir hatırlatıcı gönderilmiyor.</Text>
          <Text style={s.sub}>Sistem izin penceresi bir daha gösterilemiyor.</Text>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() => void openNotificationSettings()}
            accessibilityRole="button"
            accessibilityLabel="Bildirim ayarlarını aç"
          >
            <Text style={s.link}>Ayarları aç</Text>
          </TouchableOpacity>
        </View>
      )}
      {access === 'unsupported' && (
        <Text style={s.sub}>
          Tarayıcıda hatırlatıcı bildirimleri desteklenmiyor. Hatırlatıcıların mobil uygulamada çalışır; ayarlar burada saklanır.
        </Text>
      )}

      {access !== 'unsupported' && (
        <>
          <Text style={s.label}>SESSİZ SAATLER</Text>
          <View style={s.row}>
            {QUIET.map((q) => {
              const on = settings.quietStart === q.start && settings.quietEnd === q.end;
              return (
                <TouchableOpacity
                  key={q.key}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => update({ ...settings, quietStart: q.start, quietEnd: q.end })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Sessiz saatler ${q.label}`}
                >
                  <Text style={s.chipText}>{q.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.sub}>
            Sessiz saate düşen hatırlatıcı, aynı gün içinde mümkünse sessiz saat bitiminde gönderilir; mümkün değilse gönderilmez.
          </Text>

          <Text style={s.label}>GÜNLÜK EN ÇOK</Text>
          <View style={s.row}>
            {MAX_PER_DAY_CHOICES.map((choice) => {
              const selected = settings.maxPerDay === choice;
              const text = choice === 3 ? '3 (önerilen)' : choice === null ? 'Sınırsız' : String(choice);
              const a11yLabel = choice === null ? 'Günlük sınır yok' : `Günlük en çok ${choice} hatırlatıcı`;
              return (
                <TouchableOpacity
                  key={choice === null ? 'unlimited' : String(choice)}
                  style={[s.chip, selected && s.chipOn]}
                  onPress={() => update({ ...settings, maxPerDay: choice })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={a11yLabel}
                >
                  <Text style={s.chipText}>{text}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.sub}>
            {settings.maxPerDay !== null
              ? `Günde en çok ${settings.maxPerDay} hatırlatıcı gelir. Fazlası gönderilmez; önce her alışkanlığa bir hatırlatıcı, kalanı erken saatten ayrılır.`
              : 'Günlük sınır yok. Çok sayıda hatırlatıcı yorucu olabilir; gerekirse sınırı geri aç.'}
          </Text>

          {report && report.capped > 0 && (
            <Text style={s.sub} accessibilityLiveRegion="polite">
              {`Günlük sınır yüzünden önümüzdeki 7 günde ${report.capped} hatırlatıcı gönderilmeyecek.`}
            </Text>
          )}
          {report && report.deferred > 0 && (
            <Text style={s.sub} accessibilityLiveRegion="polite">
              {`${report.deferred} hatırlatıcı sessiz saat bitimine ertelendi.`}
            </Text>
          )}
          {report && report.quieted > 0 && (
            <Text style={s.sub} accessibilityLiveRegion="polite">
              {`${report.quieted} hatırlatıcı sessiz saate denk geldiği için gönderilmeyecek.`}
            </Text>
          )}

          <TouchableOpacity
            style={s.toggleRow}
            onPress={() => update({ ...settings, hideTitles: !settings.hideTitles })}
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.hideTitles }}
            accessibilityLabel="Kilit ekranında ve uygulama önizlemesinde içeriği gizle"
          >
            <Text style={s.toggleText}>Kilit ekranında ve uygulama önizlemesinde içeriği gizle</Text>
            <Text style={[s.chipText, settings.hideTitles && { color: colors.accent }]}>{settings.hideTitles ? 'Açık' : 'Kapalı'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: space.sm, backgroundColor: colors.bgElevated },
  head: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint },
  permBlock: { gap: 6 },
  warn: { fontSize: 13, color: colors.warning },
  sub: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  actionBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  link: { fontSize: 13, color: colors.accent, fontWeight: '700' },
  label: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint, marginTop: space.sm },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  chip: { minHeight: 44, justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  chipText: { fontSize: 12, color: colors.textDim },
  toggleRow: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  toggleText: { fontSize: 13, color: colors.text, flex: 1 },
});
