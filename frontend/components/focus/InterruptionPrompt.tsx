import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useTimeoutRef } from '../../hooks/useTimeoutRef';
import { FLOW_COPY } from '../../lib/flowCopy';
import {
  AWAY_PROMPT_AUTO_DISMISS_MS,
  type InterruptionCause,
} from '../../lib/focusRitual';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { Chip } from '../ui';

export type InterruptionPromptProps = {
  visible: boolean;
  accent: string;
  onChoose: (cause: InterruptionCause | null) => void;
  autoDismissMs?: number;
};

export default function InterruptionPrompt({
  visible,
  accent,
  onChoose,
  autoDismissMs = AWAY_PROMPT_AUTO_DISMISS_MS,
}: InterruptionPromptProps): React.JSX.Element | null {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const timer = useTimeoutRef();
  const onChooseRef = useRef(onChoose);

  useEffect(() => {
    onChooseRef.current = onChoose;
  }, [onChoose]);

  useEffect(() => {
    if (!visible) {
      timer.clear();
      return;
    }
    timer.set(() => {
      onChooseRef.current(null);
    }, autoDismissMs);
    return () => timer.clear();
  }, [visible, autoDismissMs, timer]);

  if (!visible) return null;

  const choose = (cause: InterruptionCause | null) => {
    timer.clear();
    onChoose(cause);
  };

  return (
    <View style={[s.card, { borderColor: hexA(accent, 0.35) }]}>
      <Text style={s.ask} accessibilityLiveRegion="polite">
        {FLOW_COPY.interruptionAsk}
      </Text>
      <View style={s.chipsRow}>
        <Chip
          label={FLOW_COPY.interruptionNotification}
          color={accent}
          style={s.chip}
          onPress={() => choose('notification')}
        />
        <Chip
          label={FLOW_COPY.interruptionSomeone}
          color={accent}
          style={s.chip}
          onPress={() => choose('someone')}
        />
        <Chip
          label={FLOW_COPY.interruptionSelf}
          color={accent}
          style={s.chip}
          onPress={() => choose('self')}
        />
        <Chip
          label={FLOW_COPY.interruptionSkip}
          color={c.textDim}
          style={s.chip}
          onPress={() => choose(null)}
        />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: space.md,
      marginBottom: space.lg,
      gap: space.sm,
    },
    ask: {
      ...font.bodySm,
      color: c.text,
      fontWeight: '600',
    },
    chipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
    },
    chip: {
      minHeight: 44,
    },
  });
