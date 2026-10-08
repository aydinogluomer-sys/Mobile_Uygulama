/**
 * R02.04 — the core outbox's pending / failed / conflicting counts, live, so
 * a screen can show that journal, note, recovery or focus changes are still
 * waiting (or need the user) instead of looking saved.
 */
import { useEffect, useState } from 'react';
import { summary, emptyOutbox, type OutboxSummary } from '../lib/outbox';
import { coreOutbox } from '../services/coreOutbox';

export function useCoreOutboxSync(): OutboxSummary {
  const [s, setS] = useState<OutboxSummary>(() => coreOutbox.sync());
  useEffect(() => {
    void coreOutbox.ensure().then(() => setS(coreOutbox.sync()));
    return coreOutbox.subscribe((box) => setS(summary(box ?? emptyOutbox(''))));
  }, []);
  return s;
}
