/**
 * R01.04 — edit a habit's checklist steps: add, mark required/optional,
 * archive. Archiving (not deleting) keeps past days readable against the
 * steps they actually had.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { confirm } from '../lib/dialog';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { space, radius, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { FormError } from './ui/FormFeedback';
import { useHabitStore } from '../store/habitStore';
import { currentItems, MAX_ITEM_TITLE } from '../lib/habitChecklist';

export default function ChecklistEditor({ habitId }: { habitId: string }) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const { checklistItems, checklistAvailable, addChecklistItem, setChecklistItemRequired, archiveChecklistItem } =
    useHabitStore(
      useShallow((st) => ({
        checklistItems: st.checklistItems,
        checklistAvailable: st.checklistAvailable,
        addChecklistItem: st.addChecklistItem,
        setChecklistItemRequired: st.setChecklistItemRequired,
        archiveChecklistItem: st.archiveChecklistItem,
      })),
    );
  const [title, setTitle] = useState('');
  const [required, setRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const items = currentItems(checklistItems, habitId);

  if (checklistAvailable === false) {
    return (
      <Text style={s.pending}>
        Kontrol listesi sunucu güncellemesini bekliyor; şimdilik adım eklenemez.
      </Text>
    );
  }

  async function add() {
    const res = await addChecklistItem(habitId, title, required);
    if (!res.ok) { setError(res.error); return; }
    setTitle('');
    setError(null);
  }

  async function archive(id: string, name: string) {
    if (await confirm({ title: 'Adımı kaldır', message: `"${name}" bugünden sonra listede olmaz; geçmiş günler etkilenmez.`, confirmText: 'Kaldır' })) {
      const r = await archiveChecklistItem(id);
      if (!r.ok) setError(r.error);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      {items.length === 0 && <Text style={s.empty}>Henüz adım yok. Bu alışkanlığı oluşturan adımları ekleyebilirsin.</Text>}
      {items.map((it) => (
        <View key={it.id} style={s.row}>
          <Text style={s.itemTitle} numberOfLines={1}>{it.title}</Text>
          <TouchableOpacity
            onPress={async () => { const r = await setChecklistItemRequired(it.id, !it.required); if (!r.ok) setError(r.error); }}
            accessibilityRole="switch"
            accessibilityState={{ checked: it.required }}
            accessibilityLabel={`${it.title} zorunlu`}
          >
            <Text style={[s.tag, it.required && s.tagOn]}>{it.required ? 'zorunlu' : 'isteğe bağlı'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => archive(it.id, it.title)} accessibilityRole="button" accessibilityLabel={`${it.title} adımını kaldır`}>
            <Ionicons name="close-circle-outline" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        </View>
      ))}
      <View style={s.addRow}>
        <TextInput
          style={s.input}
          value={title}
          onChangeText={(t) => { setTitle(t); setError(null); }}
          placeholder="Yeni adım (ör. ısınma)"
          placeholderTextColor={colors.textFaint}
          maxLength={MAX_ITEM_TITLE}
          accessibilityLabel="Yeni adım"
        />
        <TouchableOpacity onPress={() => setRequired((r) => !r)} accessibilityRole="switch" accessibilityState={{ checked: required }} accessibilityLabel="Yeni adım zorunlu">
          <Text style={[s.tag, required && s.tagOn]}>{required ? 'zorunlu' : 'isteğe bağlı'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={add} disabled={!title.trim()} accessibilityRole="button" accessibilityLabel="Adımı ekle">
          <Ionicons name="add-circle" size={24} color={title.trim() ? colors.accent : colors.textGhost} />
        </TouchableOpacity>
      </View>
      <FormError message={error} />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    pending: { fontSize: 12, color: colors.warning, lineHeight: 17 },
    empty: { fontSize: 13, color: colors.textFaint },
    row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
    itemTitle: { flex: 1, fontSize: 14, color: colors.text },
    tag: { fontSize: 11, color: colors.textFaint, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
    tagOn: { color: colors.text, borderColor: colors.accent },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
    input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.sm, color: colors.text, fontSize: 14 },
  });
