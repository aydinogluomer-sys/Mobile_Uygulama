/**
 * R07.04 — "Miktar ve süre" in the weekly and monthly review: each measured
 * habit's amount against its target, open and partial periods named, all
 * from the R01 engine (lib/periodReport).
 */
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../lib/tokens';
import type { MeasuredRow } from '../lib/periodReport';

export default function MeasuredReportSection({ rows }: { rows: readonly MeasuredRow[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.title}>MİKTAR VE SÜRE</Text>
      {rows.map((r) => (
        <View key={r.id} style={s.row} accessibilityLabel={`${r.name}: ${r.line}`}>
          <Text style={s.name} numberOfLines={1}>{r.name}</Text>
          <Text style={s.line}>{r.line}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginBottom: 24 },
  title: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { flex: 1, fontSize: 14, color: colors.text },
  line: { fontSize: 13, color: colors.textDim },
});
