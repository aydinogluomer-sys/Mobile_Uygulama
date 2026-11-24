/**
 * U09 & U08 — Unified Screen & Form State Contract.
 *
 * Pure, deterministic TypeScript module unifying all 9 playbook §8 UI states:
 * - Separates auth/fetch loading (`'loading'`) and network/server errors
 *   (`'recoverable'` / `'permanent'`) from genuine empty state (`'empty'`).
 * - Separates offline/outbox queued (`'pending'`, `claimsServerSaved: false`)
 *   from server-acknowledged `'committed'` (`claimsServerSaved: true`),
 *   `'conflict'`, `'recoverable'`, and `'permanent'`.
 * - Provides non-color icon glyphs (`nonColorIcon`) and semantic accessibility
 *   roles (`accessibilityRole`) + live regions (`liveRegion`) for every state (`U08`).
 * - Preserves user form drafts across all non-success outcomes (`preserveDraftOnFailure`).
 */
import type { SyncOutcomeStatus } from './syncOutcomes';

export type ScreenStateKind =
  | 'idle'
  | 'loading'
  | 'stale'
  | 'empty'
  | 'pending'
  | 'committed'
  | 'conflict'
  | 'recoverable'
  | 'permanent';

export type ScreenStateInput = {
  authReady: boolean;
  loading: boolean;
  hasCachedData: boolean;
  isStale?: boolean;
  itemCount: number;
  syncStatus?: SyncOutcomeStatus | null;
  error?: { retryable: boolean; message?: string } | null;
};

export type ScreenStateDescriptor = {
  kind: ScreenStateKind;
  headline: string;
  detail: string;
  primaryActionLabel: string | null;
  liveRegion: 'none' | 'polite' | 'assertive';
  claimsServerSaved: boolean;
  nonColorIcon: string;
  accessibilityRole: 'none' | 'progressbar' | 'summary' | 'text' | 'alert';
};

export function resolveScreenState(input: ScreenStateInput): ScreenStateDescriptor {
  const customErrorDetail =
    typeof input.error?.message === 'string' && input.error.message.trim().length > 0
      ? input.error.message.trim()
      : null;

  if (!input.authReady) {
    return {
      kind: 'loading',
      headline: 'Oturum doğrulanıyor',
      detail: 'Hesap bilgilerin kontrol ediliyor, lütfen bekle.',
      primaryActionLabel: null,
      liveRegion: 'polite',
      claimsServerSaved: false,
      nonColorIcon: 'hourglass-outline',
      accessibilityRole: 'progressbar',
    };
  }

  if (input.syncStatus === 'conflict') {
    return {
      kind: 'conflict',
      headline: 'Kayıt başka bir cihazda değişti',
      detail:
        customErrorDetail ??
        'Değişikliklerin korunuyor; hangi sürümün kalacağını seçebilirsin.',
      primaryActionLabel: 'Farkları incele',
      liveRegion: 'assertive',
      claimsServerSaved: false,
      nonColorIcon: 'git-compare-outline',
      accessibilityRole: 'alert',
    };
  }

  if (input.syncStatus === 'permanent' || (input.error != null && !input.error.retryable)) {
    return {
      kind: 'permanent',
      headline: 'İşlem tamamlanamadı',
      detail:
        customErrorDetail ??
        'Bu işlem sunucu kuralı nedeniyle kaydedilemedi; taslağın korunuyor.',
      primaryActionLabel: 'Düzenlemeye dön',
      liveRegion: 'assertive',
      claimsServerSaved: false,
      nonColorIcon: 'alert-circle-outline',
      accessibilityRole: 'alert',
    };
  }

  if (input.syncStatus === 'retryable' || (input.error != null && input.error.retryable)) {
    return {
      kind: 'recoverable',
      headline: 'Bağlantı kurulamadı · kayıtların silinmedi',
      detail:
        customErrorDetail ??
        'Geçici bir bağlantı sorunu oluştu. Bağlantı gelince tekrar deneyebilirsin.',
      primaryActionLabel: 'Tekrar dene',
      liveRegion: 'assertive',
      claimsServerSaved: false,
      nonColorIcon: 'cloud-offline-outline',
      accessibilityRole: 'alert',
    };
  }

  if (input.syncStatus === 'pending') {
    return {
      kind: 'pending',
      headline: 'Cihazda sıraya alındı · bağlantı gelince gönderilecek',
      detail: 'Değişikliğin bu cihazda güvende; sunucu onayı bekleniyor.',
      primaryActionLabel: null,
      liveRegion: 'polite',
      claimsServerSaved: false,
      nonColorIcon: 'cloud-upload-outline',
      accessibilityRole: 'summary',
    };
  }

  if (input.syncStatus === 'committed') {
    return {
      kind: 'committed',
      headline: 'Kaydedildi',
      detail: 'Değişikliğin sunucuya işlendi.',
      primaryActionLabel: null,
      liveRegion: 'polite',
      claimsServerSaved: true,
      nonColorIcon: 'checkmark-circle-outline',
      accessibilityRole: 'summary',
    };
  }

  if (input.loading && (!input.hasCachedData || input.itemCount <= 0)) {
    return {
      kind: 'loading',
      headline: 'Yükleniyor',
      detail: 'Veriler getiriliyor, lütfen bekle.',
      primaryActionLabel: null,
      liveRegion: 'polite',
      claimsServerSaved: false,
      nonColorIcon: 'sync-outline',
      accessibilityRole: 'progressbar',
    };
  }

  if (input.isStale === true || (input.loading && input.hasCachedData && input.itemCount > 0)) {
    return {
      kind: 'stale',
      headline: 'Önbellekteki son veriler gösteriliyor',
      detail: 'Güncel kayıtlar yenileniyor veya kontrol edilmeyi bekliyor.',
      primaryActionLabel: 'Yenile',
      liveRegion: 'polite',
      claimsServerSaved: false,
      nonColorIcon: 'time-outline',
      accessibilityRole: 'summary',
    };
  }

  if (input.itemCount <= 0) {
    return {
      kind: 'empty',
      headline: 'Henüz kayıt yok',
      detail: 'İlk kaydını ekleyerek başlayabilirsin.',
      primaryActionLabel: 'Yeni ekle',
      liveRegion: 'none',
      claimsServerSaved: false,
      nonColorIcon: 'sparkles-outline',
      accessibilityRole: 'text',
    };
  }

  return {
    kind: 'idle',
    headline: 'Hazır',
    detail: 'Veriler güncel.',
    primaryActionLabel: null,
    liveRegion: 'none',
    claimsServerSaved: false,
    nonColorIcon: 'checkmark-done-outline',
    accessibilityRole: 'none',
  };
}

export function preserveDraftOnFailure<TDraft>(
  draft: TDraft,
  outcome: { ok: boolean; status?: SyncOutcomeStatus | 'recoverable' },
): { draft: TDraft; shouldClearInput: boolean } {
  const shouldClearInput =
    outcome.ok === true &&
    (outcome.status === undefined ||
      outcome.status === 'committed' ||
      outcome.status === 'pending');

  return {
    draft,
    shouldClearInput,
  };
}
