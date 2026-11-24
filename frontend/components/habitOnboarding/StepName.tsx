import React from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import type { StepProps } from './types';

export default function StepName({ ctx }: StepProps) {
  const { form, setForm, lifeAreas, colors, styles } = ctx;

  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Alışkanlığın Nedir?</Text>
      <Text style={styles.stepSubtitle}>İsim ver ve türünü seç</Text>

      <TextInput
        style={styles.input}
        placeholder="Örn: Sabah Sporu"
        placeholderTextColor={colors.textFaint}
        value={form.name}
        onChangeText={(t) => setForm((prev) => ({ ...prev, name: t }))}
        autoFocus
      />

      <Text style={styles.label}>Davranış Türü</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.typeCard, form.behavior_type === 'positive' && styles.typeCardSelected]}
          onPress={() => setForm((prev) => ({ ...prev, behavior_type: 'positive' }))}
          accessibilityRole="button"
          accessibilityLabel="Pozitif davranış"
          accessibilityState={{ selected: form.behavior_type === 'positive' }}
        >
          <Text style={styles.typeEmoji}>✅</Text>
          <Text style={styles.typeLabel}>Pozitif</Text>
          <Text style={styles.typeDesc}>Yapmak istiyorum</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeCard, form.behavior_type === 'negative' && styles.typeCardSelectedRed]}
          onPress={() => setForm((prev) => ({ ...prev, behavior_type: 'negative' }))}
          accessibilityRole="button"
          accessibilityLabel="Negatif davranış"
          accessibilityState={{ selected: form.behavior_type === 'negative' }}
        >
          <Text style={styles.typeEmoji}>🚫</Text>
          <Text style={styles.typeLabel}>Negatif</Text>
          <Text style={styles.typeDesc}>Bırakmak istiyorum</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, { marginTop: 20 }]}>Kategori</Text>
      <Text style={styles.areaHint}>
        Yaşam dengeni ölçer: hayatının hangi alanlarında alışkanlığın var, hangilerinde yok — bunu İstatistikler&apos;de görürsün. (opsiyonel)
      </Text>
      <View style={styles.areaGrid}>
        {lifeAreas.map((a) => {
          const sel = form.life_area === a.key;
          return (
            <TouchableOpacity
              key={a.key}
              style={[styles.areaChip, sel && { backgroundColor: a.color + '22', borderColor: a.color }]}
              onPress={() => setForm((prev) => ({ ...prev, life_area: sel ? null : a.key }))}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityState={{ selected: sel }}
            >
              <View style={[styles.areaDot, { backgroundColor: a.color }]} />
              <Text style={[styles.areaChipText, sel && { color: a.color }]}>{a.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
