// Seasonal Ambient Motion — geliştirici önizleme aracı (contract §15).
// Yalnızca __DEV__ altında kullanılır. Sistem tarihini değiştirmeden 12 ayın
// hareketini + yoğunluk + reduce-motion simülasyonunu QA etmeyi sağlar.
import { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getMonthBackground } from '../../lib/monthBackgrounds';
import { colors, hexA } from '../../lib/tokens';
import SeasonalMotion from './SeasonalMotion';
import { MONTH_NAMES_TR, monthNameFromIndex } from './config';
import type { SeasonalMotionIntensity } from './types';

const INTENSITIES: SeasonalMotionIntensity[] = ['off', 'subtle', 'normal'];

export default function SeasonalMotionPreview({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [monthIdx, setMonthIdx] = useState(new Date().getMonth());
  const [intensity, setIntensity] = useState<SeasonalMotionIntensity>('subtle');
  const [simReduce, setSimReduce] = useState(false);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        {/* Canlı önizleme: gerçek görsel + scrim + renderer (store'dan bağımsız) */}
        <Image source={getMonthBackground(monthIdx)} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.45) }]} pointerEvents="none" />
        <SeasonalMotion month={monthNameFromIndex(monthIdx)} intensity={intensity} reduceMotion={simReduce} isVisible />

        {/* Merkez okunabilirlik referansı — hareket metni bozuyor mu? */}
        <View style={s.center} pointerEvents="none">
          <Text style={s.centerNum}>{15}</Text>
          <Text style={s.centerLabel}>{MONTH_NAMES_TR[monthIdx]} • okunabilirlik testi</Text>
        </View>

        {/* Kontrol paneli */}
        <View style={s.panel}>
          <View style={s.rowBetween}>
            <Text style={s.title}>Mevsimsel Hareket — Önizleme (DEV)</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
          </View>

          <View style={s.monthRow}>
            <TouchableOpacity style={s.navBtn} onPress={() => setMonthIdx((m) => (m + 11) % 12)}>
              <Ionicons name="chevron-back" size={18} color="#fff" />
            </TouchableOpacity>
            <Text style={s.monthName}>{MONTH_NAMES_TR[monthIdx]}</Text>
            <TouchableOpacity style={s.navBtn} onPress={() => setMonthIdx((m) => (m + 1) % 12)}>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={s.seg}>
            {INTENSITIES.map((it) => (
              <TouchableOpacity key={it} style={[s.segBtn, intensity === it && s.segOn]} onPress={() => setIntensity(it)}>
                <Text style={[s.segTxt, intensity === it && s.segTxtOn]}>{it}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={s.toggleRow} onPress={() => setSimReduce((v) => !v)}>
            <Ionicons name={simReduce ? 'checkbox' : 'square-outline'} size={18} color="#D97757" />
            <Text style={s.toggleTxt}>Reduce motion simülasyonu (animasyon kapanmalı)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  centerNum: { fontSize: 64, fontWeight: '800', color: '#fff' },
  centerLabel: { fontSize: 13, color: '#fff', marginTop: 4 },
  panel: { position: 'absolute', left: 16, right: 16, bottom: 36, backgroundColor: 'rgba(20,20,16,0.92)', borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: '#383528' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: '800', color: '#fff' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 40, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#383528', alignItems: 'center', justifyContent: 'center' },
  monthName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  seg: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#383528' },
  segOn: { backgroundColor: '#D9775722', borderColor: '#D97757' },
  segTxt: { fontSize: 13, fontWeight: '700', color: '#827E72' },
  segTxtOn: { color: '#D97757' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleTxt: { fontSize: 12.5, color: '#BFBBAE', flex: 1 },
});
