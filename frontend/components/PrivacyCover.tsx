/**
 * R06.05 — the existing "hide titles" preference also covers the app's own
 * preview: while the app is not in front (the app switcher takes its snapshot
 * on `inactive`), a plain cover hides habit names, journal text and coach
 * messages.
 *
 * No native lock or screen-capture flag (that would be a new native
 * dependency): a full-screen view drawn on top. iOS snapshots after
 * `inactive`, so the cover is in it. Android may take its recents snapshot
 * before JS redraws -- best effort there, stated in R06_ACCESSIBILITY.md.
 */
import { useEffect, useState } from 'react';
import { AppState, View, Text, StyleSheet, type AppStateStatus } from 'react-native';
import { colors } from '../lib/tokens';
import { loadReminderSettings } from '../services/reminderService';

/** Cover when the preference is on and the app is not active. */
export function shouldCover(hideTitles: boolean, state: AppStateStatus): boolean {
  return hideTitles && state !== 'active';
}

export default function PrivacyCover() {
  // A runtime that cannot say (no string state yet) counts as in front: never cover a visible app.
  const [state, setState] = useState<AppStateStatus>(typeof AppState.currentState === 'string' ? AppState.currentState : 'active');
  const [hide, setHide] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setState(next);
      // Re-read on every change: the preference may have just been flipped in Settings.
      if (next !== 'active') void loadReminderSettings().then((s) => setHide(s.hideTitles)).catch(() => undefined);
    });
    void loadReminderSettings().then((s) => setHide(s.hideTitles)).catch(() => undefined);
    return () => sub.remove();
  }, []);
  if (!shouldCover(hide, state)) return null;
  return (
    <View style={s.cover} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Text style={s.mark}>Aderyth</Text>
    </View>
  );
}

const s = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  mark: { color: colors.textFaint, fontSize: 18, letterSpacing: 2 },
});
