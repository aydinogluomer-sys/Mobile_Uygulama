/**
 * R09.02 / R09.03 / R09.04 — one second-set coach action: resolved against
 * the user's own habits/tasks, previewed in plain words, and applied only
 * through the command a screen would use. Before writing, the target is
 * checked against the fingerprint taken when the card appeared; a changed
 * target is re-previewed, a gone one is dropped -- never written blind.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, space, radius } from '../../lib/tokens';
import { useHabitStore } from '../../store/habitStore';
import { useTaskStore } from '../../store/taskStore';
import { useLogStore } from '../../store/logStore';
import { useFocusStore } from '../../store/focusStore';
import { resolveHabitQuery } from '../../lib/coachActions';
import {
  habitFingerprint, resolveTaskQuery, staleness, taskFingerprint, type CoachActionV2,
} from '../../lib/coachActionsV2';
import { frequencyEditPatch, frequencySummary } from '../../lib/frequencyForm';
import { todayLocal } from '../../lib/date';
import { reminderTimes } from '../../lib/reminderPlan';

export default function CoachActionCardV2({ action, onDone }: { action: CoachActionV2; onDone: (ok: boolean, message: string) => void }) {
  const router = useRouter();
  const habits = useHabitStore((s) => s.habits);
  const tasks = useTaskStore((s) => s.tasks);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Resolution + the fingerprint taken NOW (R09.03).
  const target = useMemo(() => {
    if (action.type === 'move_task' || action.type === 'suggest_small_step') {
      const r = resolveTaskQuery(action.task_query, tasks);
      return r.kind === 'one' ? { kind: 'task' as const, task: r.task, fp: taskFingerprint(r.task) } : { kind: r.kind, query: action.task_query };
    }
    if (action.type === 'lighten_today') return { kind: 'many' as const };
    const r = resolveHabitQuery(action.habit_query, habits);
    return r.kind === 'exact' ? { kind: 'habit' as const, habit: r.habit, fp: habitFingerprint(r.habit) } : { kind: r.kind, query: action.habit_query };
    // Staged once: later store changes are compared, not silently absorbed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const lightCandidates = useMemo(() => {
    if (action.type !== 'lighten_today') return [];
    return action.habit_queries
      .map((q) => resolveHabitQuery(q, habits))
      .flatMap((r) => (r.kind === 'exact' ? [r.habit] : []))
      .filter((h, i, a) => h.status === 'active' && a.findIndex((x) => x.id === h.id) === i);
  }, [action, habits]);
  const [kept, setKept] = useState<Set<string>>(() => new Set(lightCandidates.map((h) => h.id)));

  function describe(): string {
    if (target.kind === 'none') return `"${'query' in target ? target.query : ''}" ile eşleşen bir kayıt bulunamadı.`;
    if (target.kind === 'ambiguous') return `"${'query' in target ? target.query : ''}" birden fazla kayıtla eşleşti; hangisi olduğunu yazarak belirt.`;
    switch (action.type) {
      case 'edit_habit_schedule': return target.kind === 'habit' ? `${target.habit.name}: ${frequencySummary(target.habit.frequency_config)} → ${frequencySummary(action.frequency_config)} (bugünden itibaren; geçmiş eski hedefle kalır)` : '';
      case 'pause_habit': return target.kind === 'habit' ? `${target.habit.name}: ${action.from} → ${action.until ?? 'sen açana kadar'} ara` : '';
      case 'move_task': return target.kind === 'task' ? `"${target.task.title}" → ${action.date}` : '';
      case 'suggest_small_step': return target.kind === 'task' ? `"${target.task.title}" için ilk adım: ${action.step} (${action.minutes} dk). Görevi tamamlamaz.` : '';
      case 'lighten_today': return lightCandidates.length ? 'Bugün kenara konacaklar (dokunarak çıkarabilirsin). Hedefler ve takvim değişmez.' : 'Eşleşen aktif alışkanlık yok.';
      case 'edit_reminder_time': return target.kind === 'habit'
        ? `${target.habit.name} hatırlatması: ${reminderTimes(target.habit).join(', ') || 'yok'} → ${(action.reminders.times ?? [action.reminders.time]).join(', ')}${action.reminders.days ? ' (seçili günlerde)' : ''}`
        : '';
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      // R09.03 — the entity as it is now, against the one the card showed.
      if (target.kind === 'habit') {
        const cur = useHabitStore.getState().habits.find((h) => h.id === target.habit.id);
        const st = staleness(target.fp, cur, habitFingerprint);
        if (st === 'gone') { onDone(false, `${target.habit.name} artık yok; eylem uygulanmadı.`); return; }
        if (st === 'changed') { setNote('Bu alışkanlık sen bakarken değişti. Önizleme eski hâline göreydi; uygulanmadı. Koça yeniden sor.'); return; }
        if (action.type === 'edit_habit_schedule') {
          await useHabitStore.getState().updateHabit(cur!.id, frequencyEditPatch(cur!, action.frequency_config));
          onDone(true, `✓ ${cur!.name} takvimi güncellendi.`);
        } else if (action.type === 'pause_habit') {
          const r = await useHabitStore.getState().addTimeOff(cur!.id, { kind: 'pause', start_date: action.from, end_date: action.until });
          onDone(r.ok, r.ok ? `✓ ${cur!.name} için ara verildi.` : r.error);
        } else if (action.type === 'edit_reminder_time') {
          await useHabitStore.getState().updateHabit(cur!.id, { reminders: action.reminders });
          onDone(true, `✓ ${cur!.name} hatırlatması güncellendi.`);
        }
        return;
      }
      if (target.kind === 'task') {
        const cur = useTaskStore.getState().tasks.find((t) => t.id === target.task.id);
        const st = staleness(target.fp, cur, taskFingerprint);
        if (st === 'gone') { onDone(false, `"${target.task.title}" artık yok; eylem uygulanmadı.`); return; }
        if (st === 'changed') { setNote('Bu görev sen bakarken değişti; uygulanmadı. Koça yeniden sor.'); return; }
        if (action.type === 'move_task') {
          await useTaskStore.getState().updateTask(cur!.id, { due_date: action.date });
          onDone(true, `✓ "${cur!.title}" ${action.date} tarihine taşındı.`);
        } else if (action.type === 'suggest_small_step') {
          const ok = useFocusStore.getState().startSmallStep({ kind: 'task', id: cur!.id, title: cur!.title }, { title: action.step, minutes: action.minutes });
          onDone(ok, ok ? `✓ "${action.step}" başladı (${action.minutes} dk).` : 'Devam eden bir odak oturumu var; adım başlatılmadı.');
          if (ok) router.push('/tabs/focus' as never);
        }
        return;
      }
      if (action.type === 'lighten_today') {
        const live = useHabitStore.getState().habits;
        const chosen = [...kept].filter((id) => live.some((h) => h.id === id && h.status === 'active'));
        for (const id of chosen) await useLogStore.getState().logHabit({ habitId: id, date: new Date(), state: 'skip' });
        onDone(chosen.length > 0, chosen.length ? `✓ ${chosen.length} alışkanlık bugün (${todayLocal()}) kenara kondu.` : 'Hiçbir alışkanlık seçilmedi.');
      }
    } finally {
      setBusy(false);
    }
  }

  const actionable = target.kind === 'habit' || target.kind === 'task' || (target.kind === 'many' && kept.size > 0);

  return (
    <View style={s.box}>
      <Text style={s.head}>KOÇ ÖNERİSİ</Text>
      <Text style={s.body}>{describe()}</Text>
      {action.type === 'lighten_today' && (
        <View style={s.row}>
          {lightCandidates.map((h) => {
            const on = kept.has(h.id);
            return (
              <TouchableOpacity key={h.id} style={[s.chip, on && s.chipOn]} onPress={() => setKept((k) => { const n = new Set(k); if (n.has(h.id)) n.delete(h.id); else n.add(h.id); return n; })}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={h.name}>
                <Text style={s.chipText}>{h.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {note && <Text style={s.note} accessibilityRole="alert">{note}</Text>}
      <View style={s.row}>
        <TouchableOpacity style={s.btn} onPress={() => onDone(false, 'Vazgeçildi.')} accessibilityRole="button" accessibilityLabel="Vazgeç"><Text style={s.btnText}>Vazgeç</Text></TouchableOpacity>
        {actionable && !note && (
          <TouchableOpacity style={[s.btn, s.primary]} onPress={confirm} disabled={busy} accessibilityRole="button" accessibilityLabel="Uygula">
            <Text style={s.primaryText}>{busy ? 'Uygulanıyor…' : 'Uygula'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: space.sm, backgroundColor: colors.bgElevated },
  head: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint },
  body: { fontSize: 14, color: colors.text, lineHeight: 20 },
  note: { fontSize: 12, color: colors.warning },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  chipText: { fontSize: 12, color: colors.textDim },
  btn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.textDim },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { color: colors.bg, fontWeight: '700' },
});
