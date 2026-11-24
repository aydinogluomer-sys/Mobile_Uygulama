import React, { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { FLOW_COPY } from '../../lib/flowCopy';
import {
  BREATH_CYCLE_MS,
  INTENT_MAX_LENGTH,
  normalizeIntent,
} from '../../lib/focusRitual';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';
import { Button, Chip, SheetModal } from '../ui';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

export type FocusIntentSheetProps = {
  visible: boolean;
  initialText?: string | null;
  accent: string;
  onSubmit: (text: string | null) => void;
  onSkip: () => void;
  onDisable: () => void;
};

export default function FocusIntentSheet({
  visible,
  initialText = null,
  accent,
  onSubmit,
  onSkip,
  onDisable,
}: FocusIntentSheetProps): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const [breathAnim] = useState(() => new Animated.Value(0));
  const [draft, setDraft] = useState('');
  const [prevVisible, setPrevVisible] = useState(visible);

  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (visible) {
      setDraft('');
    }
  }

  const animateBreath = visible && !IS_TEST && !reduceMotion;

  useEffect(() => {
    if (!animateBreath) {
      breathAnim.setValue(0);
      return;
    }
    const half = BREATH_CYCLE_MS / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, {
          toValue: 1,
          duration: half,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(breathAnim, {
          toValue: 0,
          duration: half,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animateBreath, breathAnim]);

  const handleStart = () => {
    onSubmit(normalizeIntent(draft));
  };

  return (
    <SheetModal
      visible={visible}
      onClose={onSkip}
      align="center"
      animationType="fade"
      accessibilityLabel={FLOW_COPY.intentAsk}
    >
      <View style={s.body}>
        <View style={s.breathWrap}>
          {!reduceMotion && !IS_TEST ? (
            <Animated.View
              pointerEvents="none"
              style={[
                s.breathRing,
                {
                  borderColor: hexA(accent, 0.55),
                  backgroundColor: hexA(accent, 0.12),
                  opacity: breathAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 0.85],
                  }),
                  transform: [
                    {
                      scale: breathAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.88, 1.14],
                      }),
                    },
                  ],
                },
              ]}
            />
          ) : null}
          <Text style={s.breathLabel}>{FLOW_COPY.intentBreath}</Text>
        </View>

        <Text style={s.title} accessibilityRole="header">
          {FLOW_COPY.intentAsk}
        </Text>
        <Text style={s.hint}>{FLOW_COPY.intentHint}</Text>

        <TextInput
          style={[s.input, { borderColor: hexA(accent, 0.45) }]}
          value={draft}
          onChangeText={setDraft}
          maxLength={INTENT_MAX_LENGTH}
          returnKeyType="done"
          onSubmitEditing={handleStart}
          placeholder={FLOW_COPY.intentHint}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={FLOW_COPY.intentAsk}
        />

        {initialText ? (
          <View style={s.lastRow}>
            <Chip
              label={`Geçen sefer: ${initialText}`}
              icon="time-outline"
              color={accent}
              onPress={() => setDraft(initialText)}
              accessibilityLabel={`Geçen seferki niyeti doldur: ${initialText}`}
            />
          </View>
        ) : null}

        <View style={s.actions}>
          <Button
            label="Başla"
            variant="primary"
            color={accent}
            onPress={handleStart}
            full
          />
          <Button
            label="Atla"
            variant="secondary"
            color={accent}
            onPress={onSkip}
            full
          />
          <Button
            label="Bir daha sorma"
            variant="ghost"
            color={c.textDim}
            onPress={onDisable}
            full
          />
        </View>
      </View>
    </SheetModal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      gap: space.md,
    },
    breathWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: space.sm,
      gap: space.sm,
    },
    breathRing: {
      width: 64,
      height: 64,
      borderRadius: radius.full,
      borderWidth: 1.5,
    },
    breathLabel: {
      ...font.caption,
      color: c.textDim,
      textAlign: 'center',
    },
    title: {
      ...font.h2,
      color: c.text,
    },
    hint: {
      ...font.bodySm,
      color: c.textFaint,
    },
    input: {
      ...font.body,
      backgroundColor: c.bgElevated,
      color: c.text,
      borderRadius: radius.md,
      borderWidth: 1,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
    },
    lastRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    actions: {
      gap: space.sm,
      marginTop: space.xs,
    },
  });
