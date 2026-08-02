import { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Habit } from '../lib/supabase';

interface Props {
  visible: boolean;
  habit: Habit | null;
  currentValue: number;
  onClose: () => void;
  onConfirm: (value: number) => void;
}

export default function MeasurableInputModal({ visible, habit, currentValue, onClose, onConfirm }: Props) {
  const [input, setInput] = useState('');

  if (!habit) return null;

  const remaining = Math.max(0, (habit.daily_goal ?? 0) - currentValue);
  const pct = habit.daily_goal ? Math.min(100, Math.round((currentValue / habit.daily_goal) * 100)) : 0;

  function handleConfirm() {
    const val = parseFloat(input);
    if (!isNaN(val) && val > 0) {
      onConfirm(val);
      setInput('');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name={(habit.icon ?? 'star-outline') as any} size={22} color={habit.color ?? '#D97757'} />
            <Text style={styles.title} numberOfLines={1}>{habit.name}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color="#BFBBAE" />
            </TouchableOpacity>
          </View>

          <View style={styles.progress}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: habit.color ?? '#D97757' }]} />
            </View>
            <Text style={styles.progressText}>{pct}%</Text>
          </View>

          <Text style={styles.remaining}>
            {remaining > 0
              ? `${remaining} ${habit.unit ?? ''} kaldı`
              : `Hedef tamamlandı!`}
          </Text>

          <Text style={styles.label}>Ne kadar ekleyelim? ({habit.unit})</Text>
          <TextInput
            style={styles.input}
            placeholder={`Örn: ${Math.ceil(remaining / 2)}`}
            placeholderTextColor="#827E72"
            keyboardType="numeric"
            value={input}
            onChangeText={setInput}
            autoFocus
          />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>İptal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: habit.color ?? '#D97757' }]}
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
    backgroundColor: '#1D1C17', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 36,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: '#fff' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  progressTrack: { flex: 1, height: 6, backgroundColor: '#383528', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: 12, color: '#BFBBAE', width: 36, textAlign: 'right' },
  remaining: { fontSize: 13, color: '#BFBBAE', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 10 },
  input: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14, fontSize: 16,
    color: '#fff', borderWidth: 1, borderColor: '#383528', marginBottom: 20,
  },
  actions: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, backgroundColor: '#383528', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelText: { fontSize: 15, color: '#BFBBAE', fontWeight: '600' },
  confirmBtn: {
    flex: 2, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
