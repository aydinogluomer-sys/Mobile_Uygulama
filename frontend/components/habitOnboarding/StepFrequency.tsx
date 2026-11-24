import React from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays } from 'date-fns';
import { colors } from '../../lib/tokens';
import type { FrequencyConfig } from '../../lib/supabase';
import { endConditionLabel } from '../../lib/triage';
import { togglePartOfDay as togglePartOfDayPure } from '../../lib/frequencyForm';
import FrequencyEditor from '../FrequencyEditor';
import { PART_OF_DAY } from './constants';
import { styles } from './styles';
import type { StepProps } from './types';

export default function StepFrequency({ ctx }: StepProps) {
  const { form, setForm, applyAndRecost, cueMode, setCueMode, existingHabits } = ctx;
  const freq = form.frequency_config;

  function updateFreq(next: FrequencyConfig) {
    if (next !== freq) applyAndRecost({ frequency_config: next });
  }
  function togglePartOfDay(part: string) {
    updateFreq(togglePartOfDayPure(freq, part as NonNullable<FrequencyConfig['part_of_day']>[number]));
  }

  const ec = form.end_condition;
  const endKind: 'none' | 'date' | 'amount' = ec?.kind ?? 'none';
  const rem = form.reminders;
  function setEndDate(days: number) {
    setForm((prev) => ({
      ...prev,
      end_condition: { kind: 'date', value: format(addDays(new Date(), days), 'yyyy-MM-dd') },
    }));
  }

  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Ne Sıklıkta?</Text>
      <Text style={styles.stepSubtitle}>Frekansı belirle</Text>

      <FrequencyEditor value={freq} onChange={updateFreq} />

      <Text style={[styles.label, { marginTop: 20 }]}>Günün hangi bölümünde?</Text>
      <View style={styles.row}>
        {PART_OF_DAY.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.partBtn, (freq.part_of_day ?? []).includes(p.id as any) && styles.partBtnSelected]}
            onPress={() => togglePartOfDay(p.id)}
          >
            <Text style={styles.partEmoji}>{p.icon}</Text>
            <Text style={styles.partLabel}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bitiş Koşulu */}
      <Text style={[styles.label, { marginTop: 20 }]}>Bitiş Koşulu</Text>
      <View style={styles.row}>
        {([
          { k: 'none', label: 'Süresiz', icon: 'infinite-outline' },
          { k: 'date', label: 'Tarihe kadar', icon: 'calendar-outline' },
          { k: 'amount', label: 'Hedef sayıya', icon: 'flag-outline' },
        ] as const).map((opt) => {
          const sel = endKind === opt.k;
          return (
            <TouchableOpacity
              key={opt.k}
              style={[styles.endKindBtn, sel && styles.endKindBtnSel]}
              onPress={() => {
                if (opt.k === 'none') setForm((prev) => ({ ...prev, end_condition: null }));
                else if (opt.k === 'date') setEndDate(30);
                else setForm((prev) => ({ ...prev, end_condition: { kind: 'amount', value: 30 } }));
              }}
            >
              <Ionicons name={opt.icon as any} size={18} color={sel ? colors.accent : colors.textDim} />
              <Text style={[styles.endKindText, sel && { color: colors.accent }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {endKind === 'date' && (
        <>
          <View style={[styles.daysRow, { marginTop: 12 }]}>
            {[30, 60, 90, 180].map((n) => {
              const target = format(addDays(new Date(), n), 'yyyy-MM-dd');
              const sel = ec?.kind === 'date' && ec.value === target;
              return (
                <TouchableOpacity
                  key={n}
                  style={[styles.dayBtn, sel && styles.dayBtnSelected]}
                  onPress={() => setEndDate(n)}
                >
                  <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{n} gün</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {ec?.kind === 'date' && (
            <Text style={styles.endHint}>Bitiş: {endConditionLabel(ec)}</Text>
          )}
        </>
      )}

      {endKind === 'amount' && (
        <View style={[styles.row, { marginTop: 12, alignItems: 'center' }]}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Örn: 30"
            placeholderTextColor={colors.textFaint}
            keyboardType="numeric"
            value={ec?.kind === 'amount' ? String(ec.value) : ''}
            onChangeText={(t) => {
              const v = parseInt(t, 10);
              setForm((prev) => ({
                ...prev,
                end_condition: v > 0 ? { kind: 'amount', value: v } : { kind: 'amount', value: 0 },
              }));
            }}
          />
          <Text style={styles.endUnit}>kez tamamlayınca</Text>
        </View>
      )}

      {/* Hatırlatıcı */}
      <View style={styles.reminderHead}>
        <Text style={[styles.label, { marginTop: 20, marginBottom: 0 }]}>Hatırlatıcı</Text>
        <TouchableOpacity
          style={[styles.remToggle, rem?.enabled && styles.remToggleOn]}
          onPress={() =>
            setForm((prev) => ({
              ...prev,
              reminders: prev.reminders?.enabled
                ? { time: prev.reminders.time, enabled: false }
                : { time: prev.reminders?.time || '08:00', enabled: true },
            }))
          }
        >
          <Ionicons name={rem?.enabled ? 'notifications' : 'notifications-off-outline'} size={14} color={rem?.enabled ? colors.white : colors.textDim} />
          <Text style={[styles.remToggleText, rem?.enabled && { color: colors.white }]}>{rem?.enabled ? 'Açık' : 'Kapalı'}</Text>
        </TouchableOpacity>
      </View>
      {rem?.enabled && (
        <>
          <View style={[styles.daysRow, { marginTop: 12, flexWrap: 'wrap', gap: 8 }]}>
            {['07:00', '08:00', '12:00', '18:00', '21:00'].map((t) => {
              const sel = rem.time === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[styles.minsBtn, sel && styles.minsBtnSel]}
                  onPress={() => setForm((prev) => ({ ...prev, reminders: { time: t, enabled: true } }))}
                >
                  <Text style={[styles.minsBtnText, sel && styles.minsBtnTextSel]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            placeholder="Özel saat (SS:DD)"
            placeholderTextColor={colors.textFaint}
            value={rem.time}
            onChangeText={(t) => setForm((prev) => ({ ...prev, reminders: { time: t, enabled: true } }))}
          />
        </>
      )}

      {/* Çağrışım / İpucu (habit stacking) */}
      <Text style={[styles.label, { marginTop: 20 }]}>Çağrışım (İpucu)</Text>
      <View style={styles.row}>
        {([
          { k: 'none', label: 'Yok', icon: 'remove-circle-outline' },
          { k: 'habit', label: 'Alışkanlıktan sonra', icon: 'link-outline' },
          { k: 'note', label: 'Serbest not', icon: 'create-outline' },
        ] as const).map((opt) => {
          const sel = cueMode === opt.k;
          return (
            <TouchableOpacity
              key={opt.k}
              style={[styles.endKindBtn, sel && styles.endKindBtnSel]}
              onPress={() => {
                setCueMode(opt.k);
                if (opt.k === 'none') setForm((prev) => ({ ...prev, cue_habit_id: null, cue_note: null }));
                else if (opt.k === 'habit') setForm((prev) => ({ ...prev, cue_note: null }));
                else setForm((prev) => ({ ...prev, cue_habit_id: null, cue_note: prev.cue_note ?? '' }));
              }}
            >
              <Ionicons name={opt.icon as any} size={18} color={sel ? colors.accent : colors.textDim} />
              <Text style={[styles.endKindText, sel && { color: colors.accent }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {cueMode === 'habit' && (
        existingHabits.length === 0 ? (
          <Text style={styles.endHint}>Henüz başka alışkanlık yok</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {existingHabits.map((h) => {
                const sel = form.cue_habit_id === h.id;
                return (
                  <TouchableOpacity
                    key={h.id}
                    style={[styles.cueChip, sel && styles.cueChipSel]}
                    onPress={() => setForm((prev) => ({ ...prev, cue_habit_id: h.id, cue_note: null }))}
                  >
                    <Ionicons name={(h.icon ?? 'star-outline') as any} size={14} color={sel ? colors.accent : (h.color ?? colors.textDim)} />
                    <Text style={[styles.cueChipText, sel && { color: colors.accent }]} numberOfLines={1}>{h.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )
      )}

      {cueMode === 'note' && (
        <TextInput
          style={[styles.input, { marginTop: 12 }]}
          placeholder="Örn: Kahvaltıdan sonra"
          placeholderTextColor={colors.textFaint}
          value={form.cue_note ?? ''}
          onChangeText={(t) => setForm((prev) => ({ ...prev, cue_note: t }))}
        />
      )}
    </View>
  );
}
