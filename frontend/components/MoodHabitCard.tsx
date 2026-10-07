/**
 * R07.05 — mood and habits, side by side, over the last 60 days. Local data
 * only (journal moods + habit logs); no AI, no credits. Each habit either has
 * enough paired days for a comparison or says it does not.
 */
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import { addDaysLocal, ymd } from '../lib/date';
import { moodHabitRelation, relationSentence } from '../lib/moodHabitRelation';
import { logsForPeriod } from '../services/reviewService';
import { useHabitStore } from '../store/habitStore';
import type { JournalEntry } from '../store/journalStore';
// R07.02 — check-ins (as recorded) take a day's mood over the single journal mood.
import { useMoodStore } from '../store/moodStore';
import { dailyMoods } from '../lib/moods';

const WINDOW_DAYS = 60;

export default function MoodHabitCard({ entries }: { entries: readonly JournalEntry[] }) {
  const habits = useHabitStore((s) => s.habits);
  const checkins = useMoodStore((s) => s.checkins);
  const hydrateMoods = useMoodStore((s) => s.hydrate);
  useEffect(() => { void hydrateMoods(); }, [hydrateMoods]);
  const [logs, setLogs] = useState<{ habit_id: string; completed_at: string; state: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const to = useMemo(() => new Date(), []);
  const from = useMemo(() => addDaysLocal(new Date(to.getFullYear(), to.getMonth(), to.getDate()), -(WINDOW_DAYS - 1)), [to]);

  useEffect(() => {
    let alive = true;
    void logsForPeriod({ start: ymd(from), end: ymd(to) }).then((r) => {
      if (!alive) return;
      if (r.ok) setLogs(r.data as never); else setFailed(true);
    });
    return () => { alive = false; };
  }, [from, to]);

  const rows = useMemo(() => {
    if (!logs) return [];
    const moods = dailyMoods(checkins, entries.map((e) => ({ date: e.date, mood: e.mood })));
    return habits
      .filter((h) => h.status === 'active')
      .map((h) => ({ h, r: moodHabitRelation({ habit: h, logs, moods, from, to }) }))
      .sort((a, b) => Number(b.r.ok) - Number(a.r.ok) || (b.r.didDays + b.r.didNotDays) - (a.r.didDays + a.r.didNotDays))
      .slice(0, 5);
  }, [logs, entries, habits, from, to, checkins]);

  return (
    <View style={s.box}>
      <Text style={s.head} accessibilityRole="header">RUH HALİ VE ALIŞKANLIKLAR · SON {WINDOW_DAYS} GÜN</Text>
      {failed && <Text style={s.sub}>Alışkanlık kayıtları okunamadı.</Text>}
      {!failed && !logs && <Text style={s.sub}>Okunuyor…</Text>}
      {logs && rows.length === 0 && <Text style={s.sub}>Karşılaştırılacak aktif alışkanlık yok.</Text>}
      {rows.map(({ h, r }) => (
        <Text key={h.id} style={[s.row, !r.ok && s.rowMuted]}>{r.ok ? relationSentence(h.name, r) : `${h.name}: ${r.reason}`}</Text>
      ))}
      <Text style={s.note}>Yalnız ruh halinin ve alışkanlığın aynı gün kayıtlı olduğu günler sayılır. Atlanan günler dışarıda kalır.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: space.sm, marginBottom: space.lg },
  head: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint },
  sub: { fontSize: 12, color: colors.textFaint },
  row: { fontSize: 13, color: colors.text, lineHeight: 19 },
  rowMuted: { color: colors.textFaint },
  note: { fontSize: 11, color: colors.textFaint, lineHeight: 16 },
});
