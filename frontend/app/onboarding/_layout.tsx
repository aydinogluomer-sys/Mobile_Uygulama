import { Stack } from 'expo-router';
import { useThemeColors } from '../../hooks/useThemeColors';

/**
 * The authenticated first-run group.
 *
 * A group of its own rather than a branch inside `today.tsx`: the flow has
 * three screens with their own back stack, and putting that behind a
 * conditional in the dashboard would mean Today could not be reasoned about
 * without also reasoning about onboarding. It also keeps the redirect in
 * `app/_layout.tsx` a decision about a ROUTE — "are they in `onboarding`?" —
 * rather than about a screen's internal state.
 *
 * Not `(onboarding)`: parentheses hide the segment from the URL, and the
 * router needs to see `onboarding` in `useSegments()` to know the user is
 * already where it would send them. A hidden group would make the redirect
 * fire against itself.
 */
export default function OnboardingLayout() {
  const colors = useThemeColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
