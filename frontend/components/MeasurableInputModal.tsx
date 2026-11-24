import { useState, type ComponentProps } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { font, hexA, radius, space, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import type { Habit } from '../lib/supabase';
import { scheduleKind } from '../lib/habitSchedule';
// R01.03-a: the same add the screen's write uses, so the preview cannot disagree with what is saved.
import { dayTotalAfterEntry } from '../services/habitLogService';
import { isNumberInputPending, parseLocaleNumberOrNaN } from '../lib/localeNumber';
import { Button, IconButton } from './ui';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';

interface Props {
  visible: boolean;
  habit: Habit | null;
  /** The day's total so far (the row's `value`, 0 if none) -- NOT clamped at the goal. */
  currentValue: number;
  /**
   * KD-12 — the day the entry lands on, when it is NOT today. Recovery opens
   * this modal for a past day; saying "bugün" there would tell the user the
   * wrong thing about their own data. A phrase that reads before "ne kadar
   * ekleyelim?", e.g. "5 Ağustos gününe". Omitted = today, and today's copy is
   * left exactly as it was.
   */
  dayLabel?: string;
  onClose: () => void;
  onConfirm: (value: number) => void;
}

export function buildMeasurableTypeHint(habit: Habit): string {
  const ceiling = habit.target_direction === 'at_most';
  const goal = habit.daily_goal ?? 0;
  const unit = habit.unit?.trim() || '';

  let typeExample: string;
  if (ceiling) {
    typeExample = `En çok ${goal} · hiç olmadıysa 0 yazabilirsin`;
  } else if (habit.tracking_type === 'duration') {
    typeExample = `Örnek: 15 ${unit || 'dk'}`;
  } else {
    typeExample = `Örnek: 1,5 ${unit || 'L'} veya 0,5`;
  }

  const sk = scheduleKind(habit);
  const rawKind = (habit.frequency_config as { kind?: string; count?: number } | undefined)?.kind;
  const rawCount = habit.frequency_config?.count;

  if (sk.kind === 'weekly_count' && sk.count > 0) {
    return `${typeExample} · Dönem hedefi: haftada ${sk.count} kez — bu kayıt hedef ayarını değiştirmez, yalnız bu günün ilerlemesini ekler`;
  }
  if (rawKind === 'weekly_count' && typeof rawCount === 'number' && rawCount > 0) {
    return `${typeExample} · Dönem hedefi: haftada ${Math.floor(rawCount)} kez — bu kayıt hedef ayarını değiştirmez, yalnız bu günün ilerlemesini ekler`;
  }
  if (sk.kind === 'monthly_count' && sk.count > 0) {
    return `${typeExample} · Dönem hedefi: ayda ${sk.count} kez — bu kayıt hedef ayarını değiştirmez, yalnız bu günün ilerlemesini ekler`;
  }
  return typeExample;
}

export function buildMeasurablePresaveImpact(
  ceiling: boolean,
  goal: number,
  totalAfter: number,
): string {
  if (ceiling) {
    if (totalAfter <= goal) {
      return 'Hedefe ulaşıyor · seri korunur ve tamamlanma puanı işlenir';
    }
    return 'Günlük sınır aşılıyor · hedef ayarın değişmez';
  }
  if (goal > 0 && totalAfter >= goal) {
    return 'Hedefe ulaşıyor · seri korunur ve tamamlanma puanı işlenir';
  }
  const afterPct = goal > 0 ? Math.min(100, Math.round((totalAfter / goal) * 100)) : 0;
  return `Kısmi ilerleme olarak kaydedilir (${afterPct}%) · hedef ayarın değişmez`;
}

export default function MeasurableInputModal({ visible, habit, currentValue, dayLabel, onClose, onConfirm }: Props) {
  const colors = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(true);

  if (!habit) return null;

  const ceiling = habit.target_direction === 'at_most';
  const goal = habit.daily_goal ?? 0;
  const remaining = Math.max(0, goal - currentValue);
  const pct = goal ? Math.min(100, Math.round((currentValue / goal) * 100)) : 0;
  const unit = habit.unit ?? '';
  // R01.03-a: the number typed here is ADDED to today's total; the total is
  // what gets saved. For a ceiling ("en çok 2"), 0 is a meaningful entry -- a
  // clean day -- so it is accepted; for a floor it would change nothing.
  const parsed = parseLocaleNumberOrNaN(input);
  const valid = !isNaN(parsed) && (ceiling ? parsed >= 0 : parsed > 0);
  const totalAfter = valid ? dayTotalAfterEntry(currentValue, parsed) : null;
  const showFormatHint = focused && !isNumberInputPending(input) && isNaN(parsed);
  const typeHint = buildMeasurableTypeHint(habit);
  const presaveImpact =
    totalAfter !== null ? buildMeasurablePresaveImpact(ceiling, goal, totalAfter) : null;

  function handleConfirm() {
    if (valid) {
      onConfirm(parsed);
      setInput('');
    }
  }

  const statusLine = ceiling
    ? currentValue > goal
      ? `Sınır aşıldı: bugün ${currentValue} ${unit} (en çok ${goal})`
      : `Bugün ${currentValue} ${unit} · sınıra ${remaining} ${unit} kaldı`
    : remaining > 0
      ? `Bugün ${currentValue} ${unit} · ${remaining} ${unit} kaldı`
      : `Hedef tamamlandı! (bugün ${currentValue} ${unit})`;
  // KD-12 — the same four lines for a past day. Kept separate so today's
  // wording above stays byte-for-byte what it was.
  const pastStatusLine = ceiling
    ? currentValue > goal
      ? `Sınır aşıldı: o gün ${currentValue} ${unit} (en çok ${goal})`
      : `O gün ${currentValue} ${unit} · sınıra ${remaining} ${unit} kaldı`
    : remaining > 0
      ? `O gün ${currentValue} ${unit} · ${remaining} ${unit} kaldı`
      : `Hedef tamamlandı! (o gün ${currentValue} ${unit})`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons
              name={(habit.icon ?? 'star-outline') as ComponentProps<typeof Ionicons>['name']}
              size={22}
              color={habit.color ?? colors.accent}
            />
            <Text style={styles.title} numberOfLines={1}>{habit.name}</Text>
            <IconButton
              icon="close"
              label="Kapat"
              size={22}
              color={colors.textDim}
              compact
              onPress={onClose}
            />
          </View>

          <View style={styles.progress}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: habit.color ?? colors.accent }]} />
            </View>
            <Text style={styles.progressText}>{pct}%</Text>
          </View>

          <Text style={styles.remaining}>{dayLabel ? pastStatusLine : statusLine}</Text>

          {dayLabel
            ? <Text style={styles.label}>{dayLabel} ne kadar ekleyelim? ({unit})</Text>
            : <Text style={styles.label}>Bugüne ne kadar ekleyelim? ({unit})</Text>}
          <Text testID="measurable-type-hint" style={styles.typeHint}>
            {typeHint}
          </Text>
          <TextInput
            testID="measurable-amount-input"
            style={styles.input}
            placeholder={ceiling ? 'Örn: 1 (hiç yoksa 0)' : `Örn: ${Math.ceil(remaining / 2)}`}
            placeholderTextColor={colors.textFaint}
            keyboardType="numeric"
            value={input}
            onChangeText={setInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel={dayLabel
              ? `${dayLabel} eklenecek miktar, ${unit}. O günkü toplam ${currentValue}.`
              : `Bugüne eklenecek miktar, ${unit}. Bugünkü toplam ${currentValue}.`}
            autoFocus
          />
          {showFormatHint && (
            <Text style={styles.hintWarning} accessibilityLiveRegion="polite">
              Sayıyı rakamla yaz, örn. 2,5
            </Text>
          )}
          <Text style={styles.remaining} accessibilityLiveRegion="polite">
            {dayLabel
              ? totalAfter !== null
                ? `Girdiğin sayı o günkü toplama eklenir. Kaydedince o gün: ${totalAfter} ${unit}`
                : 'Girdiğin sayı o günkü toplama eklenir; kaydedilen, günün toplamıdır.'
              : totalAfter !== null
                ? `Girdiğin sayı bugünkü toplama eklenir. Kaydedince bugün: ${totalAfter} ${unit}`
                : 'Girdiğin sayı bugünkü toplama eklenir; kaydedilen, günün toplamıdır.'}
          </Text>
          {presaveImpact !== null && (
            <Text
              testID="measurable-presave-impact"
              style={styles.impactPreview}
              accessibilityLiveRegion="polite"
            >
              {presaveImpact}
            </Text>
          )}

          <View style={styles.actions}>
            <Button
              label="İptal"
              variant="secondary"
              color={colors.textDim}
              onPress={onClose}
              testID="measurable-cancel-btn"
              style={styles.cancelBtn}
            />
            <Button
              label="Kaydet"
              variant="primary"
              onPress={handleConfirm}
              testID="measurable-confirm-btn"
              style={styles.confirmBtn}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    overlay: { flex: 1, backgroundColor: hexA(colors.black, 0.85), justifyContent: 'flex-end' },
    card: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      padding: space.xxl,
      paddingBottom: space.hh,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg },
    title: { flex: 1, ...font.h3, color: colors.text },
    progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
    progressTrack: {
      flex: 1,
      height: 6,
      backgroundColor: colors.border,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: radius.pill },
    progressText: { ...font.caption, color: colors.textDim, width: 36, textAlign: 'right' },
    remaining: { ...font.bodySm, color: colors.textDim, marginBottom: space.md },
    label: { ...font.body, fontWeight: '600', color: colors.text, marginBottom: space.xs },
    typeHint: { ...font.caption, color: colors.textFaint, marginBottom: space.sm },
    input: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: space.md,
      ...font.h3,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: space.md,
    },
    hintWarning: {
      ...font.caption,
      color: colors.warning,
      marginBottom: space.sm,
    },
    impactPreview: {
      ...font.caption,
      color: colors.accent,
      marginBottom: space.lg,
    },
    actions: { flexDirection: 'row', gap: space.md },
    cancelBtn: { flex: 1 },
    confirmBtn: { flex: 2 },
  });
