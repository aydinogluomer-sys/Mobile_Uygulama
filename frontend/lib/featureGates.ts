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
// Owner scope decision 2026-09-13 (docs/plan/21_KAPSAM_EKI_2026-09-13.md §6.1): MVP DIŞI / ERTELENDİ.
// Do not flip without a new, explicit owner decision.
export const SPOTIFY_OAUTH_ENABLED = false;

/** Shown where the connect button used to be. */
export const SPOTIFY_OAUTH_DISABLED_REASON =
  'Spotify bağlantısı güvenlik bakımı nedeniyle geçici olarak kapalı.';

/**
 * Connecting a Notion workspace, and connecting a Google Calendar.
 *
 * ## Why these are off
 *
 * Neither works in production, and both were advertised as if they did.
 * A Step-9 audit compared this repository against the live project and found
 * the client offering `status: 'available'` for two integrations whose
 * backends were not there:
 *
 *     google-auth  never deployed at all. Probed live: 404 NOT_FOUND, so
 *                  every action -- status, url, callback, disconnect --
 *                  failed. The screen called it on mount, which meant opening
 *                  Integrations fired a 404 before the user touched anything.
 *     notion-auth  deployed, but the pre-hardening build. Probed live, it
 *                  answered with `state` as a bare 36-char UUID that nothing
 *                  verifies, no redirect allowlist enforcement, and
 *                  `client_id=undefined` -- so even the happy path ended at a
 *                  Notion error page.
 *
 * The cause is the same for both and it is not code: `GOOGLE_CLIENT_ID`,
 * `GOOGLE_CLIENT_SECRET`, `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`,
 * `OAUTH_STATE_SECRET` and `OAUTH_REDIRECT_ALLOWLIST` are all absent from the
 * project's edge secrets. The hardened implementations in
 * `supabase/functions/{google,notion}-auth` are finished and tested; they have
 * nothing to authenticate with.
 *
 * The owner's decision was therefore to ship the MVP without them rather than
 * guess at credentials. A feature that is honestly unavailable is better than
 * one that is advertised and fails.
 *
 * ## What must be true before these become `true`
 *
 * 1. the six values above are configured as edge secrets;
 * 2. `supabase/functions/google-auth` and `notion-auth` from THIS tree are
 *    deployed (`tools/verify-edge-deployment.mjs` reports them MISSING today);
 * 3. re-probed live: state is signed, a tampered state is refused, an
 *    unallowlisted `redirect_uri` is refused before any token exchange, and
 *    one account's state does not verify for another;
 * 4. `supabase/functions/DEPLOYMENT.json` flips them back to `deploy: true`.
 *
 * ## What this does NOT touch
 *
 * The backend source stays. So do the stores, the callback handling and the
 * catalog entries -- this is an availability decision, not a deletion. When
 * the credentials exist, turning these two constants back on plus a deploy is
 * the whole change.
 *
 * Nobody is mid-connection: `notion_integrations` and
 * `google_calendar_integrations` were both empty when this was written, so
 * unlike Spotify there is not even a connected-user path to preserve.
 */
// Owner scope decision 2026-09-13 (docs/plan/21_KAPSAM_EKI_2026-09-13.md §6.1): both ERTELENDİ.
// Do not flip without a new, explicit owner decision.
export const NOTION_INTEGRATION_ENABLED = false;
export const GOOGLE_CALENDAR_INTEGRATION_ENABLED = false;

/** Neutral, truthful, and deliberately promises no date. */
export const INTEGRATION_UNAVAILABLE_REASON =
  'Bu entegrasyon bu sürümde henüz kullanılamıyor.';

