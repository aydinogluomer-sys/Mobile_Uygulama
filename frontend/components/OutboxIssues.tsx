/**
 * R02.04 / R02.05 — the task changes that could not be delivered, each with
 * a real way out. Unlike the habit-log badge (whose dead ops are only revived
 * by a new tap), an outbox command can be retried or given up from here:
 *
 *   conflict  the task was changed elsewhere since this edit was made. It is
 *             never applied silently. "Benimkini uygula" re-sends it over the
 *             server's current version; "Bu değişikliği bırak" drops the local edit.
 *   dead      the server refused it MAX_ATTEMPTS times. "Yeniden dene" or drop.
 *
 * F05: the same words as the sync sheet's "Gönderilemeyenler" list, and 44 pt
 * touch targets (the text buttons were smaller).
 *
 * Renders nothing when there is nothing to resolve.
 */
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius } from '../lib/tokens';
import { useTaskStore } from '../store/taskStore';

export default function OutboxIssues() {
  const { outbox, tasks, retryChange, discardChange } = useTaskStore();
  const issues = (outbox?.commands ?? []).filter((c) => c.status !== 'pending');
  if (issues.length === 0) return null;

  return (
    <View style={s.box} accessibilityRole="summary">
      <Text style={s.head}>EŞİTLENEMEYEN DEĞİŞİKLİKLER · {issues.length}</Text>
      {issues.map((c) => {
        const title = tasks.find((t) => t.id === c.entityId)?.title ?? (c.payload.title as string | undefined) ?? 'Görev';
        const what = c.kind === 'create' ? 'eklendi' : c.kind === 'delete' ? 'silindi' : 'değişti';
        const why = c.status === 'conflict' ? 'Başka bir yerde değiştirilmiş.' : (c.lastError ?? 'Sunucu kabul etmedi.');
        return (
          <View key={c.operationId} style={s.row}>
            <Ionicons name={c.status === 'conflict' ? 'git-compare-outline' : 'alert-circle-outline'} size={16} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>{title} — {what}</Text>
              <Text style={s.why} numberOfLines={2}>{why}</Text>
            </View>
            <TouchableOpacity
              style={s.btn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => retryChange(c.operationId)}
              accessibilityRole="button"
              accessibilityLabel={c.status === 'conflict' ? `${title}: benim değişikliğimi uygula` : `${title}: yeniden dene`}
            >
              <Text style={s.act}>{c.status === 'conflict' ? 'Benimkini uygula' : 'Yeniden dene'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.btn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => discardChange(c.operationId)}
              accessibilityRole="button"
              accessibilityLabel={`${title}: bu değişikliği bırak`}
            >
              <Text style={s.drop}>Bu değişikliği bırak</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: space.md, gap: space.sm, marginBottom: space.md },
  head: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.warning },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontSize: 13, color: colors.text, fontWeight: '600' },
  why: { fontSize: 12, color: colors.textFaint },
  btn: { minHeight: 44, justifyContent: 'center' },
  act: { fontSize: 12, color: colors.accent, fontWeight: '700' },
  drop: { fontSize: 12, color: colors.textFaint, fontWeight: '600' },
});
