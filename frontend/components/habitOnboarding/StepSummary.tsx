import React, { type ComponentProps } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  IMPACT_LEVELS,
  TRIAGE_META,
  computeTriage,
  endConditionLabel,
  cueLabel,
} from '../../lib/triage';
import { DURATION_UNIT } from '../../lib/habitEngine';
import { frequencySummary } from '../../lib/frequencyForm';
import type { StepProps } from './types';

type IconName = ComponentProps<typeof Ionicons>['name'];

export default function StepSummary({ ctx }: StepProps) {
  const { form, existingHabits, lifeAreas, willpowerState, DEST, plannedTriage, plannedStatus, colors, styles } = ctx;
  const triage = computeTriage(form.impact_level, form.urgency);
  const tmeta = TRIAGE_META[triage];
  const imp = IMPACT_LEVELS.find((l) => l.key === form.impact_level);
  const trackLabel =
    form.tracking_type === 'numeric' ? `Sayısal · ${form.daily_goal ?? '?'} ${form.unit ?? ''}`.trim()
    : form.tracking_type === 'duration' ? `Süre · ${form.daily_goal ?? '?'} ${DURATION_UNIT}`
    : form.tracking_type === 'abstinence' ? 'Kaçınma'
    : 'Evet / Hayır';
  // R01.02-e: the real schedule sentence ("Haftada 3 kez", "3 günde bir").
  const freqLabel = frequencySummary(form.frequency_config);

  const rows: { icon: string; label: string; val: string; color?: string }[] = [
    { icon: 'pricetag-outline', label: 'Davranış', val: form.behavior_type === 'positive' ? 'Pozitif' : 'Negatif' },
    { icon: 'compass-outline', label: 'Kategori', val: lifeAreas.find((a) => a.key === form.life_area)?.label ?? '—' },
    { icon: 'analytics-outline', label: 'Takip', val: trackLabel },
    { icon: 'repeat-outline', label: 'Frekans', val: freqLabel },
    { icon: 'timer-outline', label: 'Tahmini Süre', val: form.estimated_minutes ? `${form.estimated_minutes} dk/gün` : '—' },
    { icon: 'notifications-outline', label: 'Hatırlatıcı', val: form.reminders?.enabled ? form.reminders.time : 'Kapalı' },
    { icon: 'link-outline', label: 'Çağrışım', val: cueLabel(form, existingHabits) ?? '—' },
    { icon: 'hourglass-outline', label: 'Bitiş', val: endConditionLabel(form.end_condition) },
    { icon: 'flame-outline', label: 'Etki', val: imp?.label ?? '—', color: imp?.color },
    { icon: form.urgency === 'urgent' ? 'flash' : 'time-outline', label: 'Aciliyet', val: form.urgency === 'urgent' ? 'Acil' : 'Acil Değil' },
    { icon: tmeta.icon, label: 'Karar', val: `${tmeta.emoji} ${tmeta.label}`, color: tmeta.color },
    { icon: 'flash', label: 'İrade Maliyeti', val: `${form.willpower_cost}`, color: colors.warning },
  ];

  return (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Özet & Onayla</Text>
      <Text style={styles.stepSubtitle}>Kararını gözden geçir</Text>

      {/* Başlık kartı */}
      <View style={styles.summaryHead}>
        <View style={[styles.summaryIcon, { backgroundColor: (form.color ?? colors.accent) + '25' }]}>
          <Ionicons name={(form.icon ?? 'star-outline') as IconName} size={26} color={form.color ?? colors.accent} />
        </View>
        <Text style={styles.summaryName}>{form.name || 'İsimsiz alışkanlık'}</Text>
      </View>

      {/* Mini tablo */}
      <View style={styles.summaryTable}>
        {rows.map((r, i) => (
          <View key={i} style={[styles.summaryRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
            <View style={styles.summaryRowLeft}>
              <Ionicons name={r.icon as IconName} size={15} color={colors.textFaint} />
              <Text style={styles.summaryRowLabel}>{r.label}</Text>
            </View>
            <Text style={[styles.summaryRowVal, r.color && { color: r.color }]}>{r.val}</Text>
          </View>
        ))}
      </View>

      {/* Hedef kartı */}
      {willpowerState && (
        <View style={[styles.routingCard, { borderColor: DEST.color + '40', backgroundColor: DEST.color + '12' }]}>
          <Ionicons name={DEST.icon as IconName} size={18} color={DEST.color} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.routingTitle, { color: DEST.color }]}>{DEST.room}&apos;a eklenecek</Text>
            <Text style={styles.routingDesc}>
              {plannedStatus === 'active'
                ? `🔥 ${TRIAGE_META[plannedTriage].label} · Slot: ${willpowerState.active_count + 1}/${willpowerState.focus_capacity} · Harcama: ${willpowerState.used + form.willpower_cost}/${willpowerState.daily_budget} irade`
                : plannedStatus === 'idea'
                ? `🗑 ${TRIAGE_META[plannedTriage].label} · Düşük öncelik — fikir olarak saklanır.`
                : plannedTriage === 'do_now'
                ? `⏳ Kapasite dolu (${willpowerState.active_count}/${willpowerState.focus_capacity} slot). Yer açarak aktifleştirebilirsin.`
                : `${TRIAGE_META[plannedTriage].emoji} ${TRIAGE_META[plannedTriage].label} · Zamanı gelince Aktif Odak'a alabilirsin.`}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.mirrorNoteRow}>
        <Ionicons name="grid-outline" size={13} color={colors.textFaint} />
        <Text style={styles.mirrorNoteText}>Bu özet, İstatistikler → Liste sekmesinde bir satır olarak görünür.</Text>
      </View>
    </View>
  );
}
