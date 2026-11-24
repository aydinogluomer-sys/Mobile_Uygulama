import React, { type ComponentProps } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DIFFICULTY_LEVELS, costBreakdown, difficultyMeta } from '../../lib/triage';
import { decimalTR } from '../../lib/chartText';
import type { StepProps } from './types';

export default function StepEffort({ ctx }: StepProps) {
  const { form, setDifficulty, setMinutes, colors, styles } = ctx;
  const bd = costBreakdown(form);
  const dmeta = difficultyMeta(form.difficulty);
  const rows: { label: string; val: string; color?: string }[] = [
    { label: `Zorluk (${dmeta.label})`, val: `${bd.diff}`, color: dmeta.color },
    {
      label: `Frekans (${'intervalDays' in bd ? `${bd.intervalDays} günde bir` : bd.freqKind === 'daily' ? 'günlük' : bd.freqKind === 'weekly' ? 'haftalık' : 'aylık'})`,
      val: `×${decimalTR(Math.round(bd.freqFactor * 100) / 100, 2)}`,
    },
    { label: 'Temel', val: decimalTR(bd.base) },
    { label: 'Davranış', val: bd.behaviorBonus ? `+${bd.behaviorBonus}` : '+0' },
    { label: 'Etki', val: bd.impactBonus ? `+${bd.impactBonus}` : '+0' },
    { label: 'Ölçüm', val: bd.trackingBonus ? `+${bd.trackingBonus}` : '+0' },
    { label: `Süre (${bd.mins} dk)`, val: bd.timeBonus ? `+${bd.timeBonus}` : '+0' },
  ];

  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Zorluk & İrade</Text>
      <Text style={styles.stepSubtitle}>Senin için ne kadar zorlayıcı?</Text>

      <Text style={styles.label}>Zorluk Seviyesi</Text>
      <View style={styles.row}>
        {DIFFICULTY_LEVELS.map((d) => {
          const sel = form.difficulty === d.key;
          return (
            <TouchableOpacity
              key={d.key}
              style={[styles.typeCard, sel && { borderColor: d.color, backgroundColor: d.color + '18' }]}
              onPress={() => setDifficulty(d.key)}
              accessibilityRole="button"
              accessibilityLabel={d.label}
              accessibilityState={{ selected: sel }}
            >
              <Ionicons name={d.icon as ComponentProps<typeof Ionicons>['name']} size={22} color={sel ? d.color : colors.textDim} />
              <Text style={[styles.typeLabel, { marginTop: 6 }, sel && { color: d.color }]}>{d.label}</Text>
              <Text style={styles.typeDesc}>{d.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Tahmini süre */}
      <Text style={[styles.label, { marginTop: 20 }]}>Günlük Tahmini Süre</Text>
      <View style={styles.minsRow}>
        {[5, 15, 30, 45, 60, 90].map((m) => {
          const sel = form.estimated_minutes === m;
          return (
            <TouchableOpacity
              key={m}
              style={[styles.minsBtn, sel && styles.minsBtnSel]}
              onPress={() => setMinutes(m)}
              accessibilityRole="button"
              accessibilityLabel={`${m} dakika`}
              accessibilityState={{ selected: sel }}
            >
              <Text style={[styles.minsBtnText, sel && styles.minsBtnTextSel]}>{m} dk</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={[styles.minsBtn, form.estimated_minutes === 0 && styles.minsBtnSel]}
          onPress={() => setMinutes(0)}
          accessibilityRole="button"
          accessibilityLabel="Süre belirtme"
          accessibilityState={{ selected: form.estimated_minutes === 0 }}
        >
          <Text style={[styles.minsBtnText, form.estimated_minutes === 0 && styles.minsBtnTextSel]}>—</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={[styles.input, { marginTop: 10 }]}
        placeholder="Özel süre (dk)"
        placeholderTextColor={colors.textFaint}
        keyboardType="numeric"
        value={form.estimated_minutes ? String(form.estimated_minutes) : ''}
        onChangeText={(t) => setMinutes(parseInt(t, 10) || 0)}
      />
      {form.estimated_minutes === 0 && (
        <Text style={styles.minsInfo} accessibilityLiveRegion="polite">
          Süre seçilmedi: yük en az 1 dk üzerinden hesaplanır
        </Text>
      )}

      {/* İrade maliyeti dökümü */}
      <View style={styles.costBreakdownCard}>
        <View style={styles.costHeadRow}>
          <View style={styles.costHeadLeft}>
            <Ionicons name="flash" size={20} color={colors.warning} />
            <Text style={styles.costHeadLabel}>Hesaplanan İrade Maliyeti</Text>
          </View>
          <View style={styles.costBigBadge}>
            <Text style={styles.costBigText}>{bd.cost}</Text>
          </View>
        </View>
        <View style={styles.costDivider} />
        {rows.map((r, i) => (
          <View key={i} style={styles.costRowItem}>
            <Text style={styles.costRowLabel}>{r.label}</Text>
            <Text style={[styles.costRowVal, r.color && { color: r.color }]}>{r.val}</Text>
          </View>
        ))}
        <View style={styles.costDivider} />
        <View style={styles.costRowItem}>
          <Text style={styles.costFormulaLabel}>Toplam (yuvarlanır)</Text>
          <Text style={styles.costFormulaVal}>{decimalTR(bd.raw)} → {bd.cost}</Text>
        </View>
        <Text style={styles.costHint}>
          Daha zor, daha sık ve daha etkili alışkanlıklar günlük irade bütçenden daha fazla yer.
        </Text>
      </View>
    </View>
  );
}
