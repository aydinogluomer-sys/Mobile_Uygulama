// Küratörlü odak çalma listeleri. Premium kullanıcıda `play-context` ile
// uygulama içinden başlatılır; değilse `openUrl` ile Spotify uygulamasında açılır.
export type FocusPlaylist = {
  id: string;
  name: string;
  emoji: string;
  uri: string;       // spotify:playlist:...  (oynatma context'i)
  openUrl: string;   // https://open.spotify.com/playlist/...  (deep-link fallback)
};

const pl = (id: string, name: string, emoji: string): FocusPlaylist => ({
  id,
  name,
  emoji,
  uri: `spotify:playlist:${id}`,
  openUrl: `https://open.spotify.com/playlist/${id}`,
});

// Spotify'ın resmî/halka açık odak çalma listeleri
export const FOCUS_PLAYLISTS: FocusPlaylist[] = [
  pl('37i9dQZF1DWZeKCadgRdKQ', 'Deep Focus', '🧠'),
  pl('37i9dQZF1DX3rxVfibe1L0', 'Mood Booster', '☀️'),
  pl('37i9dQZF1DWWQRwui0ExPn', 'Lo-Fi Beats', '🎧'),
  pl('37i9dQZF1DX4sWSpwq3LiO', 'Peaceful Piano', '🎹'),
  pl('37i9dQZF1DX8NTLI2TtZa6', 'Instrumental Study', '📚'),
  pl('37i9dQZF1DWXLeA8Omikj7', 'Brain Food', '⚡'),
];
