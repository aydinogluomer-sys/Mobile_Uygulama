/**
 * R01.04 — one day's instance of a habit's checklist. Ticking steps writes
 * the checks, and the day's log follows from them (`logStepFor`): every
 * required step -> done, some progress -> partial, nothing left ticked on a
 * logged day -> miss. Optional steps are extra; they never decide the state.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { hexA, space, radius, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { currentUser } from '../lib/session';
import { useHabitStore } from '../store/habitStore';
import { useLogStore } from '../store/logStore';
import { itemsOn, logStepFor, progressLabel, progressOn } from '../lib/habitChecklist';
import { parseLocalDate } from '../lib/date';
import { formatDayLongTR } from '../lib/yearGrid';
import HabitDayNote from './habits/HabitDayNote';
import type { Habit } from '../lib/supabase';

interface Props {
  habit: Habit | null;
  /** Local YYYY-MM-DD. */
  day: string;
  onClose: () => void;
}

export default function ChecklistSheet({ habit, day, onClose }: Props) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const { checklistItems, checklistChecks, toggleCheck } = useHabitStore(
    useShallow((st) => ({
      checklistItems: st.checklistItems,
      checklistChecks: st.checklistChecks,
      toggleCheck: st.toggleCheck,
    })),
  );
  const { logHabit, getLogForHabit } = useLogStore(
    useShallow((st) => ({
      logHabit: st.logHabit,
      getLogForHabit: st.getLogForHabit,
    })),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerNote, setOfferNote] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    void currentUser().then((u) => setUserId(u?.id ?? null));
  }, []);

  if (!habit) return null;
  const items = itemsOn(checklistItems, habit.id, day);
  const ticked = new Set(checklistChecks.filter((c) => c.habit_id === habit.id && c.day === day).map((c) => c.item_id));
  const progress = progressOn(checklistItems, checklistChecks, habit.id, day);

  async function toggle(itemId: string) {
    if (!habit || busy) return;
    setBusy(itemId);
    setError(null);
    const res = await toggleCheck(habit.id, itemId, day);
    if (!res.ok) { setBusy(null); setError(res.error); return; }
    // The day's log follows the checks, with the states the rest of the app writes.
    const step = logStepFor(res.progress, getLogForHabit(habit.id, day)?.state);
    if (step) {
      const logged = await logHabit({ habitId: habit.id, date: parseLocalDate(day) ?? new Date(), state: step });
      if (!logged.ok) {
        setError(`Adım kaydedildi ama günün kaydı güncellenemedi: ${logged.error}`);
        setOfferNote(false);
      } else {
        setOfferNote(step === 'partial');
      }
    } else {
      setOfferNote(false);
    }
    setBusy(null);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{habit.name}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>
          <Text style={s.progress}>{progressLabel(progress)}</Text>
          <ScrollView contentContainerStyle={{ gap: space.sm, paddingVertical: space.md }}>
            {items.map((it) => {
              const on = ticked.has(it.id);
              return (
                <TouchableOpacity
                  key={it.id}
                  style={[s.row, on && s.rowOn]}
                  onPress={() => toggle(it.id)}
                  disabled={busy !== null}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: busy !== null }}
                  accessibilityLabel={`${it.title}${it.required ? '' : ', isteğe bağlı'}`}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.success : colors.textFaint} />
                  <Text style={[s.itemTitle, on && s.itemTitleOn]}>{it.title}</Text>
                  {!it.required && <Text style={s.optional}>isteğe bağlı</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {offerNote && (
            <HabitDayNote
              variant="offer"
              dayLabel={formatDayLongTR(day)}
              initial={null}
              userId={userId}
              onDismiss={() => setOfferNote(false)}
              onSave={async (note) => {
                const res = await logHabit({
                  habitId: habit.id,
                  date: parseLocalDate(day) ?? new Date(),
                  state: 'partial',
                  note,
                });
                if (res.ok) {
                  setOfferNote(false);
                  return { ok: true };
                }
                return { ok: false, error: res.error };
              }}
            />
          )}
          <Text style={s.note}>
            Zorunlu adımların hepsi bitince gün tamamlanmış sayılır; bir kısmı bitince kısmi. İsteğe bağlı adımlar ekstradır.
          </Text>
          {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: hexA(colors.black, 0.55) },
    sheet: { maxHeight: '85%', backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
    progress: { fontSize: 12, color: colors.textFaint, marginTop: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
    rowOn: { borderColor: colors.success },
    itemTitle: { flex: 1, fontSize: 15, color: colors.text },
    itemTitleOn: { color: colors.textDim },
    optional: { fontSize: 11, color: colors.textFaint },
    note: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
    error: { fontSize: 12, color: colors.error, marginTop: space.sm },
  });
