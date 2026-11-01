/**
 * F00 / BLD-24: the repository has one line-ending contract.
 *
 * Without `.gitattributes`, `core.autocrlf=true` checkouts showed files as
 * modified that differed only in CR at end of line, which hid the one real
 * change (BLD-01) in the noise, and a CRLF shell script breaks `set -euo
 * pipefail` under a Linux bash. The contract is pinned in `.gitattributes`
 * and the INDEX side of `git ls-files --eol` must never hold CRLF for source
 * files. The working-tree side is deliberately not checked: it depends on
 * each developer's checkout and says nothing about what is committed.
 *
 * `git` missing is a failure, not a skip: a silently skipped guard reads as
 * green.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..');

type EolRow = { index: string; worktree: string; attr: string; path: string };

/** Parses `git ls-files --eol` output ("i/lf    w/crlf  attr/text eol=lf \tpath"). */
const parseEolListing = (output: string): EolRow[] =>
  output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      const left = tab >= 0 ? line.slice(0, tab) : line;
      const path = tab >= 0 ? line.slice(tab + 1) : '';
      const [index = '', worktree = ''] = left.trim().split(/\s+/);
      const attrAt = left.indexOf('attr/');
      const attr = attrAt >= 0 ? left.slice(attrAt).trim() : '';
      return { index, worktree, attr, path };
    });

/** Returns paths whose INDEX side is crlf or mixed, restricted to the given extensions. */
const indexCrlfOffenders = (rows: EolRow[], extensions: readonly string[]): string[] =>
  rows
    .filter((r) => (r.index === 'i/crlf' || r.index === 'i/mixed') && extensions.some((ext) => r.path.endsWith(ext)))
    .map((r) => r.path);

const REQUIRED_ATTRIBUTE_LINES = ['* text=auto eol=lf', '*.sh text eol=lf', '*.png binary'] as const;

/** Returns the required `.gitattributes` lines that are missing from the given text. */
const missingAttributeLines = (text: string): string[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  return REQUIRED_ATTRIBUTE_LINES.filter((required) => !lines.includes(required));
};

const SOURCE_EXTENSIONS = ['.sh', '.sql', '.yml', '.ts', '.tsx', '.js', '.json'] as const;

const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

describe('.gitattributes pins the line-ending contract', () => {
  it('exists and carries the required rules', () => {
    const text = readFileSync(join(REPO, '.gitattributes'), 'utf8');
    expect(missingAttributeLines(text)).toEqual([]);
  });
});

describe('the index holds no CRLF source files', () => {
  it('git ls-files --eol lists every tracked file and none of the source files is CRLF in the index', () => {
    const rows = parseEolListing(git(['ls-files', '--eol']));
    const tracked = git(['ls-files']).split('\n').filter((l) => l.trim().length > 0);

    // The parser must not silently drop lines: an empty listing would read as green.
    expect(rows.length).toBe(tracked.length);
    expect(rows.length).toBeGreaterThan(200);

    expect(indexCrlfOffenders(rows, SOURCE_EXTENSIONS)).toEqual([]);
  });
});

describe('the helpers catch what they exist for (synthetic input)', () => {
  const listing = [
    'i/crlf  w/crlf  attr/                 \tscripts/x.sh',
    'i/lf    w/crlf  attr/text eol=lf      \tscripts/y.sh',
    'i/mixed w/mixed attr/                 \tsupabase/migrations/z.sql',
    'i/crlf  w/crlf  attr/                 \tdocs/readme.md',
  ].join('\n');

  it('parses index, worktree, attribute and path columns', () => {
    const rows = parseEolListing(listing);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({ index: 'i/lf', worktree: 'w/crlf', attr: 'attr/text eol=lf', path: 'scripts/y.sh' });
  });

  it('reports an index-side CRLF shell script', () => {
    expect(indexCrlfOffenders(parseEolListing(listing), ['.sh'])).toEqual(['scripts/x.sh']);
  });

  it('ignores the working-tree side', () => {
    expect(indexCrlfOffenders(parseEolListing(listing), ['.sh'])).not.toContain('scripts/y.sh');
  });

  it('reports mixed endings and respects the extension filter', () => {
    const rows = parseEolListing(listing);
    expect(indexCrlfOffenders(rows, ['.sql'])).toEqual(['supabase/migrations/z.sql']);
    expect(indexCrlfOffenders(rows, ['.sh'])).not.toContain('docs/readme.md');
  });

  it('rejects a .gitattributes without the eol=lf contract', () => {
    expect(missingAttributeLines('* text=auto\n*.png binary\n')).toEqual(['* text=auto eol=lf', '*.sh text eol=lf']);
  });
});
