import { colors } from '../lib/tokens';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import type { FrequencyConfig } from '../lib/supabase';
import {
  setFrequencyKind, setWeeklyMode, weeklyModeOf, toggleWeekday,
  setFrequencyCount, setIntervalDays, setRangeStart, setRangeEnd, countCeiling,
  frequencySummary, rangeSummary, INTERVAL_PRESETS,
} from '../lib/frequencyForm';
import { todayLocal, parseLocalDate, addDaysLocal, ymd as ymdOf } from '../lib/date';

/**
 * The frequency controls: kind, weekly sub-mode, which days / how many, the
 * interval, the date envelope, and the live summary.
 *
 * KD-09 — extracted from `HabitOnboarding` so the habit-detail editor uses the
 * SAME controls instead of a second copy. Every change goes through a pure
 * transition in `lib/frequencyForm.ts`; this component only renders and calls
 * `onChange` with the next config. What a change COSTS (the willpower cost) is
 * the caller's business -- the creation form recosts, the editor recosts on
 * save -- so it is deliberately not done here.
 *
 * `part_of_day` is not part of the schedule shape and stays with its caller.
 */
export const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
/** Full names, for screen readers: "Pzt" read aloud is not a word. */
export const WEEKDAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

export default function FrequencyEditor({
  value: freq,
  onChange,
}: {
  value: FrequencyConfig;
  onChange: (next: FrequencyConfig) => void;
}) {
  function updateFreq(next: FrequencyConfig) {
    if (next !== freq) onChange(next);
  }
  function setKind(kind: FrequencyConfig['kind']) { updateFreq(setFrequencyKind(freq, kind)); }
  function toggleDay(dayIdx: number) { updateFreq(toggleWeekday(freq, dayIdx)); }
  const weeklyMode = weeklyModeOf(freq);
  const countMax = countCeiling(freq.kind);
  const todayYmd = todayLocal();
  const rangeBase = freq.range_start ?? todayYmd;
  const plusDays = (from: string, n: number) => ymdOf(addDaysLocal(parseLocalDate(from) ?? new Date(), n));

  return (
    <>
      {/* R01.02-e:freq-controls:start */}
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Sıklık türü">
        {(['daily', 'weekly', 'monthly'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.freqBtn, freq.kind === k && styles.freqBtnSelected]}
            onPress={() => setKind(k)}
            accessibilityRole="radio"
            accessibilityLabel={k === 'daily' ? 'Günlük' : k === 'weekly' ? 'Haftalık' : 'Aylık'}
            accessibilityState={{ selected: freq.kind === k, checked: freq.kind === k }}
          >
            <Text style={[styles.freqBtnText, freq.kind === k && styles.freqBtnTextSelected]}>
              {k === 'daily' ? 'Günlük' : k === 'weekly' ? 'Haftalık' : 'Aylık'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {freq.kind === 'daily' && (
        <>
          {/* "Her N günde bir": 1 is plain daily, so "Her gün" REMOVES interval_days
              (setIntervalDays(null)); the field is never written as 1. */}
          <Text style={[styles.label, { marginTop: 20 }]}>Ne kadar sık?</Text>
          <View style={styles.daysRow} accessibilityRole="radiogroup" accessibilityLabel="Tekrar aralığı">
            {([null, ...INTERVAL_PRESETS] as (number | null)[]).map((n) => {
              const sel = (freq.interval_days ?? null) === n;
              const label = n === null ? 'Her gün' : `${n} günde bir`;
              return (
                <TouchableOpacity
                  key={String(n)}
                  style={[styles.dayBtn, styles.wideChip, sel && styles.dayBtnSelected]}
                  onPress={() => updateFreq(setIntervalDays(freq, n))}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: sel, checked: sel }}
                >
                  <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={[styles.row, { marginTop: 10, alignItems: 'center' }]}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Başka: kaç günde bir? (2–365)"
              placeholderTextColor="#827E72"
              keyboardType="numeric"
              accessibilityLabel="Kaç günde bir, 2 ile 365 arası"
              value={freq.interval_days && !(INTERVAL_PRESETS as readonly number[]).includes(freq.interval_days) ? String(freq.interval_days) : ''}
              onChangeText={(t) => updateFreq(setIntervalDays(freq, t.trim() === '' ? null : parseInt(t, 10)))}
            />
            <Text style={styles.endUnit}>günde bir</Text>
          </View>
        </>
      )}

      {freq.kind === 'weekly' && (
        <>
          {/* Days XOR count: scheduleKind reads `days` first and ignores a count
              beside it, so the two are separate modes, never both filled. */}
          <View style={[styles.row, { marginTop: 20 }]} accessibilityRole="radiogroup" accessibilityLabel="Haftalık tür">
            {(['count', 'days'] as const).map((m) => {
              const sel = weeklyMode === m;
              const label = m === 'count' ? 'Haftada N kez' : 'Belirli günler';
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.freqBtn, sel && styles.freqBtnSelected]}
                  onPress={() => updateFreq(setWeeklyMode(freq, m))}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: sel, checked: sel }}
                >
                  <Text style={[styles.freqBtnText, sel && styles.freqBtnTextSelected]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {weeklyMode === 'days' && (
            <>
              <Text style={[styles.label, { marginTop: 16 }]}>Hangi günler?</Text>
              <View style={styles.daysRow}>
                {WEEKDAYS.map((d, i) => {
                  const sel = (freq.days ?? []).includes(i);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayBtn, sel && styles.dayBtnSelected]}
                      onPress={() => toggleDay(i)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={WEEKDAY_NAMES[i]}
                      accessibilityState={{ checked: sel }}
                    >
                      <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {(freq.days ?? []).length === 0 && (
                <Text style={styles.endHint} accessibilityLiveRegion="polite">Devam etmek için en az bir gün seç.</Text>
              )}
            </>
          )}
        </>
      )}

      {(freq.kind === 'monthly' || (freq.kind === 'weekly' && weeklyMode === 'count')) && (
        <View style={[styles.row, { marginTop: 16, alignItems: 'center' }]}>
          <TouchableOpacity
            style={[styles.dayBtn, (freq.count ?? 1) <= 1 && styles.buttonDisabled]}
            onPress={() => updateFreq(setFrequencyCount(freq, (freq.count ?? 1) - 1))}
            disabled={(freq.count ?? 1) <= 1}
            accessibilityRole="button"
            accessibilityLabel={freq.kind === 'monthly' ? 'Ayda bir kez azalt' : 'Haftada bir kez azalt'}
            accessibilityState={{ disabled: (freq.count ?? 1) <= 1 }}
          >
            <Text style={styles.dayBtnText}>−</Text>
          </TouchableOpacity>
          <Text
            style={[styles.endUnit, { minWidth: 110, textAlign: 'center' }]}
            accessibilityLiveRegion="polite"
          >
            {freq.kind === 'monthly' ? 'Ayda' : 'Haftada'} {freq.count ?? 1} kez
          </Text>
          <TouchableOpacity
            style={[styles.dayBtn, (freq.count ?? 1) >= countMax && styles.buttonDisabled]}
            onPress={() => updateFreq(setFrequencyCount(freq, (freq.count ?? 1) + 1))}
            disabled={(freq.count ?? 1) >= countMax}
            accessibilityRole="button"
            accessibilityLabel={freq.kind === 'monthly' ? 'Ayda bir kez artır' : 'Haftada bir kez artır'}
            accessibilityState={{ disabled: (freq.count ?? 1) >= countMax }}
          >
            <Text style={styles.dayBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tarih zarfı — bir ŞEKİL değil: her sıklık türüyle birleşir, kind
          değişince korunur (setFrequencyKind). Uçlar opsiyonel; bitiş
          başlangıçtan önce olamaz (setRangeEnd reddeder). */}
      <Text style={[styles.label, { marginTop: 20 }]}>Yalnızca şu tarihler arasında (isteğe bağlı)</Text>
      <View style={styles.daysRow} accessibilityRole="radiogroup" accessibilityLabel="Başlangıç tarihi">
        {([null, 7, 30] as (number | null)[]).map((n) => {
          const target = n === null ? null : plusDays(todayYmd, n);
          const sel = (freq.range_start ?? null) === target;
          const label = n === null ? 'Hemen' : n === 7 ? '1 hafta sonra' : '1 ay sonra';
          return (
            <TouchableOpacity
              key={String(n)}
              style={[styles.dayBtn, styles.wideChip, sel && styles.dayBtnSelected]}
              onPress={() => updateFreq(setRangeStart(freq, target))}
              accessibilityRole="radio"
              accessibilityLabel={`Başlangıç: ${label}`}
              accessibilityState={{ selected: sel, checked: sel }}
            >
              <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={[styles.daysRow, { marginTop: 8 }]} accessibilityRole="radiogroup" accessibilityLabel="Bitiş tarihi">
        {([null, 7, 30, 90] as (number | null)[]).map((n) => {
          // "N gün boyunca": inclusive, so the end is base + N - 1.
          const target = n === null ? null : plusDays(rangeBase, n - 1);
          const sel = (freq.range_end ?? null) === target;
          const label = n === null ? 'Süresiz' : `${n} gün`;
          return (
            <TouchableOpacity
              key={String(n)}
              style={[styles.dayBtn, styles.wideChip, sel && styles.dayBtnSelected]}
              onPress={() => updateFreq(setRangeEnd(freq, target))}
              accessibilityRole="radio"
              accessibilityLabel={n === null ? 'Bitiş: süresiz' : `Bitiş: ${n} gün boyunca`}
              accessibilityState={{ selected: sel, checked: sel }}
            >
              <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {rangeSummary(freq) !== '' && <Text style={styles.endHint}>Aralık: {rangeSummary(freq)}</Text>}

      <Text style={[styles.endHint, { marginTop: 12 }]} accessibilityLiveRegion="polite">
        Özet: {frequencySummary(freq)}
      </Text>
      {/* R01.02-e:freq-controls:end */}
    </>
  );
}

// Copied from HabitOnboarding's sheet so the controls look identical in both
// places; HabitOnboarding still uses several of these for its other steps.
const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600', color: colors.white, marginBottom: 10 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15,
    color: colors.white, marginBottom: 14, borderWidth: 1, borderColor: colors.border,
  },
  row: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  freqBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  freqBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  freqBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  freqBtnTextSelected: { color: colors.accent },
  daysRow: { flexDirection: 'row', gap: 6 },
  dayBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  dayBtnSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  wideChip: { paddingHorizontal: 4 },
  dayBtnText: { fontSize: 11, color: colors.textDim, fontWeight: '600' },
  dayBtnTextSelected: { color: colors.white },
  buttonDisabled: { opacity: 0.4 },
  endHint: { fontSize: 12, color: colors.accent, marginTop: 10, fontWeight: '600' },
  endUnit: { fontSize: 13, color: colors.textDim, marginLeft: 10 },
});
