import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, ScrollView, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSpotifyStore } from '../../store/spotifyStore';
import { FOCUS_PLAYLISTS, type FocusPlaylist } from '../../lib/spotifyFocus';
import { haptic } from '../../lib/haptics';
import { colors } from '../../lib/tokens';
import { SPOTIFY_OAUTH_ENABLED, SPOTIFY_OAUTH_DISABLED_REASON } from '../../lib/featureGates';

const SPOTIFY = '#1DB954';

export default function FocusSpotifyCard() {
  const {
    connection, status, error, nowPlaying, busy,
    fetchStatus, connect, disconnect, fetchNowPlaying, play, pause, next, previous, playContext,
  } = useSpotifyStore();
  const [hint, setHint] = useState('');
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showHint(msg: string) {
    setHint(msg);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(''), 3000);
  }

  // Durum + now-playing yoklaması
  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => {
    if (!connection) return;
    fetchNowPlaying();
    const id = setInterval(fetchNowPlaying, 8000);
    return () => clearInterval(id);
  }, [connection, fetchNowPlaying]);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  async function onPlaylist(p: FocusPlaylist) {
    haptic.select();
    const err = await playContext(p.uri);
    if (err === 'no_active_device') { showHint('Spotify’ı bir cihazda aç, sonra tekrar dene.'); Linking.openURL(p.openUrl).catch(() => {}); }
    else if (err === 'premium_required') { showHint('Uygulama içi oynatma Premium gerektirir — Spotify’da açılıyor.'); Linking.openURL(p.openUrl).catch(() => {}); }
    else if (err) { Linking.openURL(p.openUrl).catch(() => {}); }
    else { showHint(`▶ ${p.name}`); }
  }

  async function togglePlay() {
    haptic.light();
    if (nowPlaying?.isPlaying) await pause();
    else await play();
  }

  // ── Bağlanma kapalı ──────────────────────────────────────────────────────
  //
  // Honest unavailability, not a button that fails. The reason is stated
  // instead of hidden: a feature that silently disappears reads as a bug, and
  // a button that errors on tap wastes the user's attempt. The real refusal is
  // in `spotifyStore.connect()`; this is what the person sees.
  if (!connection && !SPOTIFY_OAUTH_ENABLED) {
    return (
      <View style={s.card}>
        <View style={s.connectRow}>
          <View style={[s.logo, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="musical-notes" size={20} color={colors.textFaint} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.connectTitle}>Spotify</Text>
            <Text style={s.connectSub}>{SPOTIFY_OAUTH_DISABLED_REASON}</Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Bağlı değil ──────────────────────────────────────────────────────────
  if (!connection) {
    return (
      <View style={s.card}>
        <View style={s.connectRow}>
          <View style={[s.logo, { backgroundColor: SPOTIFY + '22' }]}>
            <Ionicons name="musical-notes" size={20} color={SPOTIFY} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.connectTitle}>Spotify</Text>
            <Text style={s.connectSub}>Çalışırken müzik dinle</Text>
          </View>
          <TouchableOpacity
            style={[s.connectBtn, { backgroundColor: SPOTIFY }, status === 'connecting' && { opacity: 0.6 }]}
            onPress={() => { haptic.medium(); connect(); }}
            disabled={status === 'connecting'}
          >
            {status === 'connecting'
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="logo-google" size={15} color="#000" />}
            <Text style={s.connectBtnText}>{status === 'connecting' ? 'Bağlanıyor…' : 'Bağlan'}</Text>
          </TouchableOpacity>
        </View>
        {status === 'error' && error ? <Text style={s.err}>{error}</Text> : null}
      </View>
    );
  }

  // ── Bağlı: mini oynatıcı ─────────────────────────────────────────────────
  const hasTrack = !!nowPlaying?.name;
  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Ionicons name="musical-notes" size={14} color={SPOTIFY} />
        <Text style={s.headerName} numberOfLines={1}>{connection.displayName}</Text>
        {connection.product === 'premium' ? <Text style={s.premium}>PREMIUM</Text> : null}
        <TouchableOpacity hitSlop={8} onPress={() => { haptic.light(); disconnect(); }}>
          <Ionicons name="close-circle-outline" size={18} color={colors.textGhost} />
        </TouchableOpacity>
      </View>

      <View style={s.playerRow}>
        {nowPlaying?.albumArt
          ? <Image source={{ uri: nowPlaying.albumArt }} style={s.art} />
          : <View style={[s.art, s.artEmpty]}><Ionicons name="disc-outline" size={20} color={colors.textGhost} /></View>}
        <View style={{ flex: 1 }}>
          <Text style={s.trackName} numberOfLines={1}>{hasTrack ? nowPlaying!.name : 'Bir şey çalmıyor'}</Text>
          <Text style={s.trackArtist} numberOfLines={1}>{hasTrack ? nowPlaying!.artists : 'Aşağıdan bir odak listesi seç'}</Text>
        </View>
        <View style={s.controls}>
          <TouchableOpacity hitSlop={6} onPress={() => { haptic.light(); previous(); }} disabled={busy}>
            <Ionicons name="play-skip-back" size={20} color={colors.textDim} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.playBtn, { backgroundColor: SPOTIFY }]} onPress={togglePlay} disabled={busy}>
            {busy
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name={nowPlaying?.isPlaying ? 'pause' : 'play'} size={18} color="#000" />}
          </TouchableOpacity>
          <TouchableOpacity hitSlop={6} onPress={() => { haptic.light(); next(); }} disabled={busy}>
            <Ionicons name="play-skip-forward" size={20} color={colors.textDim} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {FOCUS_PLAYLISTS.map((p) => (
          <TouchableOpacity key={p.id} style={s.chip} onPress={() => onPlaylist(p)}>
            <Text style={s.chipText}>{p.emoji} {p.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    padding: 14, marginBottom: 20, gap: 12,
  },

  // Bağlan
  connectRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  connectTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  connectSub: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  connectBtnText: { fontSize: 13, fontWeight: '800', color: colors.black },
  err: { fontSize: 11, color: colors.error, lineHeight: 16 },

  // Oynatıcı
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerName: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textDim },
  premium: { fontSize: 9, fontWeight: '800', color: SPOTIFY, letterSpacing: 0.5, borderWidth: 1, borderColor: SPOTIFY + '55', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },

  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  art: { width: 48, height: 48, borderRadius: 8 },
  artEmpty: { backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  trackName: { fontSize: 14, fontWeight: '700', color: colors.text },
  trackArtist: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textDim },

  hint: { fontSize: 11, color: SPOTIFY, lineHeight: 16 },
});
