/**
 * Aderyth auth e-posta şablonlarını Supabase Management API üzerinden uygular.
 *
 * İKİ ŞABLON:
 *   confirm signup  → supabase-confirm-signup-template.html
 *   recovery        → supabase-password-recovery-template.html
 *
 * NE YAPMAZ — ve bunu iddia etmekle kalmaz, doğrular:
 *   SMTP ayarlarına DOKUNMAZ. PATCH gövdesi yalnızca `mailer_subjects_*` ve
 *   `mailer_templates_*_content` alanlarını taşır; işlemden önce ve sonra
 *   sunucudaki `smtp_*` alanlarının parmak izi alınır ve değişmediği
 *   doğrulanır. Parmak izi bir SHA-256 kısaltmasıdır: karşılaştırma yapar ama
 *   hiçbir gizli değeri ekrana yazmaz.
 *
 * Kullanım:
 *   node scripts/configure-supabase-recovery-template.mjs            # dry run
 *   SUPABASE_ACCESS_TOKEN=… node scripts/… --apply                   # uygula
 *
 * Token yalnızca process environment'tan okunur; dosyaya veya komut satırına
 * yazılmaz, log'lanmaz.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  assertCanonicalProjectRef,
  projectRefFromUrl,
  readCanonicalProjectRef,
} from './lib/canonicalProjectRef.mjs';

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

const projectRef = projectRefFromUrl(supabaseUrl);

// F08 (BLD-13): before anything else -- dry run included, before any fetch -- the target must be the
// canonical project pinned in supabase/config.toml (the script runs from frontend/). An unreadable
// config.toml is a refusal too (fail-closed): a guard that cannot read its pin must not pass.
let canonicalProjectRef = '';
try {
  canonicalProjectRef = readCanonicalProjectRef(resolve('..', 'supabase', 'config.toml'));
} catch {
  process.stderr.write('REDDEDİLDİ: supabase/config.toml project_id okunamadı; kanonik proje doğrulanamadı.\n');
  process.exit(2);
}
assertCanonicalProjectRef(projectRef, canonicalProjectRef);

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

/**
 * Her şablonun kendi zorunlu değişkenleri var. Bunlar kozmetik değil: recovery
 * şablonundan `{{ .Token }}` düşerse forgot-password ekranı hiçbir zaman
 * doğrulayamayacağı bir kod bekler, confirmation şablonundan
 * `{{ .ConfirmationURL }}` düşerse hesap hiç etkinleşmez. Bu yüzden hem
 * göndermeden önce hem de sunucudan geri okuyarak kontrol edilir.
 */
const TEMPLATES = [
  {
    label: 'confirm signup',
    file: 'supabase-confirm-signup-template.html',
    subjectField: 'mailer_subjects_confirmation',
    contentField: 'mailer_templates_confirmation_content',
    subject: 'Aderyth hesabını doğrula',
    required: ['{{ .ConfirmationURL }}'],
  },
  {
    label: 'password recovery',
    file: 'supabase-password-recovery-template.html',
    subjectField: 'mailer_subjects_recovery',
    contentField: 'mailer_templates_recovery_content',
    subject: 'Aderyth şifre kurtarma kodun',
    required: ['{{ .Token }}', '{{ .ConfirmationURL }}'],
  },
];

const fields = {};
for (const t of TEMPLATES) {
  const html = readFileSync(resolve(t.file), 'utf8');
  const missing = t.required.filter((v) => !html.includes(v));
  if (missing.length) {
    throw new Error(`${t.file} zorunlu değişkeni içermiyor: ${missing.join(', ')}`);
  }
  fields[t.subjectField] = t.subject;
  fields[t.contentField] = html;
}

console.log(`Project : ${projectRef}`);
console.log(`Endpoint: ${endpoint}`);
for (const t of TEMPLATES) {
  console.log(`  · ${t.label.padEnd(18)} ${t.file}  (${t.required.join(' ')})`);
}
console.log('SMTP    : dokunulmuyor — PATCH gövdesinde hiçbir smtp_* alanı yok');

if (!APPLY) {
  console.log('\nDRY RUN: Değişiklik yapılmadı. Uygulamak için SUPABASE_ACCESS_TOKEN tanımlayıp --apply kullanın.');
  process.exit(0);
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  throw new Error('SUPABASE_ACCESS_TOKEN eksik. Token kaynak dosyaya veya komut satırına yazılmamalı; yalnızca process environment üzerinden sağlanmalı.');
}

const auth = { Authorization: `Bearer ${accessToken}` };

async function readConfig(what) {
  const r = await fetch(endpoint, { headers: auth });
  if (!r.ok) throw new Error(`${what} okunamadı: HTTP ${r.status}`);
  return r.json();
}

/** smtp_* alanlarının içeriğini AÇMADAN karşılaştırılabilir hale getirir. */
function smtpFingerprint(config) {
  const keys = Object.keys(config).filter((k) => k.startsWith('smtp_')).sort();
  const material = keys.map((k) => `${k}=${String(config[k] ?? '')}`).join('\n');
  return { keys, digest: createHash('sha256').update(material).digest('hex').slice(0, 16) };
}

const before = await readConfig('Mevcut yapılandırma');
const smtpBefore = smtpFingerprint(before);
console.log(`\nSMTP fingerprint (önce): ${smtpBefore.digest}  [${smtpBefore.keys.length} alan]`);

const response = await fetch(endpoint, {
  method: 'PATCH',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify(fields),
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`Supabase Management API ${response.status}: ${detail.slice(0, 500)}`);
}

const after = await readConfig('Şablon doğrulaması');

for (const t of TEMPLATES) {
  const content = String(after[t.contentField] ?? '');
  const subject = String(after[t.subjectField] ?? '');
  const missing = t.required.filter((v) => !content.includes(v));
  if (missing.length) throw new Error(`${t.label}: sunucudaki şablonda eksik değişken: ${missing.join(', ')}`);
  if (subject !== t.subject) throw new Error(`${t.label}: konu satırı doğrulanamadı.`);
  if (!content.includes('Aderyth')) throw new Error(`${t.label}: sunucudaki şablon Aderyth markasını taşımıyor.`);
  console.log(`OK  ${t.label.padEnd(18)} konu + şablon doğrulandı`);
}

const smtpAfter = smtpFingerprint(after);
console.log(`SMTP fingerprint (sonra): ${smtpAfter.digest}  [${smtpAfter.keys.length} alan]`);
if (smtpAfter.digest !== smtpBefore.digest) {
  throw new Error('SMTP yapılandırması değişti. Bu script SMTP alanlarına dokunmaz — bu farkı manuel inceleyin.');
}
console.log('OK  SMTP yapılandırması değişmedi.');
