/**
 * R03.03 — "Küçük başla": write the first concrete step of a piece of work,
 * choose a short length, start a focus session for it.
 *
 * The parent is shown, never edited. The sheet says out loud what the step
 * does NOT do: it does not complete or shrink the task.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius } from '../lib/tokens';
import { TexturedSurface } from './ui';
import { TEXTURES } from '../lib/visualAssets';
import { FLOW_COPY } from '../lib/flowCopy';
import {
  SMALL_STEP_MINUTES, MAX_STEP_TITLE, draftFor, stepPlaceholder, validateSmallStep,
  type SmallStepParent, type SmallStepDraft,
} from '../lib/smallStart';

interface Props {
  parent: SmallStepParent | null;
  onClose: () => void;
  /** Start the step. Returns false when it could not start (e.g. a session is already open). */
  onStart: (parent: SmallStepParent, draft: SmallStepDraft) => boolean;
}

export default function SmallStartSheet({ parent, onClose, onStart }: Props) {
  const [draft, setDraft] = useState<SmallStepDraft>({ title: '', minutes: 10 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (parent) { setDraft(draftFor(parent)); setError(null); }
  }, [parent]);

  if (!parent) return null;

  function handleStart() {
    if (!parent) return;
    const check = validateSmallStep(parent, draft);
    if (!check.ok) { setError(check.reason); return; }
    if (!onStart(parent, draft)) {
      setError('Devam eden bir odak oturumu var. Önce onu bitir ya da sıfırla.');
    }
  }

  const ready = draft.title.trim().length > 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <TexturedSurface source={TEXTURES.botanical} textureOpacity={0.05} overlayOnly />
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">Küçük başla</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <Text style={s.label}>ASIL İŞ</Text>
          <Text style={s.parent} numberOfLines={2}>{parent.title}</Text>

          <Text style={s.label}>İLK ADIM</Text>
          <TextInput
            style={s.input}
            value={draft.title}
            onChangeText={(t) => { setDraft((d) => ({ ...d, title: t })); setError(null); }}
            placeholder={stepPlaceholder(parent)}
            placeholderTextColor={colors.textFaint}
            maxLength={MAX_STEP_TITLE}
            autoFocus
            accessibilityLabel="İlk adım"
          />
          <Text style={s.hint}>{FLOW_COPY.firstStep}</Text>

          <Text style={s.label}>SÜRE</Text>
          <View style={s.chips}>
            {SMALL_STEP_MINUTES.map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.chip, draft.minutes === m && s.chipOn]}
                onPress={() => { setDraft((d) => ({ ...d, minutes: m })); setError(null); }}
                accessibilityRole="button"
                accessibilityLabel={`${m} dakika`}
                accessibilityState={{ selected: draft.minutes === m }}
              >
                <Text style={[s.chipText, draft.minutes === m && s.chipTextOn]}>{m} dk</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.note}>
            Bu adım asıl işi tamamlamaz ya da küçültmez; bittiğinde yalnız bu odak oturumu kaydedilir.
          </Text>

          {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}

          <TouchableOpacity
            style={[s.cta, !ready && s.ctaOff]}
            onPress={handleStart}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel={`${draft.minutes} dakika başlat`}
            accessibilityState={{ disabled: !ready }}
          >
            <Ionicons name="play" size={16} color={colors.bg} />
            <Text style={s.ctaText}>{draft.minutes} dk başlat</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: 6, overflow: 'hidden', position: 'relative' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 10, letterSpacing: 1, color: colors.textFaint, fontWeight: '700', marginTop: space.sm },
  parent: { fontSize: 14, color: colors.textDim },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, color: colors.text, fontSize: 15 },
  hint: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  chipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  chipTextOn: { color: colors.text },
  note: { fontSize: 12, color: colors.textDim, lineHeight: 17, marginTop: space.sm },
  error: { fontSize: 12, color: colors.error, marginTop: 4 },
  cta: { marginTop: space.md, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14 },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
});
