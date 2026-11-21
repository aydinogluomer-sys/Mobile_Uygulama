# Aderyth — Frontend (Expo SDK 57)

## Geliştirici Kurulumu

1. **Node sürümü**

   Depo `.nvmrc` dosyasında `22.13.0` LTS sürümüne sabitlenmiştir (`frontend/package.json` `engines.node` = `^20.19.4 || ^22.13.0 || ^24.3.0 || >=25.0.0`, `frontend/.npmrc` `engine-strict=true`).

   ```bash
   nvm use
   ```

   > Not (Windows): `nvm-windows` `.nvmrc` dosyasını otomatik okumaz; `nvm use 22.13.0` ile açık sürüm verin veya `engines.node` aralığındaki bir sürümü (`>=25.0.0` dahil) kullanın.

2. **Ortam değişkenleri**

   ```bash
   cp .env.example .env
   ```

   `.env` izlenmez; `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_ANON_KEY` değerlerini kanonik Supabase projesinden doldurun. Eksik yapılandırmada uygulama beyaz ekran yerine sakin "Yapılandırma eksik" ekranını gösterir (`lib/env.ts`, `components/ConfigErrorScreen.tsx`).

3. **Bağımlılık kurulumu ve çalıştırma**

   ```bash
   npm ci
   npx expo start
   ```

## Doğrulama ve Tedarik Zinciri Kapıları

```bash
npm run typecheck:ci
npm run lint:ci
npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB
node run-tests.js
npm run audit:prod
npm run doctor
```
