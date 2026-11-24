import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isEmailNotConfirmed,
  loginErrorMessage,
  recoveryErrorMessage,
  signupErrorMessage,
} from '../../lib/authErrors';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const readCode = (rel: string) => stripComments(readFileSync(join(FRONTEND, rel), 'utf8'));

describe('loginErrorMessage — Türkçe ve eyleme dönük giriş hataları (NAV-05)', () => {
  it('(+) yanlış kimlik bilgisi Türkçe ileti ve forgot_password eylemi döner', () => {
    expect(loginErrorMessage('Invalid login credentials')).toEqual({
      message: 'E-posta veya şifre hatalı.',
      action: 'forgot_password',
    });
  });

  it('(+) doğrulanmamış e-posta Türkçe ileti ve resend_confirmation eylemi döner', () => {
    expect(loginErrorMessage('Email not confirmed')).toEqual({
      message: 'E-postanı henüz doğrulamadın.',
      action: 'resend_confirmation',
    });
    expect(loginErrorMessage('email_not_confirmed')).toEqual({
      message: 'E-postanı henüz doğrulamadın.',
      action: 'resend_confirmation',
    });
  });

  it('(+) büyük/küçük harf farkından etkilenmez', () => {
    expect(loginErrorMessage('EMAIL NOT CONFIRMED')).toEqual({
      message: 'E-postanı henüz doğrulamadın.',
      action: 'resend_confirmation',
    });
    expect(loginErrorMessage('INVALID LOGIN CREDENTIALS')).toEqual({
      message: 'E-posta veya şifre hatalı.',
      action: 'forgot_password',
    });
  });

  it.each([
    'For security purposes, you can only request this after 51 seconds',
    'Request rate limit reached',
    'Too many requests',
  ])('(+) oran sınırı (%s) retry eylemli Türkçe iletiye eşlenir', (raw) => {
    expect(loginErrorMessage(raw)).toEqual({
      message: 'Çok sık denendi. Kısa bir süre bekleyip tekrar dene.',
      action: 'retry',
    });
  });

  it.each([
    'Failed to fetch',
    'Network request failed',
    'TypeError: fetch failed',
  ])('(+) ağ hatası (%s) retry eylemli Türkçe iletiye eşlenir', (raw) => {
    expect(loginErrorMessage(raw)).toEqual({
      message: 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.',
      action: 'retry',
    });
  });

  it.each(['User banned', 'user_banned'])('(+) engellenmiş hesap (%s) eylemsiz Türkçe ileti döner', (raw) => {
    expect(loginErrorMessage(raw)).toEqual({
      message: 'Bu hesapla şu anda giriş yapılamıyor.',
    });
  });

  it.each([
    'Invalid email',
    'Unable to validate email address: invalid format',
  ])('(+) geçersiz e-posta (%s) Türkçe ileti döner', (raw) => {
    expect(loginErrorMessage(raw)).toEqual({
      message: 'E-posta adresi geçerli görünmüyor. Kontrol edip tekrar dene.',
    });
  });

  it('(+) isEmailNotConfirmed yalnızca onaylanmamış hesap hatasında true döner', () => {
    expect(isEmailNotConfirmed('Email not confirmed')).toBe(true);
    expect(isEmailNotConfirmed('EMAIL_NOT_CONFIRMED')).toBe(true);
    expect(isEmailNotConfirmed('Invalid login credentials')).toBe(false);
    expect(isEmailNotConfirmed('')).toBe(false);
  });

  it('(-) tanınmayan hata mesajı olduğu gibi korunur ve action üretmez', () => {
    const unknown = 'Some brand new GoTrue failure';
    const mapped = loginErrorMessage(unknown);
    expect(mapped).toEqual({ message: unknown });
    expect(mapped.action).toBeUndefined();
  });

  it('(-) boş ve yalnızca boşluk girdisi gizli başarısızlık bırakmaz, Türkçe retry döner', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      expect(loginErrorMessage(blank)).toEqual({
        message: 'Giriş yapılamadı. Bağlantını kontrol edip tekrar dene.',
        action: 'retry',
      });
    }
  });

  it('(-) yanlış parola ASLA resend_confirmation üretmez ve eşlenen çıktılarda İngilizce kalıntı yoktur', () => {
    expect(loginErrorMessage('Invalid login credentials').action).not.toBe('resend_confirmation');
    const knownInputs = [
      'Invalid login credentials',
      'Email not confirmed',
      'For security purposes, you can only request this after 51 seconds',
      'Request rate limit reached',
      'Failed to fetch',
      'User banned',
      'Invalid email',
    ];
    for (const raw of knownInputs) {
      expect(loginErrorMessage(raw).message).not.toMatch(/invalid|confirmed|credentials|rate limit/i);
    }
  });
});

