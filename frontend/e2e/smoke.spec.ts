import { expect, test as base, type Page } from '@playwright/test';
import { installEmulator, type InstalledEmulator } from './support/installEmulator';
import { FIXED_NOW, USER_A, USER_B, seedFor } from './support/fixtures';

const APP = `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`;

const test = base.extend<{ app: InstalledEmulator; bootstrapMode: 'missing' | 'present' }>({
  bootstrapMode: ['missing', { option: true }],
  app: async ({ context, page, bootstrapMode }, provide) => {
    await page.clock.setFixedTime(FIXED_NOW);
    const installed = await installEmulator(context, page, seedFor(bootstrapMode), {
      appOrigin: APP,
      nowMs: () => FIXED_NOW.getTime(),
    });
    await provide(installed);
    expect(installed.blocked, 'engellenen dış istekler').toEqual([]);
    expect(installed.pageErrors, 'sayfa hataları').toEqual([]);
    expect(installed.nativeDialogs, 'yerel tarayıcı diyalogları').toEqual([]);
    expect(installed.emulator.unhandled(), 'işlenmeyen API çağrıları').toEqual([]);
  },
});

async function signIn(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.getByLabel('E-posta').fill(user.email);
  await page.getByLabel('Şifre', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
}

const authKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => /auth|supabase|sb-/i.test(k)));

test('1. Soğuk açılış: Türkçe lang, demo atlatma yok, prefers-reduced-motion uyumu ve temiz oturum', async ({
  page,
  app: _app,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Giriş Yap' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0);

  const reduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  expect(reduced).toBe(testInfo.project.name === 'reduced-motion-375');
  expect(await authKeys(page)).toEqual([]);
});

test.describe('2. Giriş -> Bugün (bootstrapMode: missing — tablo yedek yolu)', () => {
  test.use({ bootstrapMode: 'missing' });

  test('kullanıcı giriş yapar ve bugünün alışkanlıklarını görür', async ({ page, app: _app }) => {
    await page.goto('/');
    await signIn(page, USER_A);
    await expect(page.getByRole('checkbox', { name: /Su iç/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Yürüyüş/ })).toBeVisible();
    expect((await authKeys(page)).length).toBeGreaterThan(0);
  });
});

test.describe('2b. Giriş -> Bugün (bootstrapMode: present — 037 RPC yolu)', () => {
  test.use({ bootstrapMode: 'present' });

  test('kullanıcı 13 anahtarlı get_today_bootstrap yüküyle Bugün ekranını açar', async ({
    page,
    app: _app,
  }) => {
    await page.goto('/');
    await signIn(page, USER_A);
    await expect(page.getByRole('checkbox', { name: /Su iç/ })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Yürüyüş/ })).toBeVisible();
    expect((await authKeys(page)).length).toBeGreaterThan(0);
  });
});

test('3. Alışkanlık işaretleme: aria-checked değişir, habit_logs yazılır ve yenilemede korunur', async ({
  page,
  app,
}) => {
  await page.goto('/');
  await signIn(page, USER_A);

  const habitRow = page.getByRole('checkbox', { name: /Su iç/ });
  await expect(habitRow).toBeVisible();
  await expect(habitRow).toHaveAttribute('aria-checked', 'false');

  await habitRow.click();
  await expect(habitRow).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => app.emulator.writes('habit_logs').length).toBe(1);

  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Su iç/ })).toHaveAttribute('aria-checked', 'true');
});

test('4. Platform-güvenli onay diyaloğu: Hesabı Sil uygulama içi açılır, Esc ile iptal olur ve delete-account çağrılmaz', async ({
  page,
  app,
}) => {
  await page.goto('/');
  await signIn(page, USER_A);
  await expect(page.getByRole('checkbox', { name: /Su iç/ })).toBeVisible();

  await page.goto('/tabs/settings');
  const deleteBtn = page.getByRole('button', { name: /hesab(ı|i)\s*sil/i });
  await expect(deleteBtn).toBeVisible();
  await deleteBtn.click();

  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Vazgeç' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(app.emulator.functionCalls()).not.toContain('delete-account');
  expect(app.nativeDialogs).toEqual([]);
});

test('5. Oturumu kapat: onay modalı üzerinden çıkış yapılır, yerel auth anahtarları temizlenir ve logout kaydedilir', async ({
  page,
  app,
}) => {
  await page.goto('/');
  await signIn(page, USER_A);
  await expect(page.getByRole('checkbox', { name: /Su iç/ })).toBeVisible();

  await page.goto('/tabs/settings');
  const signOutRow = page.getByRole('button', { name: /Oturumu kapat/i }).first();
  await expect(signOutRow).toBeVisible();
  await signOutRow.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Oturumu kapat' }).click();

  await expect(page.getByRole('button', { name: 'Giriş Yap' })).toBeVisible();
  expect(await authKeys(page)).toEqual([]);
  expect(app.emulator.authCalls()).toContain('POST /auth/v1/logout');
});

test('6. Hesap izolasyonu: A çıkıp B girdiğinde A verisi ne ekranda ne localStorage içinde kalır', async ({
  page,
  app: _app,
}) => {
  await page.goto('/');
  await signIn(page, USER_A);
  await expect(page.getByRole('checkbox', { name: /Su iç/ })).toBeVisible();

  await page.goto('/tabs/settings');
  await page.getByRole('button', { name: /Oturumu kapat/i }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Oturumu kapat' }).click();
  await expect(page.getByRole('button', { name: 'Giriş Yap' })).toBeVisible();

  await signIn(page, USER_B);
  await expect(page.getByRole('checkbox', { name: /Kitap oku/ })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Su iç/ })).toHaveCount(0);

  const storageDump = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  expect(storageDump).not.toContain('Su iç');
});

test('7. Yeniden akış (320x640): girişte ve Bugün ekranında yatay taşma yoktur', async ({
  page,
  app: _app,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Giriş Yap' })).toBeVisible();

  const loginOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(loginOverflow).toBe(true);

  await signIn(page, USER_A);
  await expect(page.getByRole('checkbox', { name: /Su iç/ })).toBeVisible();

  const todayOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(todayOverflow).toBe(true);
});

test('8. Dokunma hedefleri (mobile-375): birincil eylem, alışkanlık satırı ve diyalog düğmeleri >= 44px', async ({
  page,
  app: _app,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-375', 'Dokunma hedefi yüksekliği mobile-375 projesinde ölçülür');

  await page.goto('/');
  const loginBtn = page.getByRole('button', { name: 'Giriş Yap' });
  await expect(loginBtn).toBeVisible();
  const loginBox = await loginBtn.boundingBox();
  expect(loginBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await signIn(page, USER_A);
  const habitRow = page.getByRole('checkbox', { name: /Su iç/ });
  await expect(habitRow).toBeVisible();
  const habitBox = await habitRow.boundingBox();
  expect(habitBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.goto('/tabs/settings');
  const signOutRow = page.getByRole('button', { name: /Oturumu kapat/i }).first();
  await expect(signOutRow).toBeVisible();
  const signOutBox = await signOutRow.boundingBox();
  expect(signOutBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await signOutRow.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (const label of ['Oturumu kapat', 'Vazgeç']) {
    const btnBox = await dialog.getByRole('button', { name: label }).boundingBox();
    expect(btnBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole('button', { name: 'Vazgeç' }).click();
});
