/**
 * The confirmation barrier, as a screen the user actually reads.
 *
 * Nothing in AI Coach writes until a finger lands on a button in this card.
 * That is the entire contract: the model proposes, `lib/coachActions.ts`
 * validates, the habit is resolved against the user's OWN rows, and then this
 * card states — in plain words, not prose the model wrote — exactly what is
 * about to happen and to which habit on which day.
 *
 * Two rules shape everything here:
 *
 *   NAME THE TARGET  the card always shows the habit, the date and the
 *                    completion. "Evet" buried in a sentence is not consent
 *                    when the thing being consented to was inferred.
 *   NEVER GUESS      if two of the user's habits plausibly match, this asks
 *                    which one instead of picking. Writing to the wrong habit
 *                    is a silent error the user may never notice.
 */
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, alphaHex } from '../../lib/tokens';
import type { Habit } from '../../lib/supabase';
import type { CoachLogCompletion } from '../../lib/coachActions';
import type { ProposalEvaluation } from '../../lib/routineProposal';

export type StagedCoachAction =
  /** A habit or plan, already staged in routineStore and capacity-evaluated. */
  | { kind: 'proposal'; title: string; habitNames: string[]; evaluation: ProposalEvaluation | null }
  /** One resolved habit, ready to log. */
  | { kind: 'log'; habit: Habit; date: string; completion: CoachLogCompletion }
  /** Two or more of the user's habits matched. Ask, do not choose. */
  | { kind: 'ambiguous'; candidates: Habit[]; date: string; completion: CoachLogCompletion }
  /** Nothing matched. Offer to create rather than silently doing nothing. */
  | { kind: 'nomatch'; query: string }
  /** Validation refused the proposal. Say so; never fall through to a write. */
  | { kind: 'invalid'; reasons: string[] };

type Props = {
  staged: StagedCoachAction;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onPickCandidate?: (habit: Habit) => void;
};

/** Human date, without pulling in a formatter for three cases. */
function dateLabel(ymd: string, today: string, yesterday: string): string {
  if (ymd === today) return 'bugün';
  if (ymd === yesterday) return 'dün';
  return ymd;
}

export function describeCompletion(c: CoachLogCompletion, habit: Habit): string {
  if (c.kind === 'state') {
    return c.state === 'done' ? 'tamamlandı'
      : c.state === 'partial' ? 'kısmen yapıldı'
      : c.state === 'skip' ? 'pas geçildi'
      : 'yapılmadı';
  }
  const unit = habit.unit ? ` ${habit.unit}` : '';
  const target = habit.daily_goal != null ? ` / ${habit.daily_goal}${unit}` : unit;
  return `${c.value}${target}`;
}

export default function CoachActionCard({ staged, busy, onConfirm, onCancel, onPickCandidate }: Props) {
  if (staged.kind === 'invalid') {
    return (
      <View style={[s.card, s.cardWarn]} accessibilityRole="alert">
        <Text style={s.warnTitle}>Bu öneri uygulanamadı</Text>
        {staged.reasons.slice(0, 3).map((r) => (
          <Text key={r} style={s.warnText}>• {r}</Text>
        ))}
        <View style={s.row}>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Öneriyi kapat">
            <Text style={s.ghostText}>Kapat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'nomatch') {
    return (
      <View style={s.card}>
        <Text style={s.title}>Eşleşen alışkanlık yok</Text>
        <Text style={s.body}>
          “{staged.query}” adında bir alışkanlığın görünmüyor. Yazarak yeni bir alışkanlık isteyebilirsin.
        </Text>
        <View style={s.row}>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Kapat">
            <Text style={s.ghostText}>Kapat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'ambiguous') {
    return (
      <View style={s.card}>
        <Text style={s.title}>Hangisini kastettin?</Text>
        <Text style={s.body}>Birden fazla alışkanlık eşleşti. Yanlışına işlememek için soruyorum.</Text>
        <View style={s.chipWrap}>
          {staged.candidates.map((h) => (
            <TouchableOpacity
              key={h.id}
              style={s.chip}
              onPress={() => onPickCandidate?.(h)}
              accessibilityRole="button"
              accessibilityLabel={`${h.name} alışkanlığını seç`}
            >
              <Text style={s.chipText}>{h.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.row}>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Vazgeç">
            <Text style={s.ghostText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (staged.kind === 'log') {
    const today = new Date();
    const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    return (
      <View style={s.card}>
        <Text style={s.title}>Kaydı onayla</Text>
        {/* The three facts the user is actually consenting to. */}
        <View style={s.factRow}><Text style={s.factKey}>Alışkanlık</Text><Text style={s.factVal}>{staged.habit.name}</Text></View>
        <View style={s.factRow}><Text style={s.factKey}>Tarih</Text><Text style={s.factVal}>{dateLabel(staged.date, t, yStr)}</Text></View>
        <View style={s.factRow}><Text style={s.factKey}>Durum</Text><Text style={s.factVal}>{describeCompletion(staged.completion, staged.habit)}</Text></View>
        <View style={s.row}>
          <TouchableOpacity
            style={[s.primaryBtn, busy && s.btnDisabled]}
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Kaydı işle"
            accessibilityState={{ disabled: !!busy, busy: !!busy }}
          >
            {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={s.primaryText}>İşle</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel="Vazgeç">
            <Text style={s.ghostText}>Vazgeç</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // proposal
  const activate = staged.evaluation?.toActivate ?? [];
  const queue = staged.evaluation?.toQueue ?? [];
  return (
    <View style={s.card}>
      <Text style={s.title}>{staged.title}</Text>
      <Text style={s.body}>{staged.habitNames.length} alışkanlık eklenecek:</Text>
      {staged.habitNames.map((n) => (
        <View key={n} style={s.factRow}>
          <Text style={s.factVal}>• {n}</Text>
          {queue.includes(n) ? <Text style={s.queued}>sırada</Text> : activate.includes(n) ? <Text style={s.active}>aktif</Text> : null}
        </View>
      ))}
      {queue.length > 0 && (
        // Not a warning: queueing is the capacity engine protecting the day,
        // and saying so is more honest than silently activating everything.
        <Text style={s.note}>Günlük yükü aşanlar “sırada” olarak eklenir, kapasite açılınca aktifleşir.</Text>
      )}
      <View style={s.row}>
        <TouchableOpacity
          style={[s.primaryBtn, busy && s.btnDisabled]}
          onPress={onConfirm}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Onayla ve alışkanlıkları ekle"
          accessibilityState={{ disabled: !!busy, busy: !!busy }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={s.primaryText}>Onayla ve Ekle</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.ghostBtn} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel="Vazgeç">
          <Text style={s.ghostText}>Vazgeç</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  cardWarn: { backgroundColor: alphaHex(colors.error, '12'), borderColor: alphaHex(colors.error, '30') },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  body: { fontSize: 13, color: colors.textDim, lineHeight: 18 },
  note: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  warnTitle: { fontSize: 14, fontWeight: '700', color: colors.error },
  warnText: { fontSize: 12, color: colors.error, lineHeight: 17 },
  factRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  factKey: { fontSize: 12, color: colors.textFaint },
  factVal: { fontSize: 14, color: colors.text, fontWeight: '600', flexShrink: 1 },
  active: { fontSize: 11, color: colors.success, fontWeight: '700' },
  queued: { fontSize: 11, color: colors.warning, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surfaceAlt,
  },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10, minHeight: 44,
    alignItems: 'center', justifyContent: 'center', flexGrow: 1,
  },
  btnDisabled: { opacity: 0.6 },
  primaryText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: colors.textDim, fontWeight: '600', fontSize: 14 },
});
