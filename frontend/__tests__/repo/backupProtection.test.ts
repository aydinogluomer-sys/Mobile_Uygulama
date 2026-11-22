/**
 * R08.03 — "Hassas yedek dosyası için OS koruması/uygun şifreleme ve anahtar
 * kurtarma sınırını açıkça seç; özel kripto algoritması yazma."
 * docs/implementation-v3/R08_BACKUP_PROTECTION.md
 */
import * as fs from 'fs';
import * as path from 'path';
import { rendersKey } from '../helpers/catalog';

const ROOT = path.join(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

it('the decision is written down, with the key-recovery boundary', () => {
  const doc = fs.readFileSync(path.join(ROOT, '../docs/implementation-v3/R08_BACKUP_PROTECTION.md'), 'utf8');
  expect(doc).toMatch(/Uygulama içinde şifreleme YOK/);
  expect(doc).toMatch(/Anahtar kurtarma sınırı/);
  expect(doc).toMatch(/kendi algoritması değil/);
});

it('the user is told before sharing that the file is not encrypted', () => {
  expect(
    rendersKey(
      read('app/tabs/settings.tsx'),
      'settings.export.notEncrypted',
      'Dosya şifrelenmez; içinde günlüğün ve notların var — yalnız güvendiğin bir yere kaydet. Oturum ve erişim anahtarları dosyaya hiç girmez.',
    ),
  ).toBe(true);
});

it('no home-made cryptography anywhere in the app code', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel); else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  for (const d of ['lib', 'services', 'repositories', 'store', 'app', 'components']) walk(d);
  const CRYPTO = /function\s+(encrypt|decrypt|cipher|aes\w*|xorCipher)\b|\b(sbox|SBOX|keySchedule|feistel)\b/;
  expect(files.filter((f) => CRYPTO.test(read(f)))).toEqual([]);
  // the checksum is labelled for what it is: integrity, not a signature or a cipher
  expect(read('lib/backupFormat.ts')).toMatch(/NOT a signature/);
});

it('the local copy lives only in the app\'s own storage and is never itself exported', () => {
  expect(read('services/localBackupService.ts')).toMatch(/AsyncStorage\.setItem\(key, text\)/);
  const { isDeviceExportKey } = jest.requireActual('../../lib/deviceExport');
  expect(isDeviceExportKey('backup.local.v1.u1.2026-10-08T09:00:00.000Z', 'u1')).toBe(false);
  expect(isDeviceExportKey('backup.local.v1.u1.status', 'u1')).toBe(false);
});
