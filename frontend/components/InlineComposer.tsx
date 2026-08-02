import { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius, font } from '../lib/tokens';
import { haptic } from '../lib/haptics';

type Props = {
  placeholder?: string;
  /** başlığı alır; başarılıysa alan temizlenir. */
  onSubmit: (title: string) => void | Promise<void>;
};

/** Modalsız tek-satır hızlı ekleyici — Enter veya + ile gönderir. Atlas inline-composer deseni. */
export default function InlineComposer({ placeholder = 'Hızlı görev ekle…', onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const t = value.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSubmit(t);
      setValue('');
      haptic.light();
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = value.trim().length > 0;

  return (
    <View style={s.row}>
      <Ionicons name="add-outline" size={18} color={colors.textFaint} />
      <TextInput
        style={s.input}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        returnKeyType="done"
        onSubmitEditing={submit}
        blurOnSubmit={false}
      />
      {canSubmit && (
        <TouchableOpacity onPress={submit} disabled={busy} style={s.addBtn} activeOpacity={0.8}>
          <Ionicons name="arrow-up" size={16} color={colors.white} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  input: { flex: 1, ...font.body, color: colors.text, padding: 0 },
  addBtn: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
});
