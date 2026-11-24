/**
 * R04.02 / F17 — a habit's reminders: on/off, up to four times a day, and an
 * optional day group, with permission/settings guidance (DOM-18), web notice
 * (GAP2-10), and resilient save error handling (GAP1-03).
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput } from 'react-native';
import { hexA, space, radius, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { buildReminderConfig, MAX_REMINDER_TIMES } from '../lib/reminderPlan';
import { openNotificationSettings, type NotificationAccess } from '../lib/notifications';
import type { Habit } from '../lib/supabase';

const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

type SaveOutcome = void | { ok: true } | { ok: false; error: string };

interface Props {
  habit: Habit | null;
  /** Eski tek bayrak (true açık, false kapalı, null bilinmiyor). `access` verilirse o geçerlidir. */
  permission: boolean | null;
  access?: NotificationAccess | null;
  onClose: () => void;
  onSave: (config: NonNullable<Habit['reminders']>) => Promise<SaveOutcome>;
}

const accessOf = (permission: boolean | null, access?: NotificationAccess | null): NotificationAccess | null =>
  access !== undefined ? access : permission === true ? 'granted' : permission === false ? 'ask' : null;

const failed = (o: unknown): o is { ok: false; error: string } =>
  typeof o === 'object' && o !== null && (o as { ok?: unknown }).ok === false;

export default function ReminderEditor({ habit, permission, access, onClose, onSave }: Props) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [prevHabit, setPrevHabit] = useState<Habit | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [times, setTimes] = useState<string[]>(['08:00']);
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  if (prevHabit !== habit) {
    setPrevHabit(habit);
    if (habit) {
      const r = habit.reminders;
      setEnabled(r?.enabled ?? true);
      setTimes(r?.times?.length ? r.times : [r?.time ?? '08:00']);
      setDays(r?.days ?? []);
      setError(null);
      setSaving(false);
    }
  }

  useEffect(() => {
    savingRef.current = false;
  }, [habit]);

  if (!habit) return null;

  const acc = accessOf(permission, access);

  async function save() {
    if (saving || savingRef.current) return;
    const res = buildReminderConfig(enabled, times, days);
    if (!res.ok) { setError(res.reason); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const out: unknown = await onSave(res.config);
      if (failed(out)) setError(out.error || 'Kaydedilemedi. Bağlantını kontrol edip tekrar dene.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi. Bağlantını kontrol edip tekrar dene.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.title} accessibilityRole="header">Hatırlatıcı</Text>
          {acc === 'unsupported' && (
            <Text style={s.note}>
              Tarayıcıda hatırlatıcı bildirimleri desteklenmiyor. Ayarın burada saklanır; bildirimler mobil uygulamada gelir.
            </Text>
          )}
          {(acc === 'ask' || acc === 'blocked') && (
            <View style={s.warnWrap}>
              <Text style={s.warn} accessibilityRole="alert">
                Bu cihazda bildirim izni kapalı; hatırlatıcılar gönderilemez. İzni cihaz ayarlarından açabilirsin.
              </Text>
              {acc === 'blocked' && (
                <TouchableOpacity
                  style={s.settingsBtn}
                  onPress={() => void openNotificationSettings()}
                  accessibilityRole="button"
                  accessibilityLabel="Bildirim ayarlarını aç"
                >
                  <Text style={s.settingsBtnText}>Ayarları aç</Text>
                </TouchableOpacity>
              )}
            </View>
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
            <TouchableOpacity
              style={[s.save, saving && s.saveDisabled]}
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Hatırlatıcıyı kaydet"
              accessibilityState={{ disabled: saving, busy: saving }}
            >
              <Text style={s.saveText}>{saving ? 'Kaydediliyor' : 'Kaydet'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: hexA(colors.black, 0.55) },
  sheet: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  warnWrap: { gap: space.xs },
  warn: { fontSize: 12, color: colors.warning, lineHeight: 17 },
  settingsBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  settingsBtnText: { fontSize: 13, color: colors.accent, fontWeight: '600' },
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
  cancel: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.textDim, fontWeight: '600' },
  save: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.accent },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: colors.bg, fontWeight: '700' },
});
