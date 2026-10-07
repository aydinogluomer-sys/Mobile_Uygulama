/**
 * R07.01 — a journal entry rendered with its light formatting, its tags and
 * the habits those tags link to.
 */
import { View, Text, StyleSheet, TouchableOpacity, type TextStyle } from 'react-native';
import { colors, space, radius } from '../lib/tokens';
import { parseBlocks, extractTags, linkedHabits, type Inline } from '../lib/journalText';

function Line({ inline, style }: { inline: Inline[]; style: TextStyle }) {
  return (
    <Text style={style}>
      {inline.map((p, i) => (
        <Text key={i} style={[p.bold && s.bold, p.italic && s.italic]}>{p.text}</Text>
      ))}
    </Text>
  );
}

export default function JournalBody({ content, habits = [], onOpenHabit, onTag, bodyStyle }: {
  content: string;
  habits?: readonly { id: string; name: string }[];
  onOpenHabit?: (id: string) => void;
  onTag?: (tag: string) => void;
  bodyStyle?: TextStyle;
}) {
  const blocks = parseBlocks(content);
  const tags = extractTags(content);
  const links = linkedHabits(content, habits);
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((b, i) => {
        if (b.kind === 'blank') return <View key={i} style={{ height: 8 }} />;
        if (b.kind === 'heading') return <Line key={i} inline={b.inline} style={StyleSheet.flatten([bodyStyle, s.heading])} />;
        if (b.kind === 'item') {
          return (
            <View key={i} style={s.itemRow}>
              <Text style={bodyStyle}>•</Text>
              <Line inline={b.inline} style={StyleSheet.flatten([bodyStyle, { flex: 1 }])} />
            </View>
          );
        }
        return <Line key={i} inline={b.inline} style={bodyStyle ?? s.para} />;
      })}
      {(tags.length > 0 || links.length > 0) && (
        <View style={s.chips}>
          {links.map((h) => (
            <TouchableOpacity key={h.id} style={[s.chip, s.chipHabit]} onPress={() => onOpenHabit?.(h.id)} disabled={!onOpenHabit}
              accessibilityRole="link" accessibilityLabel={`${h.name} alışkanlığını aç`}>
              <Text style={s.chipText}>↗ {h.name}</Text>
            </TouchableOpacity>
          ))}
          {tags.map((t) => (
            <TouchableOpacity key={t} style={s.chip} onPress={() => onTag?.(t)} disabled={!onTag}
              accessibilityRole="button" accessibilityLabel={`#${t} etiketli kayıtlar`}>
              <Text style={s.chipText}>#{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  para: { fontSize: 15, lineHeight: 23, color: colors.text },
  heading: { fontWeight: '700', fontSize: 17 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  itemRow: { flexDirection: 'row', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipHabit: { borderColor: colors.accent },
  chipText: { fontSize: 12, color: colors.textDim },
});
