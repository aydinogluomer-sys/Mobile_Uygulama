import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/tokens';
import {
  IMPACT_LEVELS,
  URGENCY_OPTIONS,
  TRIAGE_META,
  computeTriage,
  eisenhowerCell,
} from '../../lib/triage';
import { styles } from './styles';
import type { StepProps } from './types';

export default function StepPriority({ ctx }: StepProps) {
  const { form, setImpact, setUrgency } = ctx;
  const triage = computeTriage(form.impact_level, form.urgency);
  const meta = TRIAGE_META[triage];
  const cell = eisenhowerCell(form.impact_level, form.urgency);
  const grid: { row: number; col: number; t: typeof triage }[] = [
    { row: 0, col: 0, t: 'do_now' },
    { row: 0, col: 1, t: 'plan' },
    { row: 1, col: 0, t: 'wait_watch' },
    { row: 1, col: 1, t: 'eliminate' },
  ];

  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Öncelik & Strateji</Text>
      <Text style={styles.stepSubtitle}>Bu alışkanlık ne kadar önemli ve acil?</Text>

      {/* Etki Seviyesi */}
      <Text style={styles.label}>Etki Seviyesi</Text>
      <View style={styles.impactRow}>
        {IMPACT_LEVELS.map((lv) => {
          const sel = form.impact_level === lv.key;
          return (
            <TouchableOpacity
              key={lv.key}
              style={[styles.impactCard, sel && { borderColor: lv.color, backgroundColor: lv.color + '18' }]}
              onPress={() => setImpact(lv.key)}
            >
              <View style={[styles.impactDot, { backgroundColor: lv.color }]} />
              <Text style={[styles.impactLabel, sel && { color: lv.color }]}>{lv.label}</Text>
              <Text style={styles.impactDesc}>{lv.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Aciliyet */}
      <Text style={[styles.label, { marginTop: 20 }]}>Aciliyet</Text>
      <View style={styles.row}>
        {URGENCY_OPTIONS.map((u) => {
          const sel = form.urgency === u.key;
          return (
            <TouchableOpacity
              key={u.key}
              style={[styles.typeCard, sel && styles.typeCardSelected]}
              onPress={() => setUrgency(u.key)}
            >
              <Ionicons name={u.icon as any} size={22} color={sel ? colors.accent : colors.textDim} />
              <Text style={[styles.typeLabel, { marginTop: 6 }]}>{u.label}</Text>
              <Text style={styles.typeDesc}>{u.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Strateji Haritası — Eisenhower 2×2 */}
      <Text style={[styles.label, { marginTop: 20 }]}>Strateji Haritası</Text>
      <View style={styles.matrixHeaderRow}>
        <View style={styles.matrixCorner} />
        <Text style={styles.matrixColLabel}>Acil</Text>
        <Text style={styles.matrixColLabel}>Acil Değil</Text>
      </View>
      {[0, 1].map((r) => (
        <View key={r} style={styles.matrixRow}>
          <Text style={styles.matrixRowLabel}>{r === 0 ? 'Önemli' : 'Önemsiz'}</Text>
          {[0, 1].map((c) => {
            const g = grid.find((x) => x.row === r && x.col === c)!;
            const m = TRIAGE_META[g.t];
            const active = cell.row === r && cell.col === c;
            return (
              <View
                key={c}
                style={[
                  styles.matrixCell,
                  { borderColor: active ? m.color : colors.border, backgroundColor: active ? m.color + '22' : colors.surface },
                ]}
              >
                <Text style={styles.matrixEmoji}>{m.emoji}</Text>
                <Text style={[styles.matrixCellLabel, active && { color: m.color }]} numberOfLines={1}>
                  {m.label}
                </Text>
              </View>
            );
          })}
        </View>
      ))}

      {/* Triaj Kararı */}
      <View style={[styles.triageCard, { borderColor: meta.color + '55', backgroundColor: meta.color + '12' }]}>
        <View style={[styles.triageIconWrap, { backgroundColor: meta.color + '22' }]}>
          <Text style={styles.triageEmoji}>{meta.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.triageTitle, { color: meta.color }]}>{meta.label}</Text>
          <Text style={styles.triageDesc}>{meta.roomDesc}</Text>
          <Text style={styles.triageCost}>Sonraki adımda zorluk ile irade maliyeti hesaplanır</Text>
        </View>
      </View>
    </View>
  );
}
