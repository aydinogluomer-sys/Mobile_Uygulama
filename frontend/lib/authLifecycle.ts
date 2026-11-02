/**
 * F06 (SYN-23) — token refresh follows the app's foreground state.
 *
 * On React Native auth-js starts its refresh ticker once at start-up and never stops it (it only
 * watches tab visibility in a browser). A backgrounded app kept trying to refresh, which fails while
 * the OS suspends the network and can burn a refresh token on a locked device; a resumed app waited
 * for the next tick. Supabase's own guidance for React Native is to start the ticker on `active` and
 * stop it otherwise. That is all this does, plus one hook: on every return to the foreground the
 * session writes SecureStore refused earlier are retried (lib/authStorage.ts).
 *
 * No module-level side effect: the root layout calls it from an effect (native only; on the web
 * auth-js follows tab visibility itself), and tests pass a fake client and AppState.
 */
import type { AppStateStatus } from 'react-native';

export type AutoRefreshClient = {
  auth: { startAutoRefresh(): Promise<void>; stopAutoRefresh(): Promise<void> };
};
export type AppStateLike = {
  currentState: AppStateStatus;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
};

/**
 * In the foreground `startAutoRefresh`, otherwise `stopAutoRefresh`, applied at once for the
 * current state. `onActive` runs once per transition INTO `active` (not at set-up, not for a
 * repeated `active`). The returned function removes the listener and does NOT stop the ticker.
 */
export function bindAuthAutoRefresh(
  client: AutoRefreshClient,
  appState: AppStateLike,
  onActive?: () => void,
): () => void {
  const start = () => { void client.auth.startAutoRefresh().catch(() => undefined); };
  const stop = () => { void client.auth.stopAutoRefresh().catch(() => undefined); };

  // `unknown` (iOS, before the first event) counts as the foreground, as in lib/syncCoordinator.ts:
  // an app that starts active may never send a change event.
  const foreground = (s: AppStateStatus) => s === 'active' || s === 'unknown';

  let last: AppStateStatus = appState.currentState;
  if (foreground(last)) start();
  else stop();

  const sub = appState.addEventListener('change', (next) => {
    if (next === last) return;
    const prev = last;
    last = next;
    if (next === 'active') {
      if (!foreground(prev)) start();
      if (onActive) {
        try { onActive(); } catch { /* a failed retry must not break the listener */ }
      }
    } else if (foreground(prev) && !foreground(next)) {
      stop();
    }
  });

  return () => sub.remove();
}
