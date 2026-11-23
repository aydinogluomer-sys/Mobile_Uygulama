import { readFileSync } from 'fs';
import { join } from 'path';

const CATALOG_PATH = join(__dirname, '..', '..', 'locales', 'tr.json');

export const catalog: Record<string, string> = JSON.parse(
  readFileSync(CATALOG_PATH, 'utf8'),
) as Record<string, string>;

export function rendersKey(
  src: string,
  key: string,
  pinnedText: string,
  cat: Readonly<Record<string, string>> = catalog,
): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const callRe = new RegExp(`\\bt\\(\\s*['"]${escaped}['"]`);
  return callRe.test(src) && Object.prototype.hasOwnProperty.call(cat, key) && cat[key] === pinnedText;
}
