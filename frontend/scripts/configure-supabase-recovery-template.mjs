import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPLY = process.argv.includes('--apply');
const envFile = readFileSync(resolve('.env'), 'utf8');
const env = Object.fromEntries(
  envFile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw new Error('EXPO_PUBLIC_SUPABASE_URL .env içinde bulunamadı.');

const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
const template = readFileSync(resolve('supabase-password-recovery-template.html'), 'utf8');
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const fields = {
  mailer_subjects_recovery: 'Atlas şifre kurtarma kodun',
  mailer_templates_recovery_content: template,
};

console.log(`Project: ${projectRef}`);
console.log(`Endpoint: ${endpoint}`);
console.log(`Fields: ${Object.keys(fields).join(', ')}`);

if (!APPLY) {
  console.log('DRY RUN: Değişiklik yapılmadı. Uygulamak için SUPABASE_ACCESS_TOKEN tanımlayıp --apply kullanın.');
  process.exit(0);
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error('SUPABASE_ACCESS_TOKEN eksik. Token kaynak dosyaya veya komut satırına yazılmamalı; yalnızca process environment üzerinden sağlanmalı.');
}

const response = await fetch(endpoint, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(fields),
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`Supabase Management API ${response.status}: ${detail.slice(0, 500)}`);
}

const verification = await fetch(endpoint, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!verification.ok) throw new Error(`Şablon doğrulaması başarısız: HTTP ${verification.status}`);

const config = await verification.json();
const content = String(config.mailer_templates_recovery_content ?? '');
const subject = String(config.mailer_subjects_recovery ?? '');

if (!content.includes('{{ .Token }}') || subject !== fields.mailer_subjects_recovery) {
  throw new Error('API başarılı döndü ancak recovery subject/content doğrulanamadı.');
}

console.log('OK: Recovery e-posta şablonu 6 haneli {{ .Token }} içerecek şekilde güncellendi ve doğrulandı.');
