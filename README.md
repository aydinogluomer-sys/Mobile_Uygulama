# Aderyth

Alışkanlıklarını irade ekonomisiyle yöneten, ADHD dostu karar çerçevesi (Expo / React Native + Supabase).

## Hızlı Başlangıç

1. Node sürümünü hizala (`.nvmrc` -> `22.13.0`; Windows `nvm-windows` kullanıcıları `nvm use 22.13.0` çalıştırabilir):

   ```bash
   nvm use
   ```

2. Ortam şablonunu kopyala ve kanonik Supabase değerlerini gir:

   ```bash
   cp frontend/.env.example frontend/.env
   ```

3. Bağımlılıkları kur ve doğrulama kapılarını çalıştır:

   ```bash
   cd frontend
   npm ci
   npm run audit:prod
   npm run doctor
   npm run typecheck:ci
   npm run lint:ci
   npx jest --ci --maxWorkers=2 --workerIdleMemoryLimit=512MB
   node run-tests.js
   ```

Ayrıntılı mimari ve faz yürütme kuralları için `implementation.md` ve `frontend/README.md` dosyalarına bakın.
