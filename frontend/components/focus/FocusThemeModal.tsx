import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/tokens';
import { FOCUS_PRESETS, OVERLAY_LEVELS } from '../../lib/focusThemes';

type Props = {
  visible: boolean;
  onClose: () => void;
  presetId: string;
  overlay: number;
  onSelectPreset: (id: string) => void;
  onSelectOverlay: (value: number) => void;
};

export default function FocusThemeModal({ visible, onClose, presetId, overlay, onSelectPreset, onSelectOverlay }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>Tema & Arka plan</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
            <Text style={s.sectionLabel}>ARKA PLAN</Text>
            <View style={s.grid}>
              {FOCUS_PRESETS.map((p) => {
                const active = presetId === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[s.cell, active && { borderColor: p.accent }]}
                    onPress={() => onSelectPreset(p.id)}
                  >
                    <View style={[s.swatch, { backgroundColor: p.bg }]}>
                      <View style={[s.swatchCard, { backgroundColor: p.cardBg }]} />
                      <View style={[s.swatchDot, { backgroundColor: p.accent }]} />
                      {active && (
                        <View style={[s.swatchCheck, { backgroundColor: p.accent }]}>
                          <Ionicons name="checkmark" size={11} color={colors.white} />
                        </View>
                      )}
                    </View>
                    <Text style={[s.cellLabel, active && { color: colors.text }]} numberOfLines={1}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.sectionLabel}>ZEMİN KOYULUĞU</Text>
            <View style={s.overlayRow}>
              {OVERLAY_LEVELS.map((lvl) => {
                const active = Math.abs(overlay - lvl.value) < 0.001;
                return (
                  <TouchableOpacity
                    key={lvl.label}
                    style={[s.overlayBtn, active && s.overlayBtnActive]}
                    onPress={() => onSelectOverlay(lvl.value)}
                  >
                    <Text style={[s.overlayBtnText, active && { color: colors.text }]}>{lvl.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity style={s.doneBtn} onPress={onClose}>
            <Text style={s.doneText}>Bitti</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.coolBlack800, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  title: { fontSize: 18, fontWeight: '700', color: colors.white },

  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.textFaint, letterSpacing: 1, marginBottom: 12, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  cell: { width: '30%', borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 6, gap: 6, alignItems: 'center' },
  swatch: { width: '100%', height: 54, borderRadius: 8, padding: 7, justifyContent: 'flex-end', position: 'relative', overflow: 'hidden' },
  swatchCard: { height: 18, borderRadius: 5, opacity: 0.9 },
  swatchDot: { position: 'absolute', top: 7, left: 7, width: 12, height: 12, borderRadius: 6 },
  swatchCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cellLabel: { fontSize: 11, color: colors.textFaint, fontWeight: '600' },

  overlayRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  overlayBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated },
  overlayBtnActive: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
  overlayBtnText: { fontSize: 12, fontWeight: '700', color: colors.textFaint },

  doneBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  doneText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
