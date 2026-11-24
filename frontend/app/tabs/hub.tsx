import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { space, radius, font, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { haptic } from '../../lib/haptics';
import type { HubCategory } from '../../lib/destinations';
import AIRoutineModal from '../../components/AIRoutineModal';
import FocusFlowView from '../../components/FocusFlowView';
import ExploreView from '../../components/hub/ExploreView';
import ToolsView from '../../components/hub/ToolsView';
import { AtmosphericScreenCanvas } from '../../components/spatial';
import { CANVASES, TEXTURES } from '../../lib/visualAssets';

export type HubMode = 'flow' | 'explore' | 'tools';

export default function HubScreen() {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [mode, setMode] = useState<HubMode>('flow');
  const [selectedToolCat, setSelectedToolCat] = useState<HubCategory | 'all'>('all');
  const [aiModalVisible, setAiModalVisible] = useState(false);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.todaySanctuary}
        textureSource={TEXTURES.clay}
        scrim={0.66}
        tintColor={c.primary}
      />
      <View style={s.topChrome}>
        <View style={s.titleRow}>
          <View style={s.flex1}>
            <Text style={s.pageTitle}>Keşfet</Text>
            <Text style={s.pageSub}>
              {mode === 'flow'
                ? 'Kısa odak mikro-dersleri, tek tek'
                : mode === 'explore'
                  ? 'Hazır rutin koleksiyonları ve tek dokunuşla mikro alışkanlıklar'
                  : 'Tüm sistem modüllerine ve araçlara tek noktadan ulaşın'}
            </Text>
          </View>
          <TouchableOpacity
            style={s.aiQuickBtn}
            onPress={() => {
              haptic.select();
              setAiModalVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="AI Rutin Tasarımcısını Aç"
          >
            <Ionicons name="sparkles" size={14} color={c.white} />
            <Text style={s.aiQuickBtnText}>AI Rutin</Text>
          </TouchableOpacity>
        </View>

        <View style={s.modeBar}>
          <TouchableOpacity
            style={[s.modeTab, mode === 'flow' && s.modeTabActive]}
            onPress={() => {
              haptic.select();
              setMode('flow');
            }}
            accessibilityRole="button"
            accessibilityLabel="Odak Akışı (Flow)"
            accessibilityState={{ selected: mode === 'flow' }}
          >
            <Ionicons name="flame" size={14} color={mode === 'flow' ? c.white : c.primary} />
            <Text style={[s.modeTabText, mode === 'flow' && s.modeTabTextActive]}>
              Odak Akışı
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modeTab, mode === 'explore' && s.modeTabActive]}
            onPress={() => {
              haptic.select();
              setMode('explore');
            }}
            accessibilityRole="button"
            accessibilityLabel="Rutin ve Alışkanlık Keşfet"
            accessibilityState={{ selected: mode === 'explore' }}
          >
            <Ionicons
              name="sparkles-outline"
              size={14}
              color={mode === 'explore' ? c.white : c.textDim}
            />
            <Text style={[s.modeTabText, mode === 'explore' && s.modeTabTextActive]}>
              Rutin Keşfet
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modeTab, mode === 'tools' && s.modeTabActive]}
            onPress={() => {
              haptic.select();
              setMode('tools');
            }}
            accessibilityRole="button"
            accessibilityLabel="Sistem ve Araçlar"
            accessibilityState={{ selected: mode === 'tools' }}
          >
            <Ionicons
              name="compass-outline"
              size={14}
              color={mode === 'tools' ? c.white : c.textDim}
            />
            <Text style={[s.modeTabText, mode === 'tools' && s.modeTabTextActive]}>
              Araçlar
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'flow' ? (
        <View style={s.flowBody}>
          <FocusFlowView showExpandButton onRequestExplorePacks={() => setMode('explore')} />
        </View>
      ) : mode === 'explore' ? (
        <ExploreView
          onOpenFlow={() => setMode('flow')}
          onOpenAiRoutine={() => setAiModalVisible(true)}
        />
      ) : (
        <ToolsView category={selectedToolCat} onCategory={setSelectedToolCat} />
      )}

      <AIRoutineModal visible={aiModalVisible} onClose={() => setAiModalVisible(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    flex1: { flex: 1 },
    topChrome: {
      paddingHorizontal: space.md,
      paddingTop: space.sm,
      paddingBottom: space.xs,
      backgroundColor: c.bg,
    },
    flowBody: { flex: 1 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: space.sm,
      marginBottom: space.sm,
    },
    pageTitle: { ...font.display, color: c.text, fontWeight: '800' },
    pageSub: { ...font.bodySm, color: c.textDim, marginTop: space.xs },
    aiQuickBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: c.info,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.pill,
      minHeight: 36,
    },
    aiQuickBtnText: { ...font.caption, fontWeight: '700', color: c.white },
    modeBar: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.xs,
      marginBottom: space.sm,
    },
    modeTab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
      paddingVertical: space.sm,
      borderRadius: radius.sm,
      minHeight: 40,
    },
    modeTabActive: { backgroundColor: c.primary },
    modeTabText: { ...font.caption, fontWeight: '700', color: c.textDim },
    modeTabTextActive: { color: c.white },
  });
