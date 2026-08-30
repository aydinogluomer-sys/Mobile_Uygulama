import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius, font, fontFamily } from '../../lib/tokens';
import type { RecoveryPlan } from '../../lib/supabase';

type Props = {
  plans: RecoveryPlan[];
  today: string; // 'yyyy-MM-dd'
  onOpen: () => void;
};

/** Telafi rail kartı — son 7 günün telafi planı özeti (Atlas atl-rail-card deseni). */
export default function RecoveryRailCard({ plans, today, onOpen }: Props) {
  const planned = plans.filter((p) => p.status === 'planned');
  const dueToday = planned.filter((p) => p.target_date === today).length;
  const done = plans.filter((p) => p.status === 'completed').length;
  const overdue = planned.filter((p) => p.target_date < today).length;

  const rows = [
    { label: 'Planlı telafi', value: String(planned.length), tone: planned.length ? 'warn' : 'mute' },
    { label: 'Bugün hedefli', value: String(dueToday), tone: dueToday ? 'accent' : 'mute' },
    { label: 'Gecikmiş', value: String(overdue), tone: overdue ? 'bad' : 'mute' },
    { label: 'Tamamlanan', value: String(done), tone: done ? 'ok' : 'mute' },
  ] as const;

  const TONE: Record<string, string> = {
    accent: colors.primary, ok: colors.success, warn: colors.warning, bad: colors.error, mute: colors.textGhost,
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>Telafi · son 7 gün</Text>
        <Ionicons name="moon-outline" size={16} color={colors.textFaint} />
      </View>
      {planned.length === 0 && done === 0 ? (
        <Text style={s.calm}>Telafi planın yok — her şey yolunda.</Text>
      ) : (
        rows.map((r) => (
          <View key={r.label} style={s.row}>
            <Text style={s.rowLabel}>{r.label}</Text>
            <Text style={[s.rowValue, { color: TONE[r.tone] }]}>{r.value}</Text>
          </View>
        ))
      )}
      <TouchableOpacity onPress={onOpen} activeOpacity={0.8} style={s.action}>
        <Text style={s.actionText}>Tam dökümü aç →</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: space.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  title: { ...font.h3, color: colors.text },
  calm: { fontFamily: fontFamily.serif, fontStyle: 'italic', fontSize: 14, color: colors.textFaint, marginBottom: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { ...font.bodySm, color: colors.textDim },
  rowValue: { fontFamily: fontFamily.mono, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
  action: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  actionText: { ...font.bodySm, color: colors.primary, fontWeight: '700' },
});
