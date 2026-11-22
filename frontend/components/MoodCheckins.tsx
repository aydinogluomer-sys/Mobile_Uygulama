/**
 * R07.02 — "Şu an nasılsın?": check in as often as you like, with your own
 * moods. Each check-in keeps the mood's name and value as they were.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { colors, space, radius, hexA } from '../lib/tokens';
import { EmbeddedFiligree } from './spatial';
import { DECOR } from '../lib/visualAssets';
import { useMoodStore } from '../store/moodStore';
import { checkinLabel } from '../lib/moods';

export default function MoodCheckins() {
  const st = useMoodStore();
  const [intensity, setIntensity] = useState<1 | 2 | 3>(2);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [valence, setValence] = useState(3);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void st.hydrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const today = st.today();

  function add() {
    const r = st.addDefinition(name, icon, valence);
    if (!r.ok) { setError(r.error); return; }
    setName(''); setIcon(''); setValence(3); setAdding(false); setError(null);
  }

  return (
    <View style={s.box}>
      <EmbeddedFiligree source={DECOR.cornerBotanical} size={96} opacity={0.14} />
      <Text style={s.head} accessibilityRole="header">ŞU AN NASILSIN?</Text>
      <View style={s.row}>
        {st.moods().map((m) => (
          <TouchableOpacity key={m.id} style={s.mood} onPress={() => st.checkIn(m.id, intensity)} accessibilityRole="button" accessibilityLabel={`${m.name} olarak kaydet`}>
            <Text style={s.icon}>{m.icon}</Text>
            <Text style={s.name} numberOfLines={1}>{m.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.mood} onPress={() => setAdding((a) => !a)} accessibilityRole="button" accessibilityLabel="Yeni duygu ekle">
          <Text style={s.icon}>＋</Text>
          <Text style={s.name}>Ekle</Text>
        </TouchableOpacity>
      </View>
      <View style={s.row}>
        <Text style={s.sub}>Yoğunluk:</Text>
        {([1, 2, 3] as const).map((i) => (
          <TouchableOpacity key={i} style={[s.chip, intensity === i && s.chipOn]} onPress={() => setIntensity(i)} accessibilityRole="button" accessibilityState={{ selected: intensity === i }} accessibilityLabel={`Yoğunluk ${i}`}>
            <Text style={s.sub}>{['hafif', 'orta', 'güçlü'][i - 1]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {adding && (
        <View style={{ gap: space.sm }}>
          <View style={s.row}>
            <TextInput style={[s.input, { width: 60 }]} value={icon} onChangeText={setIcon} placeholder="🙂" placeholderTextColor={colors.textFaint} maxLength={4} accessibilityLabel="Duygu ikonu" />
            <TextInput style={[s.input, { flex: 1 }]} value={name} onChangeText={setName} placeholder="Ad (ör. Huzurlu)" placeholderTextColor={colors.textFaint} maxLength={24} accessibilityLabel="Duygu adı" />
          </View>
          <View style={s.row}>
            <Text style={s.sub}>Değer:</Text>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity key={v} style={[s.chip, valence === v && s.chipOn]} onPress={() => setValence(v)} accessibilityRole="button" accessibilityState={{ selected: valence === v }} accessibilityLabel={`Değer ${v}`}>
                <Text style={s.sub}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.save} onPress={add} accessibilityRole="button" accessibilityLabel="Duyguyu ekle"><Text style={s.saveText}>Ekle</Text></TouchableOpacity>
          {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        </View>
      )}
      {today.length > 0 && (
        <View style={{ gap: 4 }}>
          {today.map((c) => (
            <View key={c.id} style={s.checkRow}>
              <Text style={s.checkText}>{new Date(c.at).toTimeString().slice(0, 5)} · {checkinLabel(c, st.definitions)} · {['hafif', 'orta', 'güçlü'][c.intensity - 1]}</Text>
              <TouchableOpacity onPress={() => st.removeCheckin(c.id)} accessibilityRole="button" accessibilityLabel="Bu kaydı sil"><Text style={s.remove}>Sil</Text></TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Text style={s.note}>Bu kayıtlar şimdilik yalnız bu cihazda (sunucu güncellemesi bekleniyor).</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: hexA(colors.surface, 0.88), gap: 8, marginBottom: 20, overflow: 'hidden', position: 'relative' },
  head: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: colors.textFaint },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  mood: { alignItems: 'center', width: 58, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  icon: { fontSize: 20 },
  name: { fontSize: 10, color: colors.textFaint },
  sub: { fontSize: 12, color: colors.textDim },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 8, color: colors.text },
  save: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.accent },
  saveText: { color: colors.bg, fontWeight: '700' },
  error: { fontSize: 12, color: colors.error },
  checkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  checkText: { fontSize: 12, color: colors.text, flex: 1 },
  remove: { fontSize: 12, color: colors.textFaint },
  note: { fontSize: 11, color: colors.textFaint },
});
