import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { CAPSULE_COPY, type TimeCapsule } from '../../lib/timeCapsule';
import { font, space, type Palette } from '../../lib/tokens';
import Button from '../ui/Button';
import Card from '../ui/Card';

export type TimeCapsuleCardProps = {
  capsule: TimeCapsule;
  onRead: () => void;
  onLater: () => void;
};

export default function TimeCapsuleCard({
  capsule,
  onRead,
  onLater,
}: TimeCapsuleCardProps): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  return (
    <Card padding="lg">
      <View style={s.bodyWrap}>
        <Text style={s.title} accessibilityRole="header">
          {CAPSULE_COPY.cardTitle}
        </Text>
        <Text style={s.sub}>{CAPSULE_COPY.cardSub}</Text>
        <Text style={s.text}>{capsule.text}</Text>
        <View style={s.actions}>
          <Button
            label={CAPSULE_COPY.read}
            variant="tonal"
            size="sm"
            color={c.accent}
            onPress={onRead}
            accessibilityRole="button"
            accessibilityLabel={CAPSULE_COPY.read}
            style={s.btn}
          />
          <Button
            label={CAPSULE_COPY.later}
            variant="ghost"
            size="sm"
            color={c.textDim}
            onPress={onLater}
            accessibilityRole="button"
            accessibilityLabel={CAPSULE_COPY.later}
            style={s.btn}
          />
        </View>
      </View>
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bodyWrap: {
      gap: space.sm,
    },
    title: {
      ...font.h3,
      color: c.text,
    },
    sub: {
      ...font.caption,
      color: c.textDim,
    },
    text: {
      ...font.body,
      color: c.text,
      lineHeight: 22,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.xs,
    },
    btn: {
      minHeight: 44,
    },
  });
