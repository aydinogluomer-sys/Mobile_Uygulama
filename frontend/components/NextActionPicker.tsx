/**
 * R07.06 — choosing next week's action in the weekly review. The choice runs
 * a real command (a task through the outbox, or the habit's own editor) and
 * is kept with the week; last week's choice is shown with how it turned out.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, space, radius } from '../lib/tokens';
import { currentUser } from '../lib/session';
import { useTaskStore } from '../store/taskStore';
import { useHabitStore } from '../store/habitStore';
import {
  actionFor, actionOutcome, nextWeekMonday, previousWeekKey, reviewActionsKey, taskTitleFrom, upsertAction, type NextAction,
} from '../lib/reviewActions';

export default function NextActionPicker({ weekKey, nextWeekText, editable }: { weekKey: string; nextWeekText: string; editable: boolean }) {
  const router = useRouter();
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const habits = useHabitStore((s) => s.habits);
  const [userId, setUserId] = useState<string | null>(null);
  const [actions, setActions] = useState<NextAction[]>([]);
  const [mode, setMode] = useState<'none' | 'task' | 'habit'>('none');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void currentUser().then(async (u) => {
      if (!u) return;
      setUserId(u.id);
      try { setActions(JSON.parse((await AsyncStorage.getItem(reviewActionsKey(u.id))) ?? '[]')); } catch { setActions([]); }
    });
  }, []);

  async function keep(a: NextAction) {
    const next = upsertAction(actions, a);
    setActions(next);
    if (userId) await AsyncStorage.setItem(reviewActionsKey(userId), JSON.stringify(next)).catch(() => undefined);
  }

  async function chooseTask() {
    const t = title.trim();
    if (!t) { setError('Görev için bir başlık yaz.'); return; }
    const created = await addTask({ title: t, due_date: nextWeekMonday(weekKey), list_type: 'this_week', priority: 'none' });
    if (!created) { setError('Görev eklenemedi.'); return; }
    await keep({ weekKey, kind: 'task', taskId: created.id, label: t, createdAt: new Date().toISOString() });
    setMode('none'); setError(null);
  }

  async function chooseHabit(id: string, name: string) {
    await keep({ weekKey, kind: 'habit_edit', habitId: id, label: `${name} düzenlenecek`, createdAt: new Date().toISOString() });
    setMode('none');
    router.push(`/screens/habit-detail?id=${id}` as never);
  }

  const mine = actionFor(actions, weekKey);
  const last = actionFor(actions, previousWeekKey(weekKey));
  const taskCompleted = (id: string) => { const t = tasks.find((x) => x.id === id); return t ? t.completed : undefined; };

  return (
    <View style={s.box}>
      <Text style={s.head}>SONRAKİ EYLEM</Text>
      {last && <Text style={s.last}>Geçen hafta seçtiğin: {actionOutcome(last, { taskCompleted })}</Text>}
      {mine ? (
        <Text style={s.chosen}>Seçildi: {mine.kind === 'task' ? `"${mine.label}" görevi gelecek hafta için eklendi` : mine.label}</Text>
      ) : editable ? (
        <>
          {mode === 'none' && (
            <View style={s.row}>
              <TouchableOpacity style={s.btn} onPress={() => { setMode('task'); setTitle(taskTitleFrom(nextWeekText)); }} accessibilityRole="button" accessibilityLabel="Gelecek hafta için görev ekle">
                <Text style={s.btnText}>Görev olarak ekle</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btn} onPress={() => setMode('habit')} accessibilityRole="button" accessibilityLabel="Bir alışkanlığı düzenlemeyi seç">
                <Text style={s.btnText}>Bir alışkanlığı düzenle</Text>
              </TouchableOpacity>
            </View>
          )}
          {mode === 'task' && (
            <View style={{ gap: space.sm }}>
              <TextInput style={s.input} value={title} onChangeText={(t) => { setTitle(t); setError(null); }} placeholder="Görev başlığı" placeholderTextColor={colors.textFaint} maxLength={120} accessibilityLabel="Görev başlığı" />
              <View style={s.row}>
                <TouchableOpacity style={s.btn} onPress={() => setMode('none')} accessibilityRole="button" accessibilityLabel="Vazgeç"><Text style={s.btnText}>Vazgeç</Text></TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={chooseTask} accessibilityRole="button" accessibilityLabel="Görevi ekle"><Text style={s.btnPrimaryText}>Ekle</Text></TouchableOpacity>
              </View>
            </View>
          )}
          {mode === 'habit' && (
            <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
              {habits.filter((h) => h.status === 'active').map((h) => (
                <TouchableOpacity key={h.id} style={s.btn} onPress={() => chooseHabit(h.id, h.name)} accessibilityRole="button" accessibilityLabel={`${h.name} alışkanlığını düzenle`}>
                  <Text style={s.btnText}>{h.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        </>
      ) : (
        <Text style={s.last}>Bu hafta için eylem seçilmemiş.</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: space.sm, marginTop: space.md },
  head: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint },
  last: { fontSize: 12, color: colors.textDim },
  chosen: { fontSize: 13, color: colors.text },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  btn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 13, color: colors.textDim },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnPrimaryText: { fontSize: 13, color: colors.bg, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, color: colors.text },
  error: { fontSize: 12, color: colors.error },
});
