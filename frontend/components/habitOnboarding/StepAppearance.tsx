import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/tokens';
import { computeWillpowerCost } from '../../lib/triage';
import { COLORS, ICONS } from './constants';
import { styles } from './styles';
import type { StepProps } from './types';

export default function StepAppearance({ ctx }: StepProps) {
  const { form, setForm } = ctx;

  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Son Ayarlar</Text>
      <Text style={styles.stepSubtitle}>İkon, renk ve irade maliyeti</Text>

      <Text style={styles.label}>İkon</Text>
      <View style={styles.iconGrid}>
        {ICONS.map((icon) => (
          <TouchableOpacity
            key={icon}
            style={[styles.iconBtn, form.icon === icon && { borderColor: form.color ?? colors.accent, borderWidth: 2 }]}
            onPress={() => setForm((prev) => ({ ...prev, icon }))}
          >
            <Ionicons name={icon as any} size={24} color={form.icon === icon ? (form.color ?? colors.accent) : colors.textDim} />
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Renk</Text>
      <View style={styles.colorRow}>
        {COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.colorDot, { backgroundColor: c }, form.color === c && styles.colorDotSelected]}
            onPress={() => setForm((prev) => ({ ...prev, color: c }))}
          >
            {form.color === c && <Ionicons name="checkmark" size={16} color={colors.white} />}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>İrade Maliyeti (1–10)</Text>
      <View style={styles.infoBox}>
        <Ionicons name="flash" size={18} color={colors.warning} />
        <Text style={styles.infoText}>
          İrade motoru zorluk × frekans + etki + davranış faktörlerinden {computeWillpowerCost(form)} hesapladı — dilersen elle ayarla.
        </Text>
      </View>
      <View style={styles.costRow}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.costBtn, form.willpower_cost === n && styles.costBtnSelected]}
            onPress={() => setForm((prev) => ({ ...prev, willpower_cost: n }))}
          >
            <Text style={[styles.costBtnText, form.willpower_cost === n && styles.costBtnTextSelected]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
