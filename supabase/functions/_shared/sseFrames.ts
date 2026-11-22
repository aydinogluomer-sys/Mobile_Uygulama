/**
 * Shared Server-Sent Events (SSE) wire codec between Supabase Edge Functions
 * (`generate-routine`) and the React Native / Web client (`aiStreamService.ts`).
 * Pure TypeScript — zero `Deno.*` globals so both Deno 2 and Jest import it directly.
 */

export const SSE_EVENTS = ['delta', 'done', 'error'] as const;
export type SseEvent = (typeof SSE_EVENTS)[number];
export type SseFrame = { event: string; data: Record<string, unknown> };

export function encodeFrame(event: SseEvent, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function drainFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames: SseFrame[] = [];
  let cursor = 0;

  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor);
    if (boundary === -1) break;
    const rawBlock = normalized.slice(cursor, boundary);
    cursor = boundary + 2;

    if (!rawBlock.trim()) continue;
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of rawBlock.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || 'message';
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }

    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join('\n'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frames.push({ event: eventName, data: parsed as Record<string, unknown> });
      }
    } catch {
      /* ignore malformed frame */
    }
  }

  return { frames, rest: normalized.slice(cursor) };
}
