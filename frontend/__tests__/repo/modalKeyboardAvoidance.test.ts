import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { blankNonCode, modalBlocks } from '../helpers/a11yScan';

const ROOT = join(__dirname, '..', '..');

export const ALLOWED_MODAL_WITHOUT_KAV: Readonly<Record<string, number>> = {
  'components/BadHabitsTracker.tsx': 2,
  'components/coach/ConversationSheet.tsx': 1,
  'components/CommandPalette.tsx': 1,
  'components/IntegrationDetailModal.tsx': 1,
  'components/ReminderEditor.tsx': 1,
};

const MIGRATED_SHEET_MODAL_FILES = [
  'app/screens/okr.tsx',
  'app/screens/goals.tsx',
  'app/tabs/timeline.tsx',
  'app/screens/deep-work.tsx',
] as const;

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) {
      continue;
    }
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkTsx(rel));
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out.sort();
}

export function unguardedInputModalsInSource(raw: string): { line: number; endLine: number }[] {
  const { blanked } = blankNonCode(raw);
  const blocks = modalBlocks(raw, blanked);
  const bad: { line: number; endLine: number }[] = [];

  for (const b of blocks) {
    const innerBlanked = blankNonCode(b.inner).blanked;
    const hasInput = /<(?:TextInput|FloatingLabelInput)(?![A-Za-z0-9_$])/.test(innerBlanked);
    if (!hasInput) continue;
    const hasKav = /<KeyboardAvoidingView(?![A-Za-z0-9_$])/.test(innerBlanked);
    if (!hasKav) {
      bad.push({ line: b.line, endLine: b.endLine });
    }
  }
  return bad;
}

export function evaluateModalAllowlist(
  measuredByFile: Readonly<Record<string, number>>,
  allowlist: Readonly<Record<string, number>>,
): string[] {
  const problems: string[] = [];

  for (const [file, count] of Object.entries(measuredByFile)) {
    const cap = allowlist[file];
    if (cap === undefined) {
      problems.push(`${file}: ${count} Modal+TextInput block(s) lack KeyboardAvoidingView / SheetModal`);
    } else if (count > cap) {
      problems.push(`${file}: ${count} unguarded Modal block(s) exceed ceiling ${cap}`);
    }
  }

  for (const [file, cap] of Object.entries(allowlist)) {
    const actual = measuredByFile[file] ?? 0;
    if (actual < cap) {
      problems.push(`${file}: measured ${actual} is below allowlist ${cap} (ratchet allowlist down)`);
    }
  }

  return problems;
}

describe('F26 (NAV-15) — Modal + TextInput keyboard avoidance guard', () => {
  const files = [...walkTsx('app'), ...walkTsx('components')];

  it('(+) scans > 120 TSX files and migrated form screens use SheetModal with zero allowlist exemptions', () => {
    expect(files.length).toBeGreaterThan(120);

    for (const rel of MIGRATED_SHEET_MODAL_FILES) {
      expect(ALLOWED_MODAL_WITHOUT_KAV[rel]).toBeUndefined();
      const code = blankNonCode(readFileSync(join(ROOT, rel), 'utf8')).blanked;
      expect({ rel, usesSheetModal: /<SheetModal(?![A-Za-z0-9_$])/.test(code) }).toEqual({
        rel,
        usesSheetModal: true,
      });
    }
  });

  it('(+) every raw <Modal> with TextInput/FloatingLabelInput either wraps KeyboardAvoidingView inside or matches monotonic allowlist', () => {
    const measured: Record<string, number> = {};
    for (const rel of files) {
      const hits = unguardedInputModalsInSource(readFileSync(join(ROOT, rel), 'utf8'));
      if (hits.length > 0) {
        measured[rel] = hits.length;
      }
    }
    expect(evaluateModalAllowlist(measured, ALLOWED_MODAL_WITHOUT_KAV)).toEqual([]);
  });

  it('(-) catches unguarded Modal+TextInput, rejects outer KeyboardAvoidingView, handles nested Modals, and flags stale allowlist entries', () => {
    const bare = `
      <Modal visible={open}>
        <View><TextInput value={v} onChangeText={setV} /></View>
      </Modal>
    `;
    expect(unguardedInputModalsInSource(bare)).toHaveLength(1);

    const outerKav = `
      <KeyboardAvoidingView behavior="padding">
        <Modal visible={open}>
          <FloatingLabelInput label="Ad" value={v} onChangeText={setV} />
        </Modal>
      </KeyboardAvoidingView>
    `;
    expect(unguardedInputModalsInSource(outerKav)).toHaveLength(1);

    const nestedUnguardedInner = `
      <Modal visible={a}>
        <KeyboardAvoidingView behavior="padding">
          <Modal visible={b}>
            <TextInput value={v} />
          </Modal>
        </KeyboardAvoidingView>
      </Modal>
    `;
    expect(unguardedInputModalsInSource(nestedUnguardedInner)).toHaveLength(1);

    const nestedGuardedInner = `
      <Modal visible={a}>
        <View>
          <Modal visible={b}>
            <KeyboardAvoidingView behavior="padding">
              <TextInput value={v} />
            </KeyboardAvoidingView>
          </Modal>
        </View>
      </Modal>
    `;
    expect(unguardedInputModalsInSource(nestedGuardedInner)).toHaveLength(0);

    const stale = evaluateModalAllowlist({}, { 'components/ReminderEditor.tsx': 1 });
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain('ratchet allowlist down');
  });
});
