/**
 * R03.03 — "Küçük başla" is wired from Today to the focus timer, and the
 * parent task is read, never written, on the way.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const today = stripComments(read('app/tabs/today.tsx'));
const focus = stripComments(read('app/tabs/focus.tsx'));
const store = stripComments(read('store/focusStore.ts'));
const sheetRaw = read('components/SmallStartSheet.tsx');

describe('R03.03 — wiring', () => {
  it('each open task on Today offers to start small with that task as the parent', () => {
    expect(today).toMatch(/onPress=\{\(\) => setSmallStartFor\(\{ kind: 'task', id: t\.id, title: t\.title \}\)\}/);
    expect(today).toMatch(/<SmallStartSheet\s+parent=\{smallStartFor\}/);
  });

  it('starting only starts a focus session -- the task is not written', () => {
    const start = today.indexOf('onStart={(parent, draft) => {');
    const body = today.slice(start, today.indexOf('}}', start));
    expect(body).toMatch(/useFocusStore\.getState\(\)\.startSmallStep\(parent, draft\)/);
    expect(body).not.toMatch(/toggleDone|updateTask|completeTask|addTask|deleteTask/);
  });

  it('the store never reaches the task layer', () => {
    expect(store).not.toMatch(/taskStore|taskRepository|taskService/);
  });

  it('a paused step can be resumed without picking a focus task', () => {
    expect(focus).toMatch(/if \(phase === 'work' && !selectedTaskId && !smallStep\) \{/);
  });

  it('the focus screen shows the step and its task apart', () => {
    expect(focus).toMatch(/KÜÇÜK ADIM · \{smallStep\.minutes\} dk/);
    expect(focus).toMatch(/Asıl iş: \{smallStep\.parent\.title\} — bu adım onu tamamlamaz/);
  });

  it('the sheet says what the step does not do', () => {
    expect(sheetRaw).toMatch(/Bu adım asıl işi tamamlamaz ya da küçültmez/);
    // R03.07: the sentence moved to the shared flow copy; the sheet renders it.
    expect(sheetRaw).toMatch(/\{FLOW_COPY\.firstStep\}/);
    expect(read('lib/flowCopy.ts')).toMatch(/İlk adımı seç:/);
  });
});
