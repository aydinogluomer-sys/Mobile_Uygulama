/**
 * R09.02 / R09.03 / R09.04 — one second-set coach action: resolved against
 * the user's own habits/tasks, previewed in plain words, and applied only
 * through the command a screen would use. Before writing, the target is
 * checked against the fingerprint taken when the card appeared; a changed
 * target is re-previewed, a gone one is dropped -- never written blind.
 */
import { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { space, radius, hexA, type Palette } from '../../lib/tokens';
import { useThemedStyles } from '../../hooks/useThemeColors';
import EmbeddedFiligree from '../spatial/EmbeddedFiligree';
import { DECOR } from '../../lib/visualAssets';
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
import { loadAfter, weekLightenPlan } from '../../lib/weekLighten';
import { decimalTR } from '../../lib/chartText';
import { isPausedOn } from '../../lib/habitPauses';

export default function CoachActionCardV2({ action, onDone }: { action: CoachActionV2; onDone: (ok: boolean, message: string) => void }) {
  const router = useRouter();
  const s = useThemedStyles(makeStyles);
  const habits = useHabitStore((st) => st.habits);
  const tasks = useTaskStore((st) => st.tasks);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // R10.02 — one card, one effect: a second press (in flight or after) writes nothing.
  const applied = useRef(false);

  // Resolution + the fingerprint taken NOW (R09.03). An ambiguous match keeps
  // its candidates (as they were now) so the user can choose; nothing is guessed.
  const staged = useMemo(() => {
    if (action.type === 'move_task' || action.type === 'suggest_small_step') {
      const r = resolveTaskQuery(action.task_query, tasks);
      if (r.kind === 'one') return { kind: 'task' as const, task: r.task, fp: taskFingerprint(r.task) };
      if (r.kind === 'ambiguous') return { kind: 'ambiguous' as const, query: action.task_query, options: r.candidates.map((t) => ({ id: t.id, label: t.title, pick: { kind: 'task' as const, task: t, fp: taskFingerprint(t) } })) };
      return { kind: 'none' as const, query: action.task_query };
    }
    if (action.type === 'lighten_today' || action.type === 'lighten_week') return { kind: 'many' as const };
    const r = resolveHabitQuery(action.habit_query, habits);
    if (r.kind === 'exact') return { kind: 'habit' as const, habit: r.habit, fp: habitFingerprint(r.habit) };
    if (r.kind === 'ambiguous') return { kind: 'ambiguous' as const, query: action.habit_query, options: r.candidates.map((h) => ({ id: h.id, label: h.name, pick: { kind: 'habit' as const, habit: h, fp: habitFingerprint(h) } })) };
    return { kind: 'none' as const, query: action.habit_query };
    // Staged once: later store changes are compared, not silently absorbed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);
  // The chosen candidate becomes the target, with the fingerprint of the
  // moment the card appeared -- a change since then is still caught.
  const target = staged.kind === 'ambiguous' ? staged.options.find((o) => o.id === picked)?.pick ?? staged : staged;

  const lightCandidates = useMemo(() => {
    if (action.type !== 'lighten_today') return [];
    return action.habit_queries
      .map((q) => resolveHabitQuery(q, habits))
      .flatMap((r) => (r.kind === 'exact' ? [r.habit] : []))
      .filter((h, i, a) => h.status === 'active' && a.findIndex((x) => x.id === h.id) === i);
  }, [action, habits]);
  // R09.04 — the week plan, computed once from the habits as the card appeared.
  const weekPlan = useMemo(() => (action.type === 'lighten_week' ? weekLightenPlan(habits, new Date()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action]);
  const [kept, setKept] = useState<Set<string>>(() => new Set(
    weekPlan ? weekPlan.rows.filter((r) => r.suggested).map((r) => r.id) : lightCandidates.map((h) => h.id),
  ));
  const chips = weekPlan
    ? weekPlan.rows.map((r) => ({ id: r.id, label: `${r.name} · ${decimalTR(r.points)}` }))
    : lightCandidates.map((h) => ({ id: h.id, label: h.name }));

  function describe(): string {
    if (target.kind === 'none') return `"${target.query}" ile eşleşen bir kayıt bulunamadı.`;
    if (target.kind === 'ambiguous') return `"${target.query}" birden fazla kayıtla eşleşti. Hangisi?`;
    switch (action.type) {
      case 'edit_habit_schedule': return target.kind === 'habit' ? `${target.habit.name}: ${frequencySummary(target.habit.frequency_config)} → ${frequencySummary(action.frequency_config)} (bugünden itibaren; geçmiş eski hedefle kalır)` : '';
      case 'pause_habit': return target.kind === 'habit' ? `${target.habit.name}: ${action.from} → ${action.until ?? 'sen açana kadar'} ara` : '';
      case 'move_task': return target.kind === 'task' ? `"${target.task.title}" → ${action.date}` : '';
      case 'suggest_small_step': return target.kind === 'task' ? `"${target.task.title}" için ilk adım: ${action.step} (${action.minutes} dk). Görevi tamamlamaz.` : '';
      case 'lighten_today': return lightCandidates.length ? 'Bugün kenara konacaklar (dokunarak çıkarabilirsin). Hedefler ve takvim değişmez.' : 'Eşleşen aktif alışkanlık yok.';
      case 'edit_reminder_time': return target.kind === 'habit'
        ? `${target.habit.name} hatırlatması: ${reminderTimes(target.habit).join(', ') || 'yok'} → ${(action.reminders.times ?? [action.reminders.time]).join(', ')}${action.reminders.days ? ' (seçili günlerde)' : ''}`
        : '';
      case 'lighten_week': return weekPlan && weekPlan.rows.length
        ? `Bu haftanın kalanı (${weekPlan.from} → ${weekPlan.until}) yükü: ${decimalTR(weekPlan.total)} → ${decimalTR(loadAfter(weekPlan, kept))}. Seçtiklerin Pazar'a kadar ara verir (dokunarak değiştir). Hedefler ve takvim değişmez; ara kendiliğinden biter.`
        : 'Bu haftanın kalanında hafifletilecek aktif alışkanlık yok.';
    }
  }

  async function confirm() {
    if (applied.current) return;
    applied.current = true;
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
          if (ok) router.push('/tabs/focus' as Href);
        }
        return;
      }
      if (action.type === 'lighten_week' && weekPlan) {
        // Each habit re-checked as it is NOW: still active and not resting.
        const live = useHabitStore.getState().habits;
        const chosen = weekPlan.rows.filter((r) => kept.has(r.id)).filter((r) => {
          const h = live.find((x) => x.id === r.id);
          return !!h && h.status === 'active' && !isPausedOn(h, new Date());
        });
        const failed: string[] = [];
        for (const r of chosen) {
          const res = await useHabitStore.getState().addTimeOff(r.id, { kind: 'pause', start_date: weekPlan.from, end_date: weekPlan.until });
          if (!res.ok) failed.push(r.name);
        }
        const done = chosen.length - failed.length;
        onDone(done > 0, done
          ? `✓ ${done} alışkanlık ${weekPlan.until} tarihine kadar ara verdi.${failed.length ? ` Uygulanamayan: ${failed.join(', ')}.` : ''}`
          : failed.length ? `Uygulanamadı: ${failed.join(', ')}.` : 'Hiçbir alışkanlık seçilmedi.');
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
      <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={96} opacity={0.14} />
      <Text style={s.head}>KOÇ ÖNERİSİ</Text>
      <Text style={s.body}>{describe()}</Text>
      {staged.kind === 'ambiguous' && (
        <View style={s.row}>
          {staged.options.map((o) => {
            const on = picked === o.id;
            return (
              <TouchableOpacity key={o.id} style={[s.chip, on && s.chipOn]} onPress={() => setPicked(on ? null : o.id)}
                accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}>
                <Text style={s.chipText}>{o.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {(action.type === 'lighten_today' || action.type === 'lighten_week') && (
        <View style={s.row}>
          {chips.map((c) => {
            const on = kept.has(c.id);
            return (
              <TouchableOpacity key={c.id} style={[s.chip, on && s.chipOn]} onPress={() => setKept((k) => { const n = new Set(k); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={c.label}>
                <Text style={s.chipText}>{c.label}</Text>
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

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: space.sm, backgroundColor: hexA(colors.bgElevated, 0.94), overflow: 'hidden', position: 'relative' },
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
