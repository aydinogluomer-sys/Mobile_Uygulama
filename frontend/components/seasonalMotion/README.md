# Seasonal Ambient Motion

Takvim aylık arka planlarının üstüne **çok hafif, aya özgü, dikkat dağıtmayan** canlı atmosfer katmanı.
İmplementasyon sözleşmesi: `Downloads/seasonal_motion_implementation.md`.

## Modül (izole)
- `types.ts` — tipler (MonthNameTR, SeasonalMotionIntensity, SeasonalEffectType, config, parçacık/bant).
- `config.ts` — **12 ay tek source-of-truth** (`SEASONAL_MOTION_BY_MONTH`) + `monthNameFromIndex` + `DEFAULT_SEASONAL_MOTION_INTENSITY='subtle'`.
- `particles.ts` — seeded (deterministik) sahne üretimi: efekt→kind/renk, drift vektörü, hız→süre, kenar-yaslı yerleşim. `Math.random` render içinde YOK.
- `useReducedMotion.ts` — sistem reduce-motion izleyici (`AccessibilityInfo`).
- `SeasonalMotion.tsx` — RN `Animated` + `useNativeDriver` renderer (per-frame JS yok).
- `SeasonalMotionPreview.tsx` — yalnızca `__DEV__` önizleme aracı.

## Teknoloji kararı
Kod tabanı yerleşik RN `Animated` kullanıyor (Drawer); `react-native-reanimated` kurulu ama kaynakta kullanılmıyor. Ambient hareket basit (translate/opacity/rotate döngüleri) → **`Animated` + native driver**. Yeni bağımlılık yok.

## Katman sırası (contract §4)
`MonthBackground` içinde: görsel → koyu scrim → **SeasonalMotion** → (calendar.tsx'te) GlassPanel + içerik.
Takvim içeriği cam panel üzerinde olduğundan hareket çoğunlukla **kenar boşluklarında** görünür; tarih/streak okunurluğu panel tarafından korunur.

## Kapatma / erişilebilirlik
- `effectiveIntensity = reduceMotion ? 'off' : userSelectedIntensity`.
- `off` | görünmez (`isVisible=false`) | reduce-motion → component `null` döner (hiç parçacık mount edilmez).
- Görünürlük: `calendar.tsx` `useIsFocused()` → `MonthBackground active` → ekran odakta değilken hareket durur (unmount).
- Ayar: **Ayarlar → Görünüm → "Arka plan animasyonları": Kapalı / Hafif / Normal** (varsayılan Hafif). `themeStore.seasonalMotion`, AsyncStorage `app_seasonal_motion`.

## Performans (contract §14)
- Subtle 7–14, normal 14–28 parçacık (config). Aralık/Ocak biraz yüksek, ≤28.
- Native-driven `Animated.loop` (UI thread); React per-frame state güncellemesi yok.
- Görünmezken animasyon yok (unmount → `anim.stop()`).
- Katman `pointerEvents="none"` → dokunma asla yakalanmaz.

## QA — checklist (contract §16)
Statik/yapısal doğrulama bende geçti (tsc 0, `run-tests.js`). **Görsel/etkileşim/performans QA cihazda yapılmalı**; `__DEV__` önizleme butonu (takvim sağ-alt ✨) ile 12 ay + yoğunluk + reduce-motion simülasyonu tek ekrandan test edilir.

Cihazda doğrulanacaklar:
- [ ] Her ay kendi karakterinde, aylar karışmıyor (kar↔yaprak↔polen vb.).
- [ ] Tarih sayıları / streak / seçili gün okunur kalıyor; hareket merkezi sık geçmiyor.
- [ ] Hücre dokunma + ay değiştirme + ayarlar normal (hareket dokunma yakalamıyor).
- [ ] Sistem reduce-motion → animasyon kapanıyor; "Kapalı" → kapalı; "Hafif" sakin; "Normal" hâlâ dikkat dağıtmıyor.
- [ ] Ay geçişinde/alışkanlık tamamlamada lag yok; ekrandan çıkınca animasyon duruyor (sızıntı yok).

Şüphede kalınırsa hareket azaltılır (öncelik: kullanılabilirlik > okunurluk > performans > atmosfer > yoğunluk).
