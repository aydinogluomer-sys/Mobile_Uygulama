import type React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

export type SheetModalProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: 'bottom' | 'center';
  animationType?: 'slide' | 'fade' | 'none';
  backdropColor?: string;
  maxHeightPct?: number;
  sheetStyle?: StyleProp<ViewStyle>;
  closeOnBackdrop?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

export function sheetMaxHeight(windowHeight: number, pct: number): number {
  const clamped = Math.min(1, Math.max(0.3, pct));
  return Math.floor(windowHeight * clamped);
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    avoid: {
      flex: 1,
    },
    avoidBottom: {
      justifyContent: 'flex-end',
    },
    avoidCenter: {
      justifyContent: 'center',
      padding: space.xxl,
    },
    scrim: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    sheetBottom: {
      width: '100%',
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.xl,
    },
    sheetCenter: {
      width: '100%',
      backgroundColor: c.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.xl,
    },
  });

export default function SheetModal({
  visible,
  onClose,
  children,
  align = 'bottom',
  animationType,
  backdropColor,
  maxHeightPct = 0.9,
  sheetStyle,
  closeOnBackdrop = true,
  accessibilityLabel,
  testID,
}: SheetModalProps): React.JSX.Element {
  const { height: windowHeight } = useWindowDimensions();
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();

  if (!visible) {
    return <></>;
  }

  const fallbackAnim = align === 'center' ? 'fade' : 'slide';
  const resolvedAnim = reduceMotion ? 'none' : (animationType ?? fallbackAnim);

  return (
    <Modal
      testID={testID}
      visible={visible}
      transparent
      statusBarTranslucent
      animationType={resolvedAnim}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[s.avoid, align === 'center' ? s.avoidCenter : s.avoidBottom]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={[s.scrim, { backgroundColor: backdropColor ?? hexA(c.black, 0.7) }]}
          accessible={false}
          focusable={false}
          onPress={closeOnBackdrop ? onClose : undefined}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
          style={[
            align === 'center' ? s.sheetCenter : s.sheetBottom,
            { maxHeight: sheetMaxHeight(windowHeight, maxHeightPct) },
            sheetStyle,
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
