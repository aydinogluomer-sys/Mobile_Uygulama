import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FUNCTIONS_DIR = join(__dirname, '..', '..', '..', 'supabase', 'functions');

/**
 * Returns the canonical TypeScript source of an Edge Function (`handler.ts` +
 * `index.ts` when split into a pure handler + Deno.serve shell, otherwise
 * `index.ts` alone). Placing `handler.ts` first preserves lexical ordering
 * anchors (`if (!serviceKey)` < `spend_focus_points_v2` < `makeAnthropic`)
 * while keeping shell-level invariants (`Deno.serve`, `new Anthropic`, `crypto.randomUUID`)
 * visible to structural guards.
 */
export function edgeSource(slug: string): string {
  const dir = join(FUNCTIONS_DIR, slug);
  const indexPath = join(dir, 'index.ts');
  const handlerPath = join(dir, 'handler.ts');
  const indexSrc = readFileSync(indexPath, 'utf8');
  if (!existsSync(handlerPath)) return indexSrc;
  const handlerSrc = readFileSync(handlerPath, 'utf8');
  return `${handlerSrc}\n${indexSrc}`;
}
