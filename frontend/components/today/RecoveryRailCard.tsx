import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../lib/i18n';
import { colors, space, radius, font, fontFamily } from '../../lib/tokens';
import { DECOR, TEXTURES } from '../../lib/visualAssets';
import TexturedSurface from '../ui/TexturedSurface';
import EmbeddedFiligree from '../spatial/EmbeddedFiligree';
import type { RecoveryPlan } from '../../lib/supabase';

type Props = {
  plans: RecoveryPlan[];
  today: string; // 'yyyy-MM-dd'
  onOpen: () => void;
};

/** Telafi rail kartı — son 7 günün Kintsugi altın damarlı telafi planı özeti. */
export default function RecoveryRailCard({ plans, today, onOpen }: Props) {
  const planned = plans.filter((p) => p.status === 'planned');
  const dueToday = planned.filter((p) => p.target_date === today).length;
  const done = plans.filter((p) => p.status === 'completed').length;
  const overdue = planned.filter((p) => p.target_date < today).length;

  const rows = [
    { label: t('today.recovery.rail.planned'), value: String(planned.length), tone: planned.length ? 'warn' : 'mute' },
    { label: t('today.recovery.rail.dueToday'), value: String(dueToday), tone: dueToday ? 'accent' : 'mute' },
    { label: t('today.recovery.rail.overdue'), value: String(overdue), tone: overdue ? 'bad' : 'mute' },
    { label: t('today.recovery.rail.done'), value: String(done), tone: done ? 'ok' : 'mute' },
  ] as const;

  const TONE: Record<string, string> = {
    accent: colors.primary, ok: colors.success, warn: colors.warning, bad: colors.error, mute: colors.textGhost,
  };

  return (
    <View style={s.card}>
      <TexturedSurface source={TEXTURES.kintsugi} textureOpacity={0.09} overlayOnly />
      <EmbeddedFiligree source={DECOR.cornerKintsugiSeam} anchor="bottom-right" size={132} opacity={0.22} />
      <View style={s.head}>
        <Text style={s.title}>{t('today.recovery.rail.title')}</Text>
        <Ionicons name="moon-outline" size={16} color={colors.warning} />
      </View>
      {planned.length === 0 && done === 0 ? (
        <Text style={s.calm}>{t('today.recovery.rail.calm')}</Text>
      ) : (
        rows.map((r) => (
          <View key={r.label} style={s.row}>
            <Text style={s.rowLabel}>{r.label}</Text>
            <Text style={[s.rowValue, { color: TONE[r.tone] }]}>{r.value}</Text>
          </View>
        ))
      )}
      <TouchableOpacity onPress={onOpen} activeOpacity={0.8} style={s.action}>
        <Text style={s.actionText}>{t('today.recovery.rail.open')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: space.lg, overflow: 'hidden', position: 'relative',
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
