/**
 * The export must not call itself a backup, and there must be no import.
 *
 * ## The defect this pins
 *
 * The feature produced a read-only document and labelled it "yedek" — the
 * Turkish word for backup. That word makes a promise: that the file can be
 * loaded back. It cannot, and four properties of the file make a faithful
 * restore impossible to write from it (the full argument is in
 * `services/exportService.ts`'s module doc). The shortest of them: importing
 * `habit_logs` would re-fire the server-side XP trigger and inflate
 * `profiles.total_xp`, a total three migrations exist to protect.
 *
 * So the honest options were "build a real restore" or "stop claiming one".
 * A restore was not written, and this file is what stops the claim from
 * drifting back in — including the tempting middle path of writing a
 * partial importer that succeeds loudly and loses most of the account.
 *
 * ## Two directions, both enforced
 *
 * The word must be gone from the user-facing strings, AND no import path may
 * appear without this test being revisited. Checking only the wording would
 * let somebody add a half-restore under the honest label; checking only the
 * code would let the label come back over an unchanged feature.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const service = readFileSync(join(ROOT, 'services', 'exportService.ts'), 'utf8');
const settings = readFileSync(join(ROOT, 'app', 'tabs', 'settings.tsx'), 'utf8');

/**
 * The comment-stripped source.
 *
 * NOT a quoted-string extractor: the copy a user reads on this screen is JSX
 * TEXT (`<Text>Bu bir yedek değildir…</Text>`), which carries no quotes at
 * all. An earlier version of this file scanned string literals and therefore
 * could not see the very disclaimer it was written to require — it reported
 * the honest wording as missing while the honest wording was on screen.
 *
 * Comments are still removed, so the explanation of WHY the word was dropped
 * does not itself count as using it.
 */
const visible = (src: string) => stripComments(src);

describe('the scan reads real content', () => {
  it('both files were found and are non-trivial', () => {
    expect(service.length).toBeGreaterThan(2000);
    expect(settings.length).toBeGreaterThan(2000);
  });

  it('the export section is still there to be checked', () => {
    // Positive control: every negative assertion below would pass if the
    // feature had simply been deleted.
    expect(visible(settings)).toContain('Verileri Dışa Aktar');
    expect(visible(service)).toContain('export function backupToCSV');
  });
});

describe('nothing user-facing calls it a backup', () => {
  it('the share sheet no longer offers a "Veri Yedeği"', () => {
    expect(visible(settings)).not.toContain('Veri Yedeği');
    expect(visible(settings)).toContain('Veri Dışa Aktarımı');
  });

  it('the incomplete-read alert no longer says "Yedek eksik"', () => {
    expect(visible(settings)).not.toContain('Yedek eksik');
    expect(visible(settings)).toContain('Dışa aktarım eksik');
  });

  it('the CSV banner is an export, not a backup', () => {
    expect(visible(service)).toContain('# Aderyth dışa aktarım');
    expect(visible(service)).not.toContain('# Aderyth yedek');
  });

  it('the UI says outright that there is no FULL restore, and names what never comes back', () => {
    // The one place the word may still appear: it appears in order to be
    // denied. Checked as rendered text, not as a string literal.
    // R08 revisited this: a checked, partial merge now exists (see below),
    // so "geri yükleme yoktur" became "tam geri yükleme yoktur" -- and the
    // screen must name what is never restored, so the partial merge cannot
    // read as a full one.
    expect(visible(settings)).toContain('Bu tam bir yedek değildir');
    expect(visible(settings)).toContain('tam geri yükleme yoktur');
    expect(visible(settings)).toMatch(/alışkanlık\s+kayıtları, odak oturumları ve webhook/);
  });
});

describe('no import path exists', () => {
  const code = stripComments(service);

  it('the service exports nothing that reads a backup in', () => {
    // `buildBackup`/`renderBackup` go one way. Anything named import/restore
    // /parse would be the other, and must not appear without revisiting the
    // reasoning in this file's header.
    expect(code).not.toMatch(/export\s+(async\s+)?function\s+(import|restore|parse)[A-Z]/);
    expect(code).not.toMatch(/export\s+const\s+(import|restore|parse)[A-Z]/);
  });

  // R08 revisited the "no import" decision instead of drifting past it: a
  // checked, partial merge exists, and these pin what keeps it honest.
  it('the merge lives outside the export, behind a dry run', () => {
    expect(stripComments(settings)).not.toMatch(/restoreBackup|importBackup|handleImport|handleRestore/);
    const panel = stripComments(readFileSync(join(ROOT, 'components', 'RestorePanel.tsx'), 'utf8'));
    // the write takes a plan, and the only plan comes from the dry run
    expect(panel).toMatch(/const r = await dryRunRestore\(text\);/);
    expect(panel).toMatch(/await executeRestore\(plan,/);
  });

  it('habit logs, focus sessions and webhooks are never restorable; nothing existing is overwritten', () => {
    const fmt = stripComments(readFileSync(join(ROOT, 'lib', 'backupFormat.ts'), 'utf8'));
    for (const n of ['habit_logs', 'focus_sessions', 'webhooks']) {
      expect(fmt).toMatch(new RegExp(`name: '${n}', restorable: false`));
    }
    const repo = stripComments(readFileSync(join(ROOT, 'repositories', 'restoreRepository.ts'), 'utf8'));
    expect(repo).not.toMatch(/\.update\(|\.upsert\(|\.delete\(/);
    expect(repo).not.toMatch(/'habit_logs'|'focus_sessions'|'webhooks'/);
    const exportRepo = stripComments(readFileSync(join(ROOT, 'repositories', 'exportRepository.ts'), 'utf8'));
    expect(exportRepo).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it('the file still says WHY, so the next person does not rediscover it', () => {
    // The decision is only durable while its reasons travel with it.
    expect(service).toContain('Why there is NO full import');
    expect(service).toContain('habit_logs');
    expect(service).toContain('truncated');
  });
});
