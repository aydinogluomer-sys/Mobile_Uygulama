/**
 * The layering contract.
 *
 *     UI ──▶ store ──▶ service ──▶ repository ──▶ supabase
 *
 * ## Why not every store has a service
 *
 * The instruction was explicit that a service which only forwards —
 * `service.updateNote() -> repository.updateNote()` and nothing else — adds
 * files and no meaning. So the rule below is not "every store gets a
 * service". It is:
 *
 *   a domain with ORCHESTRATION goes through a service;
 *   a domain that is CRUD and nothing else talks to its repository directly,
 *   and is listed here so that is a decision rather than an omission.
 *
 * Orchestration means: more than one write that must agree, an ordering rule,
 * a cross-aggregate check, or a derived value the caller must not supply.
 * Every entry in `ORCHESTRATED` below has at least one, named.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

/** A VALUE import from `repositories/`. `import type` is erased and harmless. */
const VALUE_REPO_IMPORT = /import\s+(?!type\s)\{[^}]*\}\s*from\s*['"][^'"]*repositories\//;
// `.from(` was the whole check, and it missed five `supabase.rpc(...)`
// calls across profileStore and subscriptionStore -- so this gate reported
// the layering complete while two stores talked to the database directly.
// An RPC is a database call.
const DB_CALL = /supabase\s*\.\s*(from|rpc)\s*\(/;

/**
 * Stores whose domain has real orchestration. Each must reach the database
 * through a service, never a repository.
 */
const ORCHESTRATED: { store: string; service: string; why: string }[] = [
  { store: 'habitStore.ts', service: 'habitService.ts',
    why: 'activation = capacity check + status write + willpower charge, in that order' },
  { store: 'logStore.ts', service: 'habitLogService.ts',
    why: 'state derivation, XP, and the insert/update/23505-recovery decision' },
  { store: 'willpowerStore.ts', service: 'capacityService.ts',
    why: 'the activation rule reads budget, load and the candidate habit together' },
  { store: 'recoveryStore.ts', service: 'recoveryService.ts',
    why: 'plan + reminder + analytics must agree, and completion writes two tables' },
  { store: 'routineStore.ts', service: 'routineService.ts',
    why: 'derived willpower cost and the activate-vs-queue capacity decision' },
  { store: 'taskStore.ts', service: 'taskService.ts',
    why: 'completed / status / completed_at are one fact across three columns' },
  { store: 'focusStore.ts', service: 'focusService.ts',
    why: 'a task is only credited for a session the database accepted' },
  // R02.03 — journal and notes write through the core outbox now (device first,
  // versioned delivery, conflict kept): that is orchestration, so they moved
  // here from CRUD_ONLY and reach the data layer through their service.
  { store: 'journalStore.ts', service: 'journalService.ts',
    why: 'a save is an outbox command delivered later, versioned by its text; a conflict keeps both texts' },
  { store: 'noteStore.ts', service: 'noteService.ts',
    why: 'a save is an outbox command delivered later, versioned by updated_at; a conflict keeps both notes' },
  { store: 'aiConversationStore.ts', service: 'aiCoachService.ts',
    why: 'a coach turn writes the thread, both messages and the staged proposal in an order that must survive the app dying mid-answer' },
];

/**
 * Stores whose domain is CRUD with no cross-aggregate rule. They use their
 * repository directly, deliberately.
 */
const CRUD_ONLY = new Set([
  'projectStore.ts', 'goalStore.ts', 'okrStore.ts',
  'deepWorkStore.ts', 'readingListStore.ts',
  'insightsStore.ts', 'lifeAreasStore.ts', 'profileStore.ts',
  // Was listed UI_ONLY -- "no persistence at all" -- while reading and
  // writing the user's tier and Focus-Point balance through three RPCs.
  'subscriptionStore.ts',
  // Hybrid, and CRUD is the honest half. Its OWN row (`user_onboarding`) is
  // one record with no cross-aggregate rule, so it uses its repository
  // directly like the rest of this list. The one orchestrated thing it does
  // -- turning the generated plan into habits -- it does NOT do itself: it
  // calls `services/routineService.installProposal`, the same entry point
  // `routineStore` uses, so the derived willpower cost and the
  // activate-vs-queue decision stay in one place.
  'onboardingStore.ts',
]);

/** No persistence at all — UI preference or transient state. */
const UI_ONLY = new Set([
  'themeStore.ts', 'drawerStore.ts', 'commandStore.ts',
  'notionStore.ts', 'notionSessionStore.ts', 'spotifyStore.ts',
  'googleCalendarStore.ts', 'lifeAreasStore.ts',
  // R05.02 — device-local only (AsyncStorage, per account) until migration 030
  // is applied; its one server effect is a habit log through logStore.
  'routineRunnerStore.ts',
  // R07.02 — device-local only (AsyncStorage, per account) until migration 031.
  'moodStore.ts',
  // F27 (NAV-13) — device-local progressive disclosure preferences (AsyncStorage, per account).
  'disclosureStore.ts',
]);

describe('services exist and hold real work', () => {
  const files = readdirSync(join(ROOT, 'services')).filter((f) => f.endsWith('.ts'));

  it('the service layer exists', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(ORCHESTRATED)('$service exists for $store', ({ service }) => {
    expect(files).toContain(service);
  });

  /**
   * Each service must hold the specific rule it exists for.
   *
   * A generic "does it branch enough" heuristic was tried first and was a bad
   * instrument in both directions: it missed a real decision expressed as a
   * ternary inside a `.map()`, and it would have passed a file padded with
   * meaningless conditionals. Naming the invariant is the point — if a rule
   * drifts back into a store, the failure says which rule and why.
   */
  const RULES: { service: string; rule: string; anchors: string[] }[] = [
    { service: 'habitService.ts', rule: 'capacity evaluated before the write, willpower charged after',
      anchors: ['evaluateActivation(', 'if (!verdict.allowed)', 'await spend('] },
    { service: 'habitLogService.ts', rule: 'value -> state -> XP, and the 23505 recovery decision',
      anchors: ['deriveState(', 'completionRatio(', "'23505'"] },
    { service: 'capacityService.ts', rule: 'budget and load are two separate ceilings',
      anchors: ['over_budget', 'over_capacity', 'dailyLoad('] },
    { service: 'recoveryService.ts', rule: 'the make-up log is written before the plan is closed',
      anchors: ['makeupFor(', "stage: 'log'", 'completePlan(params.plan.id)'] },
    { service: 'routineService.ts', rule: 'willpower cost is derived, and over-capacity habits queue',
      anchors: ['computeWillpowerCost(', "activateSet.has(h.name) ? 'active' : 'waiting'"] },
    { service: 'taskService.ts', rule: 'completed / status / completed_at stay consistent',
      anchors: ['status: completed ?', 'completed_at: completed ?'] },
    { service: 'focusService.ts', rule: 'a task is credited only for a session the database accepted',
      // R02.03 / F16: the session goes through the core outbox (which credits on
      // first server delivery); `focusService` reads fresh progress only after
      // `delivered` to decide auto-completion.
      anchors: ['if (!delivered)', 'sessionRecorded: false', 'fetchFocusTaskProgress('] },
    // The three below have no store: settings.tsx and BadHabitsTracker.tsx
    // use them directly. That is still inside the contract -- the rule the
    // UI must not break is reaching PAST a service to a repository.
    { service: 'webhookService.ts', rule: 'a side channel can never fail the completion that triggered it',
      anchors: ['new AbortController()', 'resetWebhookCache', '.catch(() => undefined)'] },
    { service: 'badHabitService.ts', rule: 'a future quit date is zero days, not a negative saving',
      anchors: ['elapsed <= 0', 'Math.floor('] },
    { service: 'exportService.ts', rule: 'pages are drained to the end, and an incomplete backup says so',
      anchors: ['truncated', 'nextCursor', 'headers: _omitted'] },
    { service: 'aiCoachService.ts', rule: 'the answer is durable before the turn reports success, and a stored proposal is revalidated before it is offered again',
      anchors: ["role: 'user'", "role: 'assistant'", 'validateCoachActions('] },
  ];

  it.each(RULES)('$service owns its rule: $rule', ({ service, anchors }) => {
    const code = read(`services/${service}`);
    const missing = anchors.filter((a) => !code.includes(a));
    expect(missing).toEqual([]);
  });

  it('no service reaches the database directly', () => {
    const offenders = files.filter((f) => DB_CALL.test(read(`services/${f}`)));
    expect(offenders).toEqual([]);
  });
});

describe('orchestrated stores go through their service', () => {
  it.each(ORCHESTRATED)('$store does not import a repository ($why)', ({ store }) => {
    expect(VALUE_REPO_IMPORT.test(read(`store/${store}`))).toBe(false);
  });

  it.each(ORCHESTRATED)('$store imports $service', ({ store, service }) => {
    expect(read(`store/${store}`)).toContain(`services/${service.replace('.ts', '')}`);
  });
});

describe('every store is classified', () => {
  const stores = readdirSync(join(ROOT, 'store')).filter((f) => f.endsWith('.ts'));
  const orchestrated = new Set(ORCHESTRATED.map((o) => o.store));

  it('leaves nothing unaccounted for', () => {
    // An unclassified store is one nobody decided about — which is how a
    // domain with real orchestration ends up talking to a repository by
    // default rather than by choice.
    const unclassified = stores.filter(
      (f) => !orchestrated.has(f) && !CRUD_ONLY.has(f) && !UI_ONLY.has(f),
    );
    expect(unclassified).toEqual([]);
  });

  it('a CRUD-only store may use its repository, but never supabase', () => {
    const offenders = [...CRUD_ONLY].filter((f) => DB_CALL.test(read(`store/${f}`)));
    expect(offenders).toEqual([]);
  });
});

describe('the UI reaches neither repositories nor the database', () => {
  const uiFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === '__tests__') continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(rel); continue; }
      if (/\.tsx?$/.test(e.name)) uiFiles.push(rel);
    }
  };
  walk('app'); walk('components');

  it('finds the UI (scanner sanity)', () => {
    expect(uiFiles.length).toBeGreaterThan(30);
  });

  it('no screen or component imports a repository', () => {
    const offenders = uiFiles.filter((f) => VALUE_REPO_IMPORT.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('no screen or component calls supabase.from', () => {
    const offenders = uiFiles.filter((f) => DB_CALL.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
