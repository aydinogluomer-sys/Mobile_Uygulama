// F08 (BLD-13): the canonical-project guard of the scripts that talk to the Supabase Management API.
//
// Yasaklı proje bu dosyada ADLANDIRILMAZ: frontend/__tests__/repo/crossProjectIsolation.test.ts kural A,
// yasaklı ref'in yalnız supabase/predeploy_guard.sh, supabase/config.toml ve tarihçe dizinlerinde
// geçmesine izin verir (frontend/scripts bu listede yoktur). Koruma kapalı-varsayılan izin listesidir:
// kanonik olmayan HER ref (yasaklı proje dahil) reddedilir, bu yüzden ayrı bir kara liste gerekmez.
//
// No network call is made here, and nothing secret (token, key) is ever printed: the refusal names
// the ref only.
import { readFileSync } from 'node:fs';

const PROJECT_ID_LINE = /^\s*project_id\s*=\s*"([^"]*)"/m;
const SUPABASE_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

/** supabase/config.toml içindeki project_id değerini okur; bulamazsa fırlatır. */
export function readCanonicalProjectRef(configTomlPath) {
  const text = readFileSync(configTomlPath, 'utf8');
  const match = PROJECT_ID_LINE.exec(text);
  const ref = match ? match[1].trim() : '';
  if (!ref) {
    throw new Error(`project_id bulunamadı: ${configTomlPath}`);
  }
  return ref;
}

/** Yerel .env URL'sinden ref çıkarır: https://<ref>.supabase.co (biçim dışıysa boş dize). */
export function projectRefFromUrl(url) {
  let host;
  try {
    host = new URL(String(url ?? '')).hostname.toLowerCase();
  } catch {
    return '';
  }
  const match = SUPABASE_HOST.exec(host);
  return match ? match[1] : '';
}

/** ref kanonik değilse (veya yasaklıysa) mesajı yazar ve process.exit(2). */
export function assertCanonicalProjectRef(ref, canonical, exit = process.exit) {
  if (!canonical || !ref || ref !== canonical) {
    process.stderr.write(`REDDEDİLDİ: ${ref || '(boş)'} kanonik değil. Yalnız supabase/config.toml project_id projesine yazılabilir.\n`);
    exit(2);
    return false;
  }
  return true;
}
