/**
 * R04.02 / R04.05 — device-wide reminder settings: whether notifications are
 * actually allowed (never shown as working when they are not), quiet hours,
 * and hiding habit names on the lock screen.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import { hasPermission, ensurePermission, syncAllReminders } from '../lib/notifications';
import { loadReminderSettings, saveReminderSettings } from '../services/reminderService';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../lib/reminderPlan';

const QUIET = [
  { key: 'off', label: 'Kapalı', start: null, end: null },
  { key: '22-07', label: '22:00–07:00', start: '22:00', end: '07:00' },
  { key: '23-08', label: '23:00–08:00', start: '23:00', end: '08:00' },
] as const;

export default function NotificationSettingsCard() {
  const [perm, setPerm] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);

  useEffect(() => {
    void hasPermission().then(setPerm);
    void loadReminderSettings().then(setSettings);
  }, []);

  async function update(next: ReminderSettings) {
    setSettings(next);
    await saveReminderSettings(next);
    await syncAllReminders([]); // re-plan with the new settings
  }

  return (
    <View style={s.box}>
      <Text style={s.head} accessibilityRole="header">BİLDİRİMLER</Text>
      {perm === false ? (
        <View style={{ gap: 6 }}>
          <Text style={s.warn}>Bildirim izni kapalı: hiçbir hatırlatıcı gönderilmiyor.</Text>
          <TouchableOpacity onPress={async () => setPerm(await ensurePermission())} accessibilityRole="button" accessibilityLabel="Bildirim izni iste">
            <Text style={s.link}>İzin iste</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={s.sub}>{perm ? 'Bildirim izni açık.' : 'İzin durumu okunuyor…'}</Text>
      )}

      <Text style={s.label}>SESSİZ SAATLER</Text>
      <View style={s.row}>
        {QUIET.map((q) => {
          const on = settings.quietStart === q.start && settings.quietEnd === q.end;
          return (
            <TouchableOpacity key={q.key} style={[s.chip, on && s.chipOn]} onPress={() => update({ ...settings, quietStart: q.start, quietEnd: q.end })}
              accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Sessiz saatler ${q.label}`}>
              <Text style={s.chipText}>{q.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={s.sub}>Sessiz saatlere düşen hatırlatıcılar gönderilmez (ertelenmez).</Text>

      <TouchableOpacity style={s.toggleRow} onPress={() => update({ ...settings, hideTitles: !settings.hideTitles })}
        accessibilityRole="switch" accessibilityState={{ checked: settings.hideTitles }} accessibilityLabel="Kilit ekranında ve uygulama önizlemesinde içeriği gizle">
        <Text style={s.toggleText}>Kilit ekranında ve uygulama önizlemesinde içeriği gizle</Text>
        <Text style={[s.chipText, settings.hideTitles && { color: colors.accent }]}>{settings.hideTitles ? 'Açık' : 'Kapalı'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: space.sm, backgroundColor: colors.bgElevated },
  head: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint },
  warn: { fontSize: 13, color: colors.warning },
  sub: { fontSize: 12, color: colors.textFaint },
  link: { fontSize: 13, color: colors.accent, fontWeight: '700' },
  label: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint, marginTop: space.sm },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  chipText: { fontSize: 12, color: colors.textDim },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  toggleText: { fontSize: 13, color: colors.text, flex: 1 },
});
