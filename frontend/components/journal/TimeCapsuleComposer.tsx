import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useTimeCapsules } from '../../hooks/useTimeCapsules';
import { CAPSULE_COPY, CAPSULE_MAX_CHARS } from '../../lib/timeCapsule';
import { font, radius, space, type Palette } from '../../lib/tokens';
import Button from '../ui/Button';

export default function TimeCapsuleComposer(): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const caps = useTimeCapsules();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reopenedIds, setReopenedIds] = useState<ReadonlySet<string>>(() => new Set());

  async function handleSave() {
    const res = await caps.add(text);
    if (res.ok) {
      setText('');
      setFeedback(CAPSULE_COPY.saved);
      return;
    }
    if (res.reason === 'full') {
      setFeedback(CAPSULE_COPY.full);
      return;
    }
    if (res.reason === 'empty') {
      setFeedback('Önce kısa bir not yaz.');
      return;
    }
    if (res.reason === 'too_long') {
      setFeedback('Not en çok 280 karakter olabilir.');
      return;
    }
    setFeedback('Not kaydedilemedi, yeniden dene.');
  }

  function toggleReopen(id: string) {
    setReopenedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <View style={s.wrap}>
      <Button
        label={CAPSULE_COPY.composerTitle}
        icon={expanded ? 'chevron-up-outline' : 'mail-outline'}
        variant="ghost"
        size="sm"
        color={c.textDim}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={CAPSULE_COPY.composerTitle}
        accessibilityState={{ expanded }}
        style={s.toggleBtn}
      />

      {expanded && (
        <View style={s.panel}>
          <Text style={s.hint}>{CAPSULE_COPY.composerHint}</Text>
          {caps.waiting > 0 && <Text style={s.meta}>{CAPSULE_COPY.waiting(caps.waiting)}</Text>}

          <TextInput
            value={text}
            onChangeText={(next) => {
              setText(next);
              if (feedback) setFeedback(null);
            }}
            placeholder={CAPSULE_COPY.placeholder}
            placeholderTextColor={c.textFaint}
            maxLength={CAPSULE_MAX_CHARS}
            multiline
            textAlignVertical="top"
            accessibilityLabel={CAPSULE_COPY.composerTitle}
            style={s.input}
          />

          <View style={s.actions}>
            <Button
              label={CAPSULE_COPY.save}
              variant="tonal"
              size="sm"
              color={c.accent}
              onPress={() => {
                void handleSave();
              }}
              accessibilityRole="button"
              accessibilityLabel={CAPSULE_COPY.save}
              style={s.actionBtn}
            />
          </View>

          {feedback && <Text style={s.feedback}>{feedback}</Text>}

          {caps.items.length > 0 && (
            <View style={s.list}>
              {caps.items.map((item) => {
                const isOpened = Boolean(item.openedAt);
                const isShowingText = isOpened && reopenedIds.has(item.id);
                return (
                  <View key={item.id} style={s.itemBox}>
                    <View style={s.itemRow}>
                      <Text style={s.itemMeta}>
                        {item.day} · {isOpened ? 'Okundu' : 'Bekliyor'}
                      </Text>
                      <View style={s.itemBtns}>
                        {isOpened && (
                          <Button
                            label="Yeniden oku"
                            variant="ghost"
                            size="sm"
                            color={c.textDim}
                            onPress={() => toggleReopen(item.id)}
                            accessibilityRole="button"
                            accessibilityLabel="Yeniden oku"
                            style={s.itemBtn}
                          />
                        )}
                        <Button
                          label="Sil"
                          variant="ghost"
                          size="sm"
                          color={c.textFaint}
                          onPress={() => {
                            void caps.remove(item.id);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Notu sil"
                          style={s.itemBtn}
                        />
                      </View>
                    </View>
                    {isShowingText && <Text style={s.reopenedText}>{item.text}</Text>}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      marginBottom: space.lg,
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
    hint: {
      ...font.caption,
      color: c.textDim,
      lineHeight: 18,
    },
    meta: {
      ...font.caption,
      color: c.textFaint,
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
      minHeight: 68,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    actionBtn: {
      minHeight: 44,
    },
    feedback: {
      ...font.caption,
      color: c.textDim,
    },
    list: {
      gap: space.xs,
      marginTop: space.xs,
    },
    itemBox: {
      borderTopWidth: 1,
      borderTopColor: c.borderSubtle,
      paddingTop: space.xs,
      gap: space.xs,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: space.xs,
    },
    itemMeta: {
      ...font.caption,
      color: c.textFaint,
    },
    itemBtns: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    itemBtn: {
      minHeight: 44,
    },
    reopenedText: {
      ...font.bodySm,
      color: c.text,
      lineHeight: 20,
    },
  });
