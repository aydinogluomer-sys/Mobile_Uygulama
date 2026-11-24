import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import {
  timeA11yLabel,
  timeCaption,
  type TimeBucketKey,
  type TimeDistribution,
} from '../../lib/timeDistribution';
import { font, radius, space, type Palette } from '../../lib/tokens';

export type TimeDistributionBarProps = {
  distribution: TimeDistribution;
  weekLabel: 'Bu hafta' | 'O hafta';
};

const UNKNOWN_NOTE: Readonly<Record<TimeBucketKey, string>> = {
  focus: 'Odak süresi okunamadı.',
  routine: 'Rutin süresi okunamadı.',
  habit: 'Alışkanlık süresi okunamadı.',
};

function bucketColor(c: Palette, key: TimeBucketKey): string {
  if (key === 'focus') return c.primary;
  if (key === 'routine') return c.accent;
  return c.info;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.md,
      gap: space.sm,
    },
    title: {
      ...font.h3,
      color: c.text,
    },
    caption: {
      ...font.bodySm,
      color: c.textDim,
    },
    barTrack: {
      flexDirection: 'row',
      height: 12,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: c.surfaceAlt,
      gap: space.xs,
    },
    barSegment: {
      minWidth: space.xs,
      borderRadius: radius.xs,
    },
    rowsWrap: {
      gap: space.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    swatch: {
      width: 10,
      height: 10,
      borderRadius: radius.xs,
    },
    rowText: {
      ...font.caption,
      color: c.textDim,
      flex: 1,
    },
    rowTextTop: {
      color: c.text,
      fontWeight: '700',
    },
    note: {
      ...font.caption,
      color: c.textFaint,
    },
  });

export default function TimeDistributionBar({
  distribution,
  weekLabel,
}: TimeDistributionBarProps): JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const hasSegments = distribution.segments.length > 0;

  return (
    <View style={s.card}>
      <Text style={s.title} accessibilityRole="header">
        Zaman nereye gitti
      </Text>
      <Text style={s.caption}>{timeCaption(distribution, weekLabel)}</Text>

      {hasSegments && (
        <>
          <View
            testID="time-distribution-bar"
            accessible
            accessibilityRole="image"
            accessibilityLabel={timeA11yLabel(distribution, weekLabel)}
            style={s.barTrack}
          >
            {distribution.segments.map((seg) => (
              <View
                key={seg.key}
                testID={`time-segment-${seg.key}`}
                style={[
                  s.barSegment,
                  {
                    flexGrow: seg.minutes,
                    backgroundColor: bucketColor(c, seg.key),
                  },
                ]}
              />
            ))}
          </View>

          <View style={s.rowsWrap}>
            {distribution.segments.map((seg) => {
              const isTop = distribution.top === seg.key;
              return (
                <View key={seg.key} style={s.row}>
                  <View style={[s.swatch, { backgroundColor: bucketColor(c, seg.key) }]} />
                  <Text style={[s.rowText, isTop && s.rowTextTop]}>
                    {`${seg.label} · ${seg.minutes} dk · %${seg.share}`}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {distribution.unknown.map((uk) => (
        <Text key={uk} style={s.note}>
          {UNKNOWN_NOTE[uk]}
        </Text>
      ))}

      {distribution.excludedHabits > 0 && (
        <Text style={s.note}>
          {`${distribution.excludedHabits} süre tipli alışkanlık birimi tanınmadığı için hariç.`}
        </Text>
      )}

      {hasSegments && (
        <Text style={s.note}>Süreler kayıtlı olduğu kaynağa göre toplanır.</Text>
      )}
    </View>
  );
}
