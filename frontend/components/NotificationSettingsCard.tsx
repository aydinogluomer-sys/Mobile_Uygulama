/**
 * R04.02 / R04.05 / F17 / F36 — device-wide reminder settings: four-state permission
 * status with OS Settings link (DOM-18), web progressive disclosure (GAP2-10),
 * same-day quiet deferral, Calm-Tech daily cap chips & honest reconcile summary
 * (DOM-15), hiding habit names on the lock screen, and opt-in F36 time-blindness
 * support (task lead, evening close, bounded follow-ups — all default OFF).
 */
import { useEffect, useState } from 'react';
import { AppState, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import Chip from './ui/Chip';
import {
  notificationAccess,
  ensurePermission,
  openNotificationSettings,
  syncAllReminders,
  type NotificationAccess,
} from '../lib/notifications';
import {
  getLastReconcileReport,
  loadReminderSettings,
  loadTimeSupportSettings,
  saveReminderSettings,
  saveTimeSupportSettings,
  type ReconcileReport,
} from '../services/reminderService';
import {
  DEFAULT_REMINDER_SETTINGS,
  MAX_PER_DAY_CHOICES,
  inQuietHours,
  type ReminderSettings,
} from '../lib/reminderPlan';
import {
  DEFAULT_TIME_SUPPORT_SETTINGS,
  EVENING_TIME_CHOICES,
  TASK_LEAD_CHOICES,
  type TimeSupportSettings,
} from '../lib/taskReminderPlan';

const QUIET = [
  { key: 'off', label: 'Kapalı', start: null, end: null },
  { key: '22-07', label: '22:00–07:00', start: '22:00', end: '07:00' },
  { key: '23-08', label: '23:00–08:00', start: '23:00', end: '08:00' },
] as const;

export default function NotificationSettingsCard() {
  const [access, setAccess] = useState<NotificationAccess | null>(null);
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [support, setSupport] = useState<TimeSupportSettings>(DEFAULT_TIME_SUPPORT_SETTINGS);
  const [report, setReport] = useState<ReconcileReport | null>(null);

  useEffect(() => {
    void notificationAccess().then(setAccess);
    void loadReminderSettings().then(setSettings);
    if (typeof loadTimeSupportSettings === 'function') {
      void loadTimeSupportSettings().then(setSupport);
    }
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

  async function updateSupport(next: TimeSupportSettings) {
    const turningOn =
      (next.taskLeadMin > 0 && support.taskLeadMin === 0) ||
      (next.eveningClose && !support.eveningClose) ||
      (next.followUp && !support.followUp);
    setSupport(next);
    if (typeof saveTimeSupportSettings === 'function') {
      await saveTimeSupportSettings(next);
    }
    if (turningOn) {
      await ensurePermission();
      setAccess(await notificationAccess());
    }
    await syncAllReminders([]);
    setReport(getLastReconcileReport());
  }

  const eveningInQuiet =
    support.eveningClose && inQuietHours(support.eveningTime, settings);

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
                <Chip
                  key={q.key}
                  label={q.label}
                  selected={on}
                  accessibilityState={{ selected: on }}
                  onPress={() => void update({ ...settings, quietStart: q.start, quietEnd: q.end })}
                  accessibilityLabel={`Sessiz saatler ${q.label}`}
                  style={s.chip}
                />
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
                <Chip
                  key={choice === null ? 'unlimited' : String(choice)}
                  label={text}
                  selected={selected}
                  accessibilityState={{ selected }}
                  onPress={() => void update({ ...settings, maxPerDay: choice })}
                  accessibilityLabel={a11yLabel}
                  style={s.chip}
                />
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
            onPress={() => void update({ ...settings, hideTitles: !settings.hideTitles })}
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.hideTitles }}
            accessibilityLabel="Kilit ekranında ve uygulama önizlemesinde içeriği gizle"
          >
            <Text style={s.toggleText}>Kilit ekranında ve uygulama önizlemesinde içeriği gizle</Text>
            <Text style={[s.chipText, settings.hideTitles && { color: colors.accent }]}>{settings.hideTitles ? 'Açık' : 'Kapalı'}</Text>
          </TouchableOpacity>

          <Text style={s.label}>ZAMAN DESTEĞİ (hepsi varsayılan kapalı)</Text>

          <Text style={s.sub}>Saatli görevlerde erken hatırlat</Text>
          <View style={s.row}>
            {TASK_LEAD_CHOICES.map((lead) => {
              const selected = support.taskLeadMin === lead;
              const label = lead === 0 ? 'Kapalı' : `${lead} dk`;
              const a11yLabel =
                lead === 0
                  ? 'Görev erken hatırlatıcısı Kapalı'
                  : `Görevden ${lead} dakika önce hatırlat`;
              return (
                <Chip
                  key={String(lead)}
                  label={label}
                  selected={selected}
                  accessibilityState={{ selected }}
                  onPress={() => void updateSupport({ ...support, taskLeadMin: lead })}
                  accessibilityLabel={a11yLabel}
                  style={s.chip}
                />
              );
            })}
          </View>

          <TouchableOpacity
            style={s.toggleRow}
            onPress={() => void updateSupport({ ...support, eveningClose: !support.eveningClose })}
            accessibilityRole="switch"
            accessibilityState={{ checked: support.eveningClose }}
            accessibilityLabel="Akşam kapanış hatırlatıcısı"
          >
            <Text style={s.toggleText}>Akşam kapanış hatırlatıcısı</Text>
            <Text style={[s.chipText, support.eveningClose && { color: colors.accent }]}>
              {support.eveningClose ? 'Açık' : 'Kapalı'}
            </Text>
          </TouchableOpacity>

          {support.eveningClose && (
            <>
              <View style={s.row}>
                {EVENING_TIME_CHOICES.map((time) => {
                  const selected = support.eveningTime === time;
                  return (
                    <Chip
                      key={time}
                      label={time}
                      selected={selected}
                      accessibilityState={{ selected }}
                      onPress={() => void updateSupport({ ...support, eveningTime: time })}
                      accessibilityLabel={`Akşam kapanış saati ${time}`}
                      style={s.chip}
                    />
                  );
                })}
              </View>
              {eveningInQuiet && (
                <Text style={s.warn}>
                  Bu saat sessiz saatlerine denk geliyor; bildirim gönderilmez.
                </Text>
              )}
            </>
          )}

          <TouchableOpacity
            style={s.toggleRow}
            onPress={() => void updateSupport({ ...support, followUp: !support.followUp })}
            accessibilityRole="switch"
            accessibilityState={{ checked: support.followUp }}
            accessibilityLabel="Sınırlı takip"
          >
            <Text style={s.toggleText}>Sınırlı takip</Text>
            <Text style={[s.chipText, support.followUp && { color: colors.accent }]}>
              {support.followUp ? 'Açık' : 'Kapalı'}
            </Text>
          </TouchableOpacity>
          <Text style={s.sub}>
            Bir alışkanlık hatırlatıcısına dokunmazsan en çok iki kez, 10 dk ve 30 dk arayla nazikçe tekrar eder. Sessiz saatlerde ve Odak sırasında asla.
          </Text>
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
