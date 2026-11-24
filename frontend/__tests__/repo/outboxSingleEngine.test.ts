import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.expo', 'dist', 'coverage', 'android', 'ios', 'scripts']);

function collectProdSources(relDir = ''): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const absDir = relDir ? join(ROOT, relDir) : ROOT;
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectProdSources(rel));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push({
      path: rel.replace(/\\/g, '/'),
      code: stripComments(readFileSync(join(ROOT, rel), 'utf8')),
    });
  }
  return out;
}

describe('F46 (5.2-i) — outboxSingleEngine repository boundary guard', () => {
  const allProd = collectProdSources();

  it('(+) flushOutbox( is called ONLY inside services/outboxChannel.ts', () => {
    const callers = allProd
      .filter((f) => f.path !== 'services/outboxRunner.ts' && /\bflushOutbox\s*\(/.test(f.code))
      .map((f) => f.path);
    expect(callers).toEqual(['services/outboxChannel.ts']);
  });

  it('(+) no file under store/ calls storage.save( directly', () => {
    const offenders = allProd
      .filter((f) => f.path.startsWith('store/') && /\bstorage\.save\s*\(/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('(+) lib/syncQueue is imported ONLY by lib/outboxEngine.ts in production code', () => {
    const importers = allProd
      .filter((f) => f.path !== 'lib/syncQueue.ts' && /from\s+['"][^'"]*syncQueue['"]/.test(f.code))
      .map((f) => f.path);
    expect(importers).toEqual(['lib/outboxEngine.ts']);
  });

  it('(+) createOutboxChannel( appears in exactly the 4 canonical owners, each paired with outboxEngine.register(', () => {
    const owners = allProd
      .filter((f) => f.path !== 'services/outboxChannel.ts' && /\bcreateOutboxChannel\s*\(/.test(f.code))
      .map((f) => f.path)
      .sort();
    expect(owners).toEqual([
      'services/coreOutbox.ts',
      'services/webhookService.ts',
      'store/logStore.ts',
      'store/taskStore.ts',
    ]);
    for (const owner of owners) {
      const file = allProd.find((f) => f.path === owner)!;
      expect(file.code).toMatch(/\boutboxEngine\.register\s*\(/);
    }
  });

  it('(+) all 5 CRUD write-through stores use writeThrough( and never call coreOutbox.write( directly', () => {
    const fiveStores = [
      'store/goalStore.ts',
      'store/projectStore.ts',
      'store/lifeAreasStore.ts',
      'store/okrStore.ts',
      'store/readingListStore.ts',
    ];
    for (const rel of fiveStores) {
      const file = allProd.find((f) => f.path === rel);
      expect(file).toBeDefined();
      expect(file!.code).toMatch(/\bwriteThrough\s*\(/);
      expect(file!.code).not.toMatch(/\bcoreOutbox\.write\s*\(/);
    }
  });
});
