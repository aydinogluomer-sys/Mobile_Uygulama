/**
 * R06.06 / §8.1 — "Boş sonuç: 'kayıt yok' ile 'erişim/bağlantı hatası'
 * ayrıdır." A list that could not be LOADED must not look like a list that
 * is empty: this says the records were not reached (not that there are
 * none), that nothing was deleted, and offers a retry.
 */
import EmptyState from './EmptyState';
import { useThemeColors } from '../../hooks/useThemeColors';

export type ListState = 'loading' | 'error' | 'no-results' | 'empty' | 'data';

/** The one rule every list screen uses to pick what to show. */
export function listState(p: { loading: boolean; error: string | null | undefined; count: number; query?: string | null }): ListState {
  if (p.count > 0) return 'data';
  if (p.loading) return 'loading';
  if (p.error) return 'error';
  if (p.query && p.query.trim()) return 'no-results';
  return 'empty';
}

export default function LoadErrorState({ what, onRetry }: { what: string; onRetry: () => void }) {
  const c = useThemeColors();
  return (
    <EmptyState
      icon="cloud-offline-outline"
      illustration="offline"
      title={`${what} yüklenemedi`}
      hint="Bağlantı ya da erişim sorunu — kayıtların silinmedi. Bağlantı gelince tekrar dene."
      ctaLabel="Tekrar dene"
      onCta={onRetry}
      color={c.warning}
    />
  );
}
