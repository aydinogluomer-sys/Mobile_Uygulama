/**
 * F06 (NAV-01, PRF-03) — the demo sign-in, for development builds only.
 *
 * It used to be an always-rendered accent button on the release login screen: it wrote a fake
 * Notion session and opened Today without any Supabase session, passing the auth gate in a build a
 * store reviewer (or any user) could reach. Moved here unchanged in behaviour, and loaded only by
 * `app/(auth)/login.tsx` behind `__DEV__ ? require(...) : null`, so a release bundle carries neither
 * this component nor its strings. `__tests__/repo/loginNoBypassInRelease.test.ts` holds that line.
 */
import { useState } from 'react';
import { Button } from '../ui';
import { colors, space } from '../../lib/tokens';
import { useNotionSessionStore } from '../../store/notionSessionStore';
import { loadDemoSeed } from '../../lib/demoSeedGate';
import { reportError } from '../../lib/crashReporting';

type Props = { onDone: () => void };

export default function DevDemoLoginButton({ onDone }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleBypassLogin() {
    setBusy(true);
    try {
      await loadDemoSeed()?.seedDemoData();
    } catch (e) {
      // the seed is optional; a failure is recorded instead of swallowed
      reportError(e, 'manual', 'demo-login');
    }
    useNotionSessionStore.setState({
      session: {
        workspaceName: 'Aderyth Demo',
        workspaceIcon: '⚡',
        workspaceId: 'demo-local',
        connectedAt: new Date().toISOString(),
      },
    });
    onDone();
    setBusy(false);
  }

  return (
    <Button
      label="🚀 Girişi Geç (Demo Modu)"
      onPress={() => { void handleBypassLogin(); }}
      loading={busy}
      size="lg"
      style={{ marginTop: space.sm, backgroundColor: colors.accent }}
      accessibilityHint="Yalnızca geliştirme derlemesinde görünür."
    />
  );
}
