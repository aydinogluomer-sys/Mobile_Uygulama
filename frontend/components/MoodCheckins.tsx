/**
 * R07.02 + F37 — "Şu an nasılsın?": check in as often as you like, with your
 * own moods, and optionally attach low/high energy on a second tap.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';
import { space, radius, font, hexA, type Palette } from '../lib/tokens';
import { EmbeddedFiligree } from './spatial';
import Chip from './ui/Chip';
import { DECOR } from '../lib/visualAssets';
import { useMoodStore } from '../store/moodStore';
import {
  checkinLabel,
  ENERGY_COPY,
  MOOD_ENERGY_LABEL,
  type MoodEnergy,
} from '../lib/moods';

export default function MoodCheckins() {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const {
    definitions,
    checkins,
    hydrate,
    moods,
    addDefinition,
    checkIn,
    setCheckinEnergy,
    removeCheckin,
    getToday,
  } = useMoodStore(
    useShallow((state) => ({
      definitions: state.definitions,
      checkins: state.checkins,
      hydrate: state.hydrate,
      moods: state.moods,
      addDefinition: state.addDefinition,
      checkIn: state.checkIn,
      setCheckinEnergy: state.setCheckinEnergy,
      removeCheckin: state.removeCheckin,
      getToday: state.today,
    })),
  );
  const [intensity, setIntensity] = useState<1 | 2 | 3>(2);
  const [lastId, setLastId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [valence, setValence] = useState(3);
  const [defEnergy, setDefEnergy] = useState<MoodEnergy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const today = getToday();
  const pendingCheckin = lastId ? checkins.find((item) => item.id === lastId) : undefined;
  const showEnergyPrompt = Boolean(pendingCheckin && !pendingCheckin.energy);

  function add() {
    const r = addDefinition(name, icon, valence, defEnergy ?? undefined);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setName('');
    setIcon('');
    setValence(3);
    setDefEnergy(null);
    setAdding(false);
    setError(null);
  }

  return (
    <View style={s.box}>
      <EmbeddedFiligree source={DECOR.cornerBotanical} size={96} opacity={0.14} />
      <Text style={s.head} accessibilityRole="header">ŞU AN NASILSIN?</Text>
      <View style={s.row}>
        {moods().map((m) => (
          <TouchableOpacity
            key={m.id}
            style={s.mood}
            onPress={() => {
              const ok = checkIn(m.id, intensity);
              if (ok) {
                setLastId(useMoodStore.getState().checkins[0]?.id ?? null);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={`${m.name} olarak kaydet`}
          >
            <Text style={s.icon}>{m.icon}</Text>
            <Text style={s.name} numberOfLines={1}>{m.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={s.mood}
          onPress={() => setAdding((a) => !a)}
          accessibilityRole="button"
          accessibilityLabel="Yeni duygu ekle"
        >
          <Text style={s.icon}>＋</Text>
          <Text style={s.name}>Ekle</Text>
        </TouchableOpacity>
      </View>

      {showEnergyPrompt && pendingCheckin && (
        <View style={s.row}>
          <Text style={s.sub}>{ENERGY_COPY.ask}</Text>
          <Chip
            label={ENERGY_COPY.low}
            color={c.accent}
            onPress={() => {
              setCheckinEnergy(pendingCheckin.id, 'low');
              setLastId(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Enerji düşük olarak ekle"
            style={s.energyChip}
          />
          <Chip
            label={ENERGY_COPY.high}
            color={c.accent}
            onPress={() => {
              setCheckinEnergy(pendingCheckin.id, 'high');
              setLastId(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Enerji yüksek olarak ekle"
            style={s.energyChip}
          />
          <Chip
            label={ENERGY_COPY.skip}
            color={c.textDim}
            onPress={() => setLastId(null)}
            accessibilityRole="button"
            accessibilityLabel="Enerji sormasını geç"
            style={s.energyChip}
          />
        </View>
      )}

      <View style={s.row}>
        <Text style={s.sub}>Yoğunluk:</Text>
        {([1, 2, 3] as const).map((i) => (
          <TouchableOpacity
            key={i}
            style={[s.chip, intensity === i && s.chipOn]}
            onPress={() => setIntensity(i)}
            accessibilityRole="button"
            accessibilityState={{ selected: intensity === i }}
            accessibilityLabel={`Yoğunluk ${i}`}
          >
            <Text style={s.sub}>{['hafif', 'orta', 'güçlü'][i - 1]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {adding && (
        <View style={s.formWrap}>
          <View style={s.row}>
            <TextInput
              style={[s.input, s.iconInput]}
              value={icon}
              onChangeText={setIcon}
              placeholder="🙂"
              placeholderTextColor={c.textFaint}
              maxLength={4}
              accessibilityLabel="Duygu ikonu"
            />
            <TextInput
              style={[s.input, s.nameInput]}
              value={name}
              onChangeText={setName}
              placeholder="Ad (ör. Huzurlu)"
              placeholderTextColor={c.textFaint}
              maxLength={24}
              accessibilityLabel="Duygu adı"
            />
          </View>
          <View style={s.row}>
            <Text style={s.sub}>Değer:</Text>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity
                key={v}
                style={[s.chip, valence === v && s.chipOn]}
                onPress={() => setValence(v)}
                accessibilityRole="button"
                accessibilityState={{ selected: valence === v }}
                accessibilityLabel={`Değer ${v}`}
              >
                <Text style={s.sub}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.row}>
            <Text style={s.sub}>Enerji:</Text>
            <Chip
              label="Belirtme"
              selected={defEnergy === null}
              color={defEnergy === null ? c.accent : c.textDim}
              onPress={() => setDefEnergy(null)}
              accessibilityRole="button"
              accessibilityLabel="Varsayılan enerji: Belirtme"
              style={s.energyChip}
            />
            <Chip
              label={ENERGY_COPY.low}
              selected={defEnergy === 'low'}
              color={defEnergy === 'low' ? c.accent : c.textDim}
              onPress={() => setDefEnergy('low')}
              accessibilityRole="button"
              accessibilityLabel="Varsayılan enerji: Düşük"
              style={s.energyChip}
            />
            <Chip
              label={ENERGY_COPY.high}
              selected={defEnergy === 'high'}
              color={defEnergy === 'high' ? c.accent : c.textDim}
              onPress={() => setDefEnergy('high')}
              accessibilityRole="button"
              accessibilityLabel="Varsayılan enerji: Yüksek"
              style={s.energyChip}
            />
          </View>
          <TouchableOpacity style={s.save} onPress={add} accessibilityRole="button" accessibilityLabel="Duyguyu ekle">
            <Text style={s.saveText}>Ekle</Text>
          </TouchableOpacity>
          {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        </View>
      )}

      {today.length > 0 && (
        <View style={s.todayList}>
          {today.map((item) => (
            <View key={item.id} style={s.checkRow}>
              <Text style={s.checkText}>
                {new Date(item.at).toTimeString().slice(0, 5)} · {checkinLabel(item, definitions)} · {['hafif', 'orta', 'güçlü'][item.intensity - 1]}{item.energy ? ` · ${MOOD_ENERGY_LABEL[item.energy]}` : ''}
              </Text>
              <TouchableOpacity
                onPress={() => removeCheckin(item.id)}
                accessibilityRole="button"
                accessibilityLabel="Bu kaydı sil"
              >
                <Text style={s.remove}>Sil</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <Text style={s.note}>Bu kayıtlar şimdilik yalnız bu cihazda (sunucu güncellemesi bekleniyor).</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    box: {
      padding: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: hexA(c.surface, 0.88),
      gap: space.sm,
      marginBottom: space.xl,
      overflow: 'hidden',
      position: 'relative',
    },
    head: { ...font.overline, color: c.textFaint },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
    formWrap: { gap: space.sm },
    todayList: { gap: space.xs },
    mood: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 58,
      minHeight: 44,
      paddingVertical: space.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    icon: { ...font.h2 },
    name: { ...font.caption, color: c.textFaint },
    sub: { ...font.caption, color: c.textDim },
    chip: {
      paddingVertical: space.xs,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipOn: { borderColor: c.accent, backgroundColor: c.surfaceAlt },
    energyChip: {
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: radius.md,
    },
    input: {
      ...font.bodySm,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: space.sm,
      color: c.text,
      minHeight: 44,
    },
    iconInput: { width: 60 },
    nameInput: { flex: 1 },
    save: {
      alignSelf: 'flex-start',
      minHeight: 44,
      justifyContent: 'center',
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      backgroundColor: c.accent,
    },
    saveText: { ...font.bodySm, color: c.bg, fontWeight: '700' },
    error: { ...font.caption, color: c.error },
    checkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 },
    checkText: { ...font.caption, color: c.text, flex: 1 },
    remove: { ...font.caption, color: c.textFaint },
    note: { ...font.caption, color: c.textFaint },
  });