describe('signupErrorMessage ve recoveryErrorMessage — paylaşılan tek hata kaynağı', () => {
  it.each([
    ['Error sending confirmation email', 'Doğrulama e-postası şu anda gönderilemiyor. Hesabın oluşturulmadı; birazdan tekrar dene.'],
    ['email rate limit exceeded', 'Çok fazla e-posta gönderildi. Bir süre bekleyip tekrar dene.'],
    ['For security purposes, you can only request this after 51 seconds', 'Çok sık denendi. Kısa bir süre bekleyip tekrar dene.'],
    ['User already registered', 'Bu e-posta zaten kayıtlı. Giriş yapmayı dene.'],
    ['Password should be at least 6 characters', 'Şifre en az 6 karakter olmalıdır.'],
    ['Unable to validate email address: invalid format', 'E-posta adresi geçerli görünmüyor. Kontrol edip tekrar dene.'],
    ['Signups not allowed for this instance', 'Yeni kayıtlar şu anda kapalı.'],
    ['TypeError: Failed to fetch', 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.'],
  ])('(+) signupErrorMessage(%s) mevcut çıktıyı birebir korur', (raw, expected) => {
    expect(signupErrorMessage(raw)).toBe(expected);
  });

  it.each([
    ['Token has expired or is invalid', 'Kod geçersiz veya süresi dolmuş. Yeni bir kod isteyip tekrar deneyin.'],
    ['For security purposes, you can only request this after 30 seconds', 'Çok sık kod istendi. Lütfen kısa bir süre bekleyip tekrar deneyin.'],
    ['New password should be different from the old password.', 'Yeni şifre eskisinden farklı olmalı.'],
    ['same_password', 'Yeni şifre eskisinden farklı olmalı.'],
    ['Password should be at least 6 characters.', 'Şifre en az 6 karakter olmalıdır.'],
    ['Auth session missing!', 'Sıfırlama oturumu bulunamadı. Kodu yeniden doğrulayıp tekrar deneyin.'],
    ['Failed to fetch', 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.'],
    ['Network request failed', 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.'],
  ])('(+) recoveryErrorMessage(%s) beklenen Türkçe iletiyi üretir', (raw, expected) => {
    expect(recoveryErrorMessage(raw)).toBe(expected);
  });

  it('(-) recoveryErrorMessage tanınmayan metni olduğu gibi döndürür', () => {
    const unknown = 'Unexpected upstream response';
    expect(recoveryErrorMessage(unknown)).toBe(unknown);
  });

  it('(+) kaynak taraması: register.tsx yeniden dışa aktarır, forgot-password.tsx yerel eşleme tutmaz', () => {
    const registerSrc = readCode('app/(auth)/register.tsx');
    expect(registerSrc).toContain("export { signupErrorMessage } from '../../lib/authErrors'");
    expect(registerSrc).not.toContain('export function signupErrorMessage');

    const forgotSrc = readCode('app/(auth)/forgot-password.tsx');
    expect(forgotSrc).not.toContain('function recoveryError(');
    expect(forgotSrc).toContain('recoveryErrorMessage');
  });
});
