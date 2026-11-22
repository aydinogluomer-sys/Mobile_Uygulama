import type { ComponentProps, ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, hexA, radius, space } from '../../lib/tokens';
import { DIALOG_DEFAULT_CANCEL } from '../../lib/dialog';

export type ActionSheetItem = {
  id: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
};

export type ActionSheetProps = {
  visible: boolean;
  title?: string;
  message?: string;
  items: readonly ActionSheetItem[];
  /** Default 'Vazgeç'. Always rendered last, separated from the list. */
  cancelLabel?: string;
  /** DialogHost passes useReducedMotion(); true -> animationType 'none'. Default false -> 'slide'. */
  reduceMotion?: boolean;
  onSelect: (id: string) => void;
  onCancel: () => void;
};

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function isIoniconName(name: string): name is IoniconName {
  const glyphMap: unknown = Ionicons.glyphMap;
  return !glyphMap || typeof glyphMap !== 'object' || name in glyphMap;
}

export default function ActionSheet({
  visible,
  title,
  message,
  items,
  cancelLabel = DIALOG_DEFAULT_CANCEL,
  reduceMotion = false,
  onSelect,
  onCancel,
}: ActionSheetProps): ReactElement | null {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onCancel}
    >
      <View style={s.backdropWrap}>
        <Pressable
          style={s.scrim}
          focusable={false}
          accessible={false}
          onPress={onCancel}
        />
        <View
          style={[s.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
          accessibilityViewIsModal
        >
          {(title || message) ? (
            <View style={s.header}>
              {title ? (
                <Text style={s.title} accessibilityRole="header">
                  {title}
                </Text>
              ) : null}
              {message ? <Text style={s.message}>{message}</Text> : null}
            </View>
          ) : null}

          <ScrollView style={s.list} bounces={false}>
            {items.map((item) => {
              const isDisabled = item.disabled === true;
              const isDestructive = item.destructive === true;
              const fg = isDisabled
                ? colors.textGhost
                : isDestructive
                  ? colors.error
                  : colors.text;

              return (
                <TouchableOpacity
                  key={item.id}
                  style={s.row}
                  activeOpacity={0.75}
                  disabled={isDisabled}
                  onPress={() => {
                    if (!isDisabled) onSelect(item.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ disabled: isDisabled }}
                >
                  {item.icon && isIoniconName(item.icon) ? (
                    <Ionicons
                      name={item.icon}
                      size={20}
                      color={fg}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                  ) : null}
                  <Text style={[s.rowLabel, { color: fg }]}>{item.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={s.cancelDivider}>
            <TouchableOpacity
              style={s.cancelRow}
              activeOpacity={0.75}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text style={s.cancelLabel}>{cancelLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdropWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: hexA(colors.black, 0.55),
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '80%',
    alignSelf: 'center',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: space.md,
  },
  header: {
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: space.xs,
  },
  title: {
    ...font.h3,
    color: colors.text,
  },
  message: {
    ...font.bodySm,
    color: colors.textDim,
    lineHeight: 19,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  rowLabel: {
    ...font.body,
    flex: 1,
  },
  cancelDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    marginTop: space.xs,
  },
  cancelRow: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  cancelLabel: {
    ...font.body,
    fontWeight: '600',
    color: colors.textDim,
  },
});
