import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import {
  REFLECTION_DISCLAIMER,
  REFLECTION_FIELDS,
  REFLECTION_FIELD_MAX,
  emptyReflection,
  formatReflection,
  hasReflectionText,
  type ReflectionDraft,
} from '../../lib/reflectionTemplate';
import { font, radius, space, type Palette } from '../../lib/tokens';
import Button from '../ui/Button';

export type ReflectionTemplateProps = {
  onInsert: (text: string) => void;
};

export default function ReflectionTemplate({ onInsert }: ReflectionTemplateProps): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<ReflectionDraft>(() => emptyReflection());

  const canInsert = hasReflectionText(draft);

  function handleInsert() {
    if (!canInsert) return;
    const formatted = formatReflection(draft);
    if (!formatted) return;
    onInsert(formatted);
    setDraft(emptyReflection());
    setExpanded(false);
  }

  return (
    <View style={s.wrap}>
      <Button
        label="Yansıtma şablonu"
        icon={expanded ? 'chevron-up-outline' : 'create-outline'}
        variant="ghost"
        size="sm"
        color={c.textDim}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Yansıtma şablonu"
        accessibilityState={{ expanded }}
        style={s.toggleBtn}
      />

      {expanded && (
        <View style={s.panel}>
          {REFLECTION_FIELDS.map((field) => (
            <View key={field.key} style={s.fieldBlock}>
              <Text style={s.label}>{field.label}</Text>
              <TextInput
                value={draft[field.key]}
                onChangeText={(text) =>
                  setDraft((prev) => ({
                    ...prev,
                    [field.key]: text,
                  }))
                }
                placeholder={field.placeholder}
                placeholderTextColor={c.textFaint}
                maxLength={REFLECTION_FIELD_MAX}
                multiline
                textAlignVertical="top"
                accessibilityLabel={field.label}
                style={s.input}
              />
            </View>
          ))}

          <Text style={s.disclaimer}>{REFLECTION_DISCLAIMER}</Text>

          <View style={s.actions}>
            <Button
              label="Günlüğe ekle"
              variant="primary"
              size="sm"
              disabled={!canInsert}
              onPress={handleInsert}
              accessibilityRole="button"
              accessibilityLabel="Günlüğe ekle"
              accessibilityState={{ disabled: !canInsert }}
              style={s.actionBtn}
            />
            <Button
              label="Kapat"
              variant="ghost"
              size="sm"
              color={c.textDim}
              onPress={() => setExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              style={s.actionBtn}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      marginBottom: space.md,
      gap: space.sm,
    },
    toggleBtn: {
      alignSelf: 'flex-start',
      minHeight: 44,
    },
    panel: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: space.md,
      gap: space.sm,
    },
    fieldBlock: {
      gap: space.xs,
    },
    label: {
      ...font.caption,
      color: c.textDim,
      fontWeight: '600',
    },
    input: {
      ...font.bodySm,
      color: c.text,
      backgroundColor: c.bgElevated,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.sm,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      minHeight: 56,
    },
    disclaimer: {
      ...font.caption,
      color: c.textFaint,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.xs,
    },
    actionBtn: {
      minHeight: 44,
    },
  });
