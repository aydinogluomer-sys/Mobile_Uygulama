import { colors } from '../lib/tokens';
import { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Habit } from '../lib/supabase';
// R01.03-a: the same add the screen's write uses, so the preview cannot disagree with what is saved.
import { dayTotalAfterEntry } from '../services/habitLogService';

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

export default function MeasurableInputModal({ visible, habit, currentValue, dayLabel, onClose, onConfirm }: Props) {
  const [input, setInput] = useState('');

  if (!habit) return null;

  const ceiling = habit.target_direction === 'at_most';
  const goal = habit.daily_goal ?? 0;
  const remaining = Math.max(0, goal - currentValue);
  const pct = goal ? Math.min(100, Math.round((currentValue / goal) * 100)) : 0;
  const unit = habit.unit ?? '';
  // R01.03-a: the number typed here is ADDED to today's total; the total is
  // what gets saved. For a ceiling ("en çok 2"), 0 is a meaningful entry -- a
  // clean day -- so it is accepted; for a floor it would change nothing.
  const parsed = parseFloat(input.replace(',', '.'));
  const valid = !isNaN(parsed) && (ceiling ? parsed >= 0 : parsed > 0);
  const totalAfter = valid ? dayTotalAfterEntry(currentValue, parsed) : null;

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name={(habit.icon ?? 'star-outline') as any} size={22} color={habit.color ?? colors.accent} />
            <Text style={styles.title} numberOfLines={1}>{habit.name}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textDim} />
            </TouchableOpacity>
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
          <TextInput
            style={styles.input}
            placeholder={ceiling ? 'Örn: 1 (hiç yoksa 0)' : `Örn: ${Math.ceil(remaining / 2)}`}
            placeholderTextColor={colors.textFaint}
            keyboardType="numeric"
            value={input}
            onChangeText={setInput}
            accessibilityLabel={dayLabel
              ? `${dayLabel} eklenecek miktar, ${unit}. O günkü toplam ${currentValue}.`
              : `Bugüne eklenecek miktar, ${unit}. Bugünkü toplam ${currentValue}.`}
            autoFocus
          />
          <Text style={styles.remaining} accessibilityLiveRegion="polite">
            {dayLabel
              ? totalAfter !== null
                ? `Girdiğin sayı o günkü toplama eklenir. Kaydedince o gün: ${totalAfter} ${unit}`
                : 'Girdiğin sayı o günkü toplama eklenir; kaydedilen, günün toplamıdır.'
              : totalAfter !== null
                ? `Girdiğin sayı bugünkü toplama eklenir. Kaydedince bugün: ${totalAfter} ${unit}`
                : 'Girdiğin sayı bugünkü toplama eklenir; kaydedilen, günün toplamıdır.'}
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>İptal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: habit.color ?? colors.accent }]}
              onPress={handleConfirm}
            >
              <Text style={styles.confirmText}>Kaydet</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.white },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  progressTrack: { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: 12, color: colors.textDim, width: 36, textAlign: 'right' },
  remaining: { fontSize: 13, color: colors.textDim, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: colors.white, marginBottom: 10 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 16,
    color: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 20,
  },
  actions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, backgroundColor: colors.border, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelText: { fontSize: 15, color: colors.textDim, fontWeight: '600' },
  confirmBtn: {
    flex: 2, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  confirmText: { fontSize: 15, color: colors.white, fontWeight: '700' },
});
