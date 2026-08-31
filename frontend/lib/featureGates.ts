/**
 * Capabilities the app deliberately withholds, and what has to be true to
 * give them back.
 *
 * A gate lives here rather than in an env var on purpose: an env var can be
 * flipped by whoever runs the build, and these are switched off for reasons
 * that are only resolved by someone deploying something and checking it.
 * Turning one back on should be a reviewed diff sitting next to the evidence
 * that earned it.
 */

/**
 * Starting a NEW Spotify OAuth connection.
 *
 * ## Why this is off
 *
 * The `spotify-auth` edge function DEPLOYED to production is not the one in
 * this repository. `supabase/functions/spotify-auth` signs its OAuth `state`
 * with `OAUTH_STATE_SECRET`, verifies it on the callback, binds it to the
 * caller's uid, and refuses any `redirect_uri` outside
 * `OAUTH_REDIRECT_ALLOWLIST`. The deployed build (version 2,
 * `ezbr_sha256 977309e1…`) does none of that. Probed live against production:
 *
 *     action=url  -> state is a bare 36-char UUID, not `<payload>.<signature>`
 *     callback    -> never reads `state` at all; no CSRF check exists
 *     redirect_uri=https://attacker.example/steal
 *                 -> 200, and the returned authorize URL points AT IT
 *
 * That last one is the sharp edge. An attacker who can get a victim to open a
 * crafted link receives the victim's Spotify authorization code, because the
 * deployed function will mint an authorize URL for any redirect target it is
 * handed. The deployed source also carries a hardcoded client-secret fallback,
 * so that secret must be treated as leaked and rotated.
 *
 * Shipping the button anyway would mean knowingly walking new users into that.
 * A feature that is securely unavailable is better than one that works and is
 * unsafe, and saying so in the UI is better than a button that fails.
 *
 * ## What must be true before this becomes `true`
 *
 * 1. the Spotify client secret is ROTATED (the deployed one is compromised);
 * 2. `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `OAUTH_STATE_SECRET` and
 *    `OAUTH_REDIRECT_ALLOWLIST` are set as edge secrets;
 * 3. `supabase/functions/spotify-auth` from THIS tree is deployed;
 * 4. re-probed live: the state is signed, a tampered state is refused, an
 *    unallowlisted `redirect_uri` is refused, and one account's state does not
 *    verify for another.
 *
 * ## What this does NOT touch
 *
 * An account that is ALREADY connected keeps working — playback runs on stored
 * tokens and never re-enters the OAuth flow, and `disconnect` must stay
 * reachable so anyone who connected under the old build can get out. The gate
 * is on starting a new authorization, which is the only place the defect is
 * reachable.
 */
export const SPOTIFY_OAUTH_ENABLED = false;

/** Shown where the connect button used to be. */
export const SPOTIFY_OAUTH_DISABLED_REASON =
  'Spotify bağlantısı güvenlik bakımı nedeniyle geçici olarak kapalı.';
