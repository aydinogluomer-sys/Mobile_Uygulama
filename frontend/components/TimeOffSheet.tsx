/**
 * R01.05 — "Ara ver" (one habit) and "Tatil modu" (every habit): a dated
 * break, with what it does to target, rate, streak and reminders spelled out
 * next to what a single-day skip does, so the user picks the right one.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { hexA, space, radius, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { TexturedSurface } from './ui';
import { TEXTURES } from '../lib/visualAssets';
import { addDaysLocal, parseLocalDate, ymd } from '../lib/date';
import { EXCUSE_EFFECTS, type PauseDraft, type PauseKind } from '../lib/habitPauses';

const STARTS = [
  { key: 'today', label: 'Bugün', offset: 0 },
  { key: 'tomorrow', label: 'Yarın', offset: 1 },
] as const;

/** Lengths in days; null = until resumed. */
const LENGTHS = [
  { key: '1w', label: '1 hafta', days: 7 },
  { key: '2w', label: '2 hafta', days: 14 },
  { key: '1m', label: '1 ay', days: 30 },
  { key: 'open', label: 'Ben açana kadar', days: null },
] as const;

/** The draft for a start offset and a length, from `today` (local YYYY-MM-DD). */
export function timeOffDraft(kind: PauseKind, today: string, startOffset: number, days: number | null): PauseDraft {
  const base = parseLocalDate(today) ?? new Date();
  const start = addDaysLocal(base, startOffset);
  return {
    kind,
    start_date: ymd(start),
    end_date: days === null ? null : ymd(addDaysLocal(start, days - 1)),
  };
}

interface Props {
  visible: boolean;
  kind: PauseKind;
  /** Habit name for a pause; omitted for a holiday. */
  habitName?: string;
  today: string;
  /** false while the server update (migration 028) is pending. */
  available: boolean;
  onClose: () => void;
  onConfirm: (draft: PauseDraft) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export default function TimeOffSheet({ visible, kind, habitName, today, available, onClose, onConfirm }: Props) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [prevVisible, setPrevVisible] = useState(visible);
  const [startIdx, setStartIdx] = useState(0);
  const [lenIdx, setLenIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (visible) {
      setStartIdx(0);
      setLenIdx(0);
      setError(null);
      setSaving(false);
    }
  }

  const fx = EXCUSE_EFFECTS[kind];
  const skip = EXCUSE_EFFECTS.skip;
  const draft = timeOffDraft(kind, today, STARTS[startIdx].offset, LENGTHS[lenIdx].days);

  async function confirm() {
    setSaving(true);
    const res = await onConfirm(draft);
    setSaving(false);
    if (!res.ok) setError(res.error);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <TexturedSurface source={TEXTURES.botanical} textureOpacity={0.05} overlayOnly />
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header">{fx.title}{habitName ? ` · ${habitName}` : ''}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ gap: 6 }}>
            <Text style={s.span}>{fx.span}</Text>

            <Text style={s.label}>BAŞLANGIÇ</Text>
            <View style={s.chips}>
              {STARTS.map((o, i) => (
                <TouchableOpacity key={o.key} style={[s.chip, i === startIdx && s.chipOn]} onPress={() => setStartIdx(i)}
                  accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: i === startIdx }}>
                  <Text style={[s.chipText, i === startIdx && s.chipTextOn]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>SÜRE</Text>
            <View style={s.chips}>
              {LENGTHS.map((o, i) => (
                <TouchableOpacity key={o.key} style={[s.chip, i === lenIdx && s.chipOn]} onPress={() => setLenIdx(i)}
                  accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: i === lenIdx }}>
                  <Text style={[s.chipText, i === lenIdx && s.chipTextOn]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.range}>
              {draft.start_date} → {draft.end_date ?? 'sen açana kadar'}
            </Text>

            <Text style={s.label}>NE DEĞİŞİR</Text>
            {[fx.target, fx.rate, fx.streak, fx.reminders].map((line) => (
              <Text key={line} style={s.effect}>• {line}</Text>
            ))}

            <Text style={s.label}>YALNIZ BİR GÜN İÇİNSE</Text>
            <Text style={s.effect}>{skip.span} {skip.rate} {skip.streak}</Text>

            {!available && (
              <Text style={s.pending} accessibilityRole="alert">
                Bu özellik sunucu güncellemesini bekliyor; şimdilik kaydedilemez. Tek günlük “atla” çalışıyor.
              </Text>
            )}
            {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}

            <TouchableOpacity
              style={[s.cta, (!available || saving) && s.ctaOff]}
              onPress={confirm}
              disabled={!available || saving}
              accessibilityRole="button"
              accessibilityLabel={`${fx.title} kaydet`}
              accessibilityState={{ disabled: !available || saving }}
            >
              <Text style={s.ctaText}>{saving ? 'Kaydediliyor…' : fx.title}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: hexA(colors.black, 0.55) },
  sheet: { maxHeight: '88%', backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, overflow: 'hidden', position: 'relative' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  span: { fontSize: 13, color: colors.textDim },
  label: { fontSize: 10, letterSpacing: 1, color: colors.textFaint, fontWeight: '700', marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  chipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  chipTextOn: { color: colors.text },
  range: { fontSize: 12, color: colors.textFaint, marginTop: 4 },
  effect: { fontSize: 13, color: colors.textDim, lineHeight: 19 },
  pending: { fontSize: 12, color: colors.warning, marginTop: space.md, lineHeight: 17 },
  error: { fontSize: 12, color: colors.error, marginTop: space.sm },
  cta: { marginTop: space.lg, alignItems: 'center', backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 14 },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
});