/**
 * Buying a paid subscription tier.
 *
 * ## Why this is off
 *
 * The owner's decision for the MVP is FREE. Until that changes there is no
 * in-app purchase in this app at all: no StoreKit product, no Play Billing
 * product, no entitlement source other than the server-side grant, and no
 * payment processor.
 *
 * What made this a release blocker rather than a preference is what the app
 * used to show anyway. `screens/paywall.tsx` advertised Nexus Plus and Nexus
 * Pro with weekly/monthly/yearly prices, an "Abone Ol" button, and a footnote
 * reading "Test modu: Abone Ol su an krediyi hemen yukler. Gercek odeme ...
 * yayina cikmadan eklenecek." In a release build the button could only raise
 * "purchase is not available", because `mock_activate_subscription` had its
 * EXECUTE revoked server-side in `003_emergency_gate_0_revoke_mock_activate_subscription`.
 *
 * So a reviewer would have seen a price, a buy button that cannot buy, and an
 * internal note about unfinished work. Apple 3.1.1 and Google Play's payments
 * policy both reject that shape, and independently of the stores it is simply
 * untrue.
 *
 * ## What must be true before this becomes `true`
 *
 * 1. the owner decides PAID and picks the billing layer (native IAP or a
 *    service such as RevenueCat) -- this is a product and vendor decision,
 *    not a code one;
 * 2. real products exist in App Store Connect and Play Console with prices
 *    that match whatever `lib/subscription.ts` renders;
 * 3. purchases are verified SERVER-side and entitlement is written by the
 *    service role only, never by the client;
 * 4. restore, upgrade/downgrade, cancellation and expiry all work, and
 *    "Manage subscription" is reachable from the app;
 * 5. the store listings declare in-app purchases, and the privacy inventory
 *    gains the payment processor.
 *
 * ## What this does NOT touch
 *
 * Focus Point economics are unchanged: the free grant, the per-action costs
 * (`ACTION_COST`) and the monthly renewal all keep working exactly as before
 * -- the FREE tier was always the one funded by the server-side grant. The
 * tier definitions in `lib/subscription.ts` stay too, prices included, so
 * that turning this back on is a rendering change rather than an
 * archaeology exercise. This is an availability decision, not a deletion.
 *
 * The `__DEV__`-only mock activation in `store/subscriptionStore.ts` also
 * stays: it never existed in a release build and it is how a developer
 * exercises a funded account.
 */
// Owner scope decision 2026-09-13 (docs/plan/21_KAPSAM_EKI_2026-09-13.md §6.1): ERTELENDİ.
// Do not flip without a new, explicit owner decision.
export const PAID_SUBSCRIPTIONS_ENABLED = false;

/**
 * Shown where the plan cards used to be. States the fact and promises no
 * date -- an unshipped feature with a deadline attached is a second thing to
 * be wrong about.
 */
export const PAID_SUBSCRIPTIONS_DISABLED_REASON =
  'Bu sürümde uygulama içi satın alma yok. Aderyth ücretsiz ve tüm özellikler açık.';

/**
 * Linking out to the public website.
 *
 * ## Why this is off
 *
 * The owner has chosen the three URLs the stores require —
 * `https://aderyth.com/privacy`, `/support` and `/delete-account`. Probed on
 * 2026-09-08, the domain resolves and `https://aderyth.com/` answers 200, but
 * all three paths answer **404**. The content for them is written and ready to
 * host in `docs/store/web/`; nobody has published it yet.
 *
 * A privacy link that 404s is worse than no link at all. It is a named
 * rejection reason in both stores, and in the app it is a button that
 * visibly fails — the exact shape of promise-you-cannot-keep this release
 * pass exists to remove. So the URLs live here as data, unused, until they
 * resolve.
 *
 * This is why the in-app privacy policy (`app/screens/privacy.tsx`) is a
 * SCREEN rather than a link, and why the in-app account deletion is a direct
 * flow rather than a redirect to the web. Neither depends on this gate.
 * The website is supplementary: Google requires an externally reachable
 * deletion page in addition to the in-app path, not instead of it.
 *
 * ## What must be true before this becomes `true`
 *
 * 1. all three pages return 200 over HTTPS with the content from
 *    `docs/store/web/`;
 * 2. the placeholders in that content are filled in — at minimum the support
 *    e-mail address, which nobody has provided;
 * 3. re-probed, and the same URLs are entered in App Store Connect and Play
 *    Console.
 */
// Owner scope decision 2026-09-13 (docs/plan/21_KAPSAM_EKI_2026-09-13.md §6.3): the web pages are
// ERTELENDİ and this flag is YAPILMAYACAK until the URLs are actually live.
export const PUBLIC_SITE_URLS_LIVE = false;

/**
 * The owner's chosen public URLs. Defined even while unreachable so that
 * publishing the pages is a one-line change here rather than a hunt.
 */
export const PUBLIC_SITE_URLS = {
  privacy: 'https://aderyth.com/privacy',
  support: 'https://aderyth.com/support',
  deleteAccount: 'https://aderyth.com/delete-account',
} as const;
