/**
 * R04.02 — a habit's reminders: on/off, up to four times a day, and an
 * optional day group. Reminders still only come on days the habit is
 * scheduled (and not on a break); the day group narrows that further.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import { buildReminderConfig, MAX_REMINDER_TIMES } from '../lib/reminderPlan';
import type { Habit } from '../lib/supabase';

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

interface Props {
  habit: Habit | null;
  /** false when notifications are not allowed on this device -- said, not hidden. */
  permission: boolean | null;
  onClose: () => void;
  onSave: (config: NonNullable<Habit['reminders']>) => Promise<void>;
}

export default function ReminderEditor({ habit, permission, onClose, onSave }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [times, setTimes] = useState<string[]>(['08:00']);
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!habit) return;
    const r = habit.reminders;
    setEnabled(r?.enabled ?? true);
    setTimes(r?.times?.length ? r.times : [r?.time ?? '08:00']);
    setDays(r?.days ?? []);
    setError(null);
  }, [habit]);

  if (!habit) return null;

  async function save() {
    const res = buildReminderConfig(enabled, times, days);
    if (!res.ok) { setError(res.reason); return; }
    await onSave(res.config);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.title} accessibilityRole="header">Hatırlatıcı</Text>
          {permission === false && (
            <Text style={s.warn} accessibilityRole="alert">
              Bu cihazda bildirim izni kapalı; hatırlatıcılar gönderilemez. İzni cihaz ayarlarından açabilirsin.
            </Text>
          )}
          <TouchableOpacity style={[s.toggle, enabled && s.toggleOn]} onPress={() => setEnabled((e) => !e)}
            accessibilityRole="switch" accessibilityState={{ checked: enabled }} accessibilityLabel="Hatırlatıcı açık">
            <Text style={s.toggleText}>{enabled ? 'Açık' : 'Kapalı'}</Text>
          </TouchableOpacity>

          <Text style={s.label}>SAATLER</Text>
          {times.map((t, i) => (
            <View key={i} style={s.row}>
              <TextInput style={s.input} value={t} onChangeText={(v) => { setTimes((ts) => ts.map((x, j) => (j === i ? v : x))); setError(null); }}
                placeholder="SS:DD" placeholderTextColor={colors.textFaint} maxLength={5} accessibilityLabel={`Hatırlatıcı saati ${i + 1}`} />
              {times.length > 1 && (
                <TouchableOpacity onPress={() => setTimes((ts) => ts.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`${t} saatini kaldır`}>
                  <Text style={s.remove}>Kaldır</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          {times.length < MAX_REMINDER_TIMES && (
            <TouchableOpacity onPress={() => setTimes((ts) => [...ts, ''])} accessibilityRole="button" accessibilityLabel="Saat ekle">
              <Text style={s.link}>+ Saat ekle</Text>
            </TouchableOpacity>
          )}

          <Text style={s.label}>GÜNLER</Text>
          <View style={s.row}>
            {DAYS.map((d, i) => {
              const on = days.includes(i);
              return (
                <TouchableOpacity key={d} style={[s.day, on && s.dayOn]} onPress={() => setDays((ds) => (on ? ds.filter((x) => x !== i) : [...ds, i]))}
                  accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={d}>
                  <Text style={s.dayText}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.note}>
            Gün seçmezsen alışkanlığın takvimindeki her gün. Hatırlatıcı yine de yalnız alışkanlığın
            günlerinde, arada değilken ve o gün kaydedilmemişse gelir; dönem hedefi dolunca durur.
          </Text>
          {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
          <View style={s.row}>
            <TouchableOpacity style={s.cancel} onPress={onClose} accessibilityRole="button" accessibilityLabel="Vazgeç"><Text style={s.cancelText}>Vazgeç</Text></TouchableOpacity>
            <TouchableOpacity style={s.save} onPress={save} accessibilityRole="button" accessibilityLabel="Hatırlatıcıyı kaydet"><Text style={s.saveText}>Kaydet</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  warn: { fontSize: 12, color: colors.warning, lineHeight: 17 },
  toggle: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  toggleOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  toggleText: { color: colors.text, fontWeight: '600' },
  label: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint, marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  input: { width: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, color: colors.text },
  remove: { fontSize: 12, color: colors.textFaint },
  link: { fontSize: 13, color: colors.accent, fontWeight: '600' },
  day: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  dayOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  dayText: { fontSize: 12, color: colors.text },
  note: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  error: { fontSize: 12, color: colors.error },
  cancel: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.textDim, fontWeight: '600' },
  save: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.accent },
  saveText: { color: colors.bg, fontWeight: '700' },
});
