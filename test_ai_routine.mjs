import { chromium } from 'playwright';

const APP_URL   = 'http://localhost:8082';
const TEST_EMAIL = `aitest${Date.now()}@gmail.com`;
const TEST_PASS  = 'TestHabit123!';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = msg => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

// React Native Web'de TextInput'a yazmak için: input'u focus et + keyboard type
async function rnFill(page, placeholder, text) {
  // React Native Web: actual <input> is in DOM but not "visible" — force fill bypasses check
  await page.locator(`[placeholder="${placeholder}"]`).first().fill(text, { force: true });
  await sleep(200);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') log(`JS ERR: ${m.text().slice(0,120)}`); });

  try {
    // ── KAYIT OL ──────────────────────────────────────────────────────────
    log('Uygulama açılıyor...');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    await page.screenshot({ path: 'ss_01_login.png' });

    // "Kayıt ol" linkine tıkla
    await page.locator('text=Kayıt ol').click({ force: true });
    await sleep(1500);
    await page.screenshot({ path: 'ss_02_register.png' });

    // Register form doldur
    await rnFill(page, 'E-posta', TEST_EMAIL);
    await rnFill(page, 'Şifre (en az 6 karakter)', TEST_PASS);
    await page.screenshot({ path: 'ss_03_register_filled.png' });

    // Kayıt Ol butonuna bas — register formundaki submit butonu
    await page.locator('text=Kayıt Ol').last().click({ force: true });
    log(`Kayıt isteği gönderildi: ${TEST_EMAIL}`);
    await sleep(4000);
    await page.screenshot({ path: 'ss_04_after_register.png' });

    // Email doğrulama gerekmiyorsa tabs açılır, gerekliyse login dene
    const onAuth = await page.locator('text=Giriş Yap').isVisible({ timeout: 3000 }).catch(() => false);
    if (onAuth) {
      log('Email onayı gerekmiyor görünüyor, login deneniyor...');
      await rnFill(page, 'E-posta', TEST_EMAIL);
      await rnFill(page, 'Şifre', TEST_PASS);  // login screen has plain "Şifre"
      await page.locator('text=Giriş Yap').first().click({ force: true });
      await sleep(4000);
      await page.screenshot({ path: 'ss_05_after_login.png' });
    }

    const authError = await page.locator('[style*="ef4444"], text=/hata|geçersiz|invalid/i').first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    if (authError) {
      const errTxt = await page.locator('[style*="ef4444"]').first().textContent().catch(() => '?');
      log(`Auth hatası: ${errTxt} — Test durduruluyor.`);
      await browser.close();
      return;
    }

    log(`Oturum sonrası URL: ${page.url()}`);

    // ── HABITS SEKMESINE GİT ─────────────────────────────────────────────
    await sleep(1000);
    const habitsTab = page.locator('text=/Alışkanlık|Habits/i').first();
    if (await habitsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await habitsTab.click({ force: true });
      await sleep(1000);
    }
    await page.screenshot({ path: 'ss_06_habits.png' });

    // ── AI FAB BULU VE TIKLA ──────────────────────────────────────────────
    // Habits ekranındaki ✨ FAB — sağ alt köşe, + butonunun üzerinde
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);

    // FAB'ları tara
    log(`Ekran: ${vw}x${vh} — AI FAB tıklanıyor...`);
    await page.mouse.click(vw - 28, vh - 140);
    await sleep(1500);
    await page.screenshot({ path: 'ss_07_ai_click.png' });

    let modalOpen = await page.locator('text=Routine AI').isVisible({ timeout: 3000 }).catch(() => false);
    if (!modalOpen) {
      // Koordinat ayarla
      await page.mouse.click(vw - 28, vh - 100);
      await sleep(1500);
      modalOpen = await page.locator('text=Routine AI').isVisible({ timeout: 3000 }).catch(() => false);
      await page.screenshot({ path: 'ss_07b_ai_retry.png' });
    }
    log(`Modal açık: ${modalOpen}`);
    if (!modalOpen) {
      log('⚠️ AI modal açılamadı — FAB koordinatı bulunamadı');
      await browser.close();
      return;
    }

    // ── TEST 1: RUTIN OLUŞTUR ─────────────────────────────────────────────
    await rnFill(page, 'Hedefini veya durumunu anlat...', 'Sabah daha üretken olmak istiyorum');
    await page.screenshot({ path: 'ss_08_prompt.png' });

    await page.locator('text=Rutin Oluştur').click({ force: true });
    log('▶ TEST 1: Rutin isteği gönderildi — yanıt bekleniyor (~15sn)...');
    await sleep(18000);
    await page.screenshot({ path: 'ss_09_test1_result.png' });

    const t1Error   = await page.locator('[style*="ef4444"]').first().textContent({ timeout: 1000 }).catch(() => null);
    const t1Success = await page.locator('text=/Rutin adı|sabah|Morning|Beklemeye/i').first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    log(`TEST 1 → Hata: ${t1Error ?? 'yok'} | Başarı: ${t1Success}`);

    // ── TEST 2: HEMEN TEKRAR (COOLDOWN) ───────────────────────────────────
    // Yeniden dene'ye bas veya modal'ı kapat-aç
    const retryBtn = page.locator('text=Yeniden dene');
    if (await retryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await retryBtn.click({ force: true });
      await sleep(600);
    }

    await rnFill(page, 'Hedefini veya durumunu anlat...', 'Akşam rutini');
    await page.locator('text=Rutin Oluştur').click({ force: true });
    log('▶ TEST 2: Hemen tekrar (cooldown testi)...');
    await sleep(4000);
    await page.screenshot({ path: 'ss_10_test2_cooldown.png' });

    const t2Error = await page.locator('[style*="ef4444"]').first().textContent({ timeout: 2000 }).catch(() => null);
    log(`TEST 2 → Mesaj: "${t2Error ?? 'yok'}"`);

    // ── TEST 3: GÜNLÜK LIMİT (60sn bekle + 2 istek daha) ─────────────────
    log('60 saniye cooldown bekleniyor...');
    await sleep(62000);

    for (let i = 2; i <= 3; i++) {
      const rt = page.locator('text=Yeniden dene');
      if (await rt.isVisible({ timeout: 1500 }).catch(() => false)) { await rt.click({ force: true }); await sleep(400); }
      await rnFill(page, 'Hedefini veya durumunu anlat...', `Spor rutini ${i}`);
      await page.locator('text=Rutin Oluştur').click({ force: true });
      log(`▶ İstek ${i}/3 gönderildi...`);
      await sleep(20000);
      await page.screenshot({ path: `ss_1${i}_req${i}.png` });
      if (i < 3) {
        log('60 saniye daha bekleniyor (cooldown)...');
        await sleep(62000);
      }
    }

    await page.screenshot({ path: 'ss_13_after3requests.png' });
    // 4. istek — limit mesajı bekleniyor
    const rt = page.locator('text=Yeniden dene');
    if (await rt.isVisible({ timeout: 1500 }).catch(() => false)) { await rt.click({ force: true }); await sleep(400); }
    await rnFill(page, 'Hedefini veya durumunu anlat...', 'Uyku rutini');
    await page.locator('text=Rutin Oluştur').click({ force: true });
    log('▶ TEST 3: 4. istek (günlük limit aşımı)...');
    await sleep(5000);
    await page.screenshot({ path: 'ss_14_test3_limit.png' });

    const t3Error = await page.locator('[style*="ef4444"]').first().textContent({ timeout: 2000 }).catch(() => null);
    log(`TEST 3 → Limit mesajı: "${t3Error ?? 'yok'}"`);

    log('=== ÖZET ===');
    log(`TEST 1 (Rutin oluştur)   : ${t1Success ? '✅ PASS' : '❌ FAIL'} — ${t1Error ?? 'sonuç alındı'}`);
    log(`TEST 2 (60sn cooldown)   : ${t2Error?.includes('saniye') ? '✅ PASS' : '❌ FAIL'} — ${t2Error}`);
    log(`TEST 3 (Günlük limit 3)  : ${t3Error?.includes('limit') || t3Error?.includes('Yarın') ? '✅ PASS' : '❌ FAIL'} — ${t3Error}`);

  } catch (err) {
    log(`SCRIPT HATASI: ${err.message}`);
    await page.screenshot({ path: 'ss_crash.png' }).catch(() => {});
  }

  await sleep(3000);
  await browser.close();
})();
