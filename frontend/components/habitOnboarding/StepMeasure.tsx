import React from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { colors } from '../../lib/tokens';
import { DURATION_UNIT } from '../../lib/habitEngine';
import { styles } from './styles';
import type { StepProps } from './types';

export default function StepMeasure({ ctx }: StepProps) {
  const { form, setForm, goal, setGoalText } = ctx;

  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Nasıl Takip Edilsin?</Text>
      <Text style={styles.stepSubtitle}>Tamamlama yöntemini seç</Text>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'boolean' && styles.typeCardSelected]}
          onPress={() =>
            setForm((prev) => ({
              ...prev,
              tracking_type: 'boolean',
              unit: null,
              daily_goal: null,
              target_direction: null,
            }))
          }
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'boolean' }}
          accessibilityLabel="Evet veya Hayır olarak takip et"
        >
          <Text style={styles.typeEmoji}>✓</Text>
          <Text style={styles.typeLabel}>Evet / Hayır</Text>
          <Text style={styles.typeDesc}>Yaptım ya da yapmadım</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'numeric' && styles.typeCardSelected]}
          onPress={() =>
            setForm((prev) => ({
              ...prev,
              tracking_type: 'numeric',
              unit: null,
              daily_goal: null,
              target_direction: 'at_least',
            }))
          }
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'numeric' }}
          accessibilityLabel="Sayısal miktar olarak takip et"
        >
          <Text style={styles.typeEmoji}>📊</Text>
          <Text style={styles.typeLabel}>Sayısal</Text>
          <Text style={styles.typeDesc}>Adım, sayfa, ml…</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'duration' && styles.typeCardSelected]}
          // Süre kendi takip tipidir; birimi sabittir.
          onPress={() =>
            setForm((prev) => ({
              ...prev,
              tracking_type: 'duration',
              unit: DURATION_UNIT,
              daily_goal: null,
              target_direction: 'at_least',
            }))
          }
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'duration' }}
          accessibilityLabel="Süre olarak takip et"
        >
          <Text style={styles.typeEmoji}>⏱️</Text>
          <Text style={styles.typeLabel}>Süre</Text>
          <Text style={styles.typeDesc}>Dakika cinsinden</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'abstinence' && styles.typeCardSelected]}
          onPress={() =>
            setForm((prev) => ({
              ...prev,
              tracking_type: 'abstinence',
              behavior_type: 'negative',
              unit: null,
              daily_goal: null,
              target_direction: null,
            }))
          }
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'abstinence' }}
          accessibilityLabel="Kaçınma olarak takip et"
        >
          <Text style={styles.typeEmoji}>🚫</Text>
          <Text style={styles.typeLabel}>Kaçınma</Text>
          <Text style={styles.typeDesc}>Bugün uzak durdum</Text>
        </TouchableOpacity>
      </View>

      {form.tracking_type === 'numeric' && (
        <View style={styles.measurableSection}>
          <Text style={styles.label}>Birim</Text>
          <TextInput
            style={styles.input}
            placeholder="Örn: adım, sayfa, ml"
            placeholderTextColor={colors.textFaint}
            value={form.unit ?? ''}
            onChangeText={(t) => setForm((prev) => ({ ...prev, unit: t }))}
          />

          <Text style={styles.label}>Hedef Miktar</Text>
          <TextInput
            style={styles.input}
            placeholder="Örn: 10000"
            placeholderTextColor={colors.textFaint}
            keyboardType="numeric"
            accessibilityLabel="Hedef miktar"
            value={goal.text}
            onChangeText={setGoalText}
          />
          {goal.error && (
            <Text style={styles.fieldHint} accessibilityLiveRegion="polite">
              {goal.error}
            </Text>
          )}

          <Text style={styles.label}>Yön</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_least' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_least' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_least' }}
            >
              <Text style={styles.dirBtnText}>En az ↑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_most' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_most' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_most' }}
            >
              <Text style={styles.dirBtnText}>En fazla ↓</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {form.tracking_type === 'duration' && (
        <View style={styles.measurableSection}>
          <Text style={styles.label}>Hedef Süre ({DURATION_UNIT})</Text>
          <TextInput
            style={styles.input}
            placeholder="Örn: 20"
            placeholderTextColor={colors.textFaint}
            keyboardType="numeric"
            accessibilityLabel="Hedef süre"
            value={goal.text}
            onChangeText={setGoalText}
          />
          {goal.error && (
            <Text style={styles.fieldHint} accessibilityLiveRegion="polite">
              {goal.error}
            </Text>
          )}

          <Text style={styles.label}>Yön</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_least' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_least' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_least' }}
            >
              <Text style={styles.dirBtnText}>En az ↑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_most' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_most' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_most' }}
            >
              <Text style={styles.dirBtnText}>En fazla ↓</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {form.tracking_type === 'abstinence' && (
        <View style={styles.measurableSection}>
          <Text style={styles.typeDesc}>
            Her gün tek soru sorulur: bugün uzak durdun mu? Miktar ya da süre girilmez.
          </Text>
        </View>
      )}
    </View>
  );
}
