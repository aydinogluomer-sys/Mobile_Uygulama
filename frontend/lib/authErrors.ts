/**
 * F22 (NAV-05): one place that turns Supabase Auth's English error text into Turkish messages
 * that say what to do next. Pure and dependency-free so every screen and test can share it.
 *
 * Every table matches with `includes` on the lower-cased text; the first match wins.
 * Anything unrecognised is passed through untouched rather than flattened into
 * "bir hata oluştu" -- an unmapped message is still a real one, and hiding it would cost
 * the next person the only clue they had.
 */

export type AuthErrorAction = 'resend_confirmation' | 'forgot_password' | 'retry';
export type MappedAuthError = { message: string; action?: AuthErrorAction };

const NETWORK_MESSAGE = 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.';

/**
 * Sign-in errors. An unrecognised message passes through as-is (same rule as
 * signupErrorMessage); a blank one becomes a generic Turkish message, because an empty
 * error row would be a silent failure.
 *
 * GoTrue answers "Email not confirmed" only after the password has been checked, so the
 * resend path does not reveal whether an address has an account (AC-S05 is kept).
 */
export function loginErrorMessage(raw: string): MappedAuthError {
  const m = (raw ?? '').toLowerCase();
  if (!m.trim()) {
    return { message: 'Giriş yapılamadı. Bağlantını kontrol edip tekrar dene.', action: 'retry' };
  }
  if (m.includes('invalid login credentials')) {
    return { message: 'E-posta veya şifre hatalı.', action: 'forgot_password' };
  }
  if (m.includes('email not confirmed') || m.includes('email_not_confirmed')) {
    return { message: 'E-postanı henüz doğrulamadın.', action: 'resend_confirmation' };
  }
  if (m.includes('for security purposes') || m.includes('rate limit') || m.includes('too many')) {
    return { message: 'Çok sık denendi. Kısa bir süre bekleyip tekrar dene.', action: 'retry' };
  }
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('fetch failed')) {
    return { message: NETWORK_MESSAGE, action: 'retry' };
  }
  if (m.includes('user banned') || m.includes('user_banned')) {
    return { message: 'Bu hesapla şu anda giriş yapılamıyor.' };
  }
  if (m.includes('invalid email') || m.includes('unable to validate email')) {
    return { message: 'E-posta adresi geçerli görünmüyor. Kontrol edip tekrar dene.' };
  }
  return { message: raw };
}

/**
 * Sign-up and confirmation-resend errors (moved from register.tsx; outputs and order are
 * unchanged -- signupConfirmation.test.tsx AC-S06).
 */
export function signupErrorMessage(raw: string): string {
  const m = raw.toLowerCase();

  if (m.includes('error sending confirmation') || m.includes('error sending email')) {
    return 'Doğrulama e-postası şu anda gönderilemiyor. Hesabın oluşturulmadı; birazdan tekrar dene.';
  }
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) {
    return 'Çok fazla e-posta gönderildi. Bir süre bekleyip tekrar dene.';
  }
  if (m.includes('for security purposes') || m.includes('rate limit') || m.includes('too many')) {
    return 'Çok sık denendi. Kısa bir süre bekleyip tekrar dene.';
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'Bu e-posta zaten kayıtlı. Giriş yapmayı dene.';
  }
  if (m.includes('password') && (m.includes('at least') || m.includes('should be'))) {
    return 'Şifre en az 6 karakter olmalıdır.';
  }
  if (m.includes('unable to validate email') || m.includes('invalid format') || m.includes('invalid email')) {
    return 'E-posta adresi geçerli görünmüyor. Kontrol edip tekrar dene.';
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'Yeni kayıtlar şu anda kapalı.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return NETWORK_MESSAGE;
  }
  return raw;
}

/**
 * Password-recovery errors: the rules moved from forgot-password.tsx (unchanged, first),
 * then the updateUser answers (same password, short password, missing session, network).
 */
export function recoveryErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('expired') || m.includes('invalid') || m.includes('token')) {
    return 'Kod geçersiz veya süresi dolmuş. Yeni bir kod isteyip tekrar deneyin.';
  }
  if (m.includes('security purposes') || m.includes('rate limit') || m.includes('too many')) {
    return 'Çok sık kod istendi. Lütfen kısa bir süre bekleyip tekrar deneyin.';
  }
  if (m.includes('new password should be different') || m.includes('same_password')) {
    return 'Yeni şifre eskisinden farklı olmalı.';
  }
  if (m.includes('password should be at least')) {
    return 'Şifre en az 6 karakter olmalıdır.';
  }
  if (m.includes('auth session missing')) {
    return 'Sıfırlama oturumu bulunamadı. Kodu yeniden doğrulayıp tekrar deneyin.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return NETWORK_MESSAGE;
  }
  return raw;
}

export function isEmailNotConfirmed(raw: string): boolean {
  return loginErrorMessage(raw).action === 'resend_confirmation';
}
