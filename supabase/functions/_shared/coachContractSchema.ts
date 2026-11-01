/**
 * Canonical Single-Source-of-Truth Schema Bounds, Tool Habit Contract, and
 * Anthropic Stream Event Reducer shared between Supabase Edge Functions
 * (`generate-routine`) and verified against `frontend/lib/routineProposal.ts`
 * + `frontend/lib/coachActionsV2.ts` in Jest & Deno 2 CI.
 */

export const COACH_SCHEMA_BOUNDS = {
  MAX_HABIT_NAME_LENGTH: 80,
  MAX_TITLE_LENGTH: 100,
  MAX_GOAL_LENGTH: 400,
  MAX_HABITS_PER_PROPOSAL: 10,
  MAX_ESTIMATED_MINUTES: 1440,
  MAX_UNIT_LENGTH: 24,
  MAX_DAILY_GOAL: 100000,
  VALID_DIFFICULTIES: [1, 3, 5] as const,
  PERSISTABLE_TRACKING_TYPES: ['binary', 'numeric'] as const,
} as const;

export const ALL_COACH_ACTION_TYPES = [
  'propose_habit',
  'propose_habit_plan',
  'log_habit',
  'edit_habit_schedule',
  'pause_habit',
  'move_task',
  'suggest_small_step',
  'lighten_today',
  'edit_reminder_time',
  'lighten_week',
] as const;

export type CoachActionTypeName = (typeof ALL_COACH_ACTION_TYPES)[number];

export const COACH_HABIT_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      maxLength: COACH_SCHEMA_BOUNDS.MAX_HABIT_NAME_LENGTH,
      description: 'Kısa alışkanlık adı, örn "Kitap Oku".',
    },
    tracking_type: {
      type: 'string',
      enum: [...COACH_SCHEMA_BOUNDS.PERSISTABLE_TRACKING_TYPES],
      description: 'Ölçülebilir hedefi varsa numeric, yoksa binary.',
    },
    difficulty: {
      type: 'integer',
      enum: [...COACH_SCHEMA_BOUNDS.VALID_DIFFICULTIES],
      description: '1 Kolay, 3 Orta, 5 Zor.',
    },
    estimated_minutes: {
      type: 'integer',
      minimum: 1,
      maximum: COACH_SCHEMA_BOUNDS.MAX_ESTIMATED_MINUTES,
      description: 'Günlük TAHMİNİ SÜRE maliyeti (dakika). Hedef değildir.',
    },
    unit: {
      type: 'string',
      maxLength: COACH_SCHEMA_BOUNDS.MAX_UNIT_LENGTH,
      description: 'daily_goal birimi: "dakika", "sayfa", "bardak". daily_goal ile birlikte gelir.',
    },
    daily_goal: {
      type: 'number',
      exclusiveMinimum: 0,
      maximum: COACH_SCHEMA_BOUNDS.MAX_DAILY_GOAL,
      description: 'Günlük ölçülebilir hedef. unit ile birlikte gelir. Kullanıcı söylemediyse YAZMA.',
    },
    target_direction: {
      type: 'string',
      enum: ['at_least', 'at_most'],
      description: 'En az mı en çok mu. Varsayılan at_least.',
    },
    frequency_config: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
        days: {
          type: 'array',
          items: { type: 'integer', minimum: 0, maximum: 6 },
          description: 'Yalnızca kind=weekly ile. Pzt=0 … Paz=6.',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 31,
          description: 'Haftada/ayda kaç kez. kind=daily ile kullanılmaz.',
        },
        part_of_day: {
          type: 'array',
          items: { type: 'string', enum: ['morning', 'afternoon', 'evening'] },
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  required: ['name', 'tracking_type', 'difficulty', 'estimated_minutes'],
  additionalProperties: false,
} as const;

export function assertCanonicalCoachHabitSchema(schema: {
  properties: {
    name: { maxLength: number };
    unit: { maxLength: number };
    estimated_minutes: { maximum: number };
    daily_goal: { maximum: number };
  };
}): void {
  if (
    schema.properties.name.maxLength !== COACH_SCHEMA_BOUNDS.MAX_HABIT_NAME_LENGTH ||
    schema.properties.unit.maxLength !== COACH_SCHEMA_BOUNDS.MAX_UNIT_LENGTH ||
    schema.properties.estimated_minutes.maximum !== COACH_SCHEMA_BOUNDS.MAX_ESTIMATED_MINUTES ||
    schema.properties.daily_goal.maximum !== COACH_SCHEMA_BOUNDS.MAX_DAILY_GOAL
  ) {
    throw new Error('COACH_HABIT_SCHEMA bounds drifted from canonical COACH_SCHEMA_BOUNDS');
  }
}

/**
 * Incrementally extracts the decoded `reply` string from a partial JSON stream
 * emitted by Anthropic `input_json_delta` events on the forced `coach_response`
 * tool call (`{"reply":"Merhaba...","actions":[...]}`).
 */
export function extractPartialReplyFromToolJson(partialJson: string): string {
  const match = /"reply"\s*:\s*"/.exec(partialJson);
  if (!match) return '';

  let idx = match.index + match[0].length;
  let out = '';

  while (idx < partialJson.length) {
    const ch = partialJson[idx];
    if (ch === '"') return out;
    if (ch !== '\\') {
      out += ch;
      idx += 1;
      continue;
    }

    if (idx + 1 >= partialJson.length) return out;
    const esc = partialJson[idx + 1];
    switch (esc) {
      case '"':
      case '\\':
      case '/':
        out += esc;
        idx += 2;
        break;
      case 'n':
        out += '\n';
        idx += 2;
        break;
      case 'r':
        out += '\r';
        idx += 2;
        break;
      case 't':
        out += '\t';
        idx += 2;
        break;
      case 'b':
        out += '\b';
        idx += 2;
        break;
      case 'f':
        out += '\f';
        idx += 2;
        break;
      case 'u': {
        if (idx + 6 > partialJson.length) return out;
        const hex = partialJson.slice(idx + 2, idx + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          idx += 6;
        } else {
          idx += 2;
        }
        break;
      }
      default:
        out += esc;
        idx += 2;
        break;
    }
  }

  return out;
}

export type StreamDeltaSink = (delta: { reply?: string; text?: string }) => void;

export type NormalizedAnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown };

export type NormalizedAnthropicMessage = {
  stop_reason: string | null;
  content: NormalizedAnthropicBlock[];
};

/**
 * Resolves either a non-streaming `Anthropic.Message` OR an `AsyncIterable`
 * stream produced by `client.messages.create({ ..., stream: true })`, emitting
 * live `reply`/`text` deltas as chunks arrive and returning the assembled
 * `{ stop_reason, content }` message structure for identical validation.
 */
export async function resolveAnthropicMessage(
  rawOrStream: unknown,
  onDelta?: StreamDeltaSink,
): Promise<NormalizedAnthropicMessage> {
  if (
    rawOrStream &&
    typeof rawOrStream === 'object' &&
    'content' in rawOrStream &&
    Array.isArray((rawOrStream as { content: unknown }).content)
  ) {
    const msg = rawOrStream as { stop_reason?: string | null; content: NormalizedAnthropicBlock[] };
    return { stop_reason: msg.stop_reason ?? null, content: msg.content };
  }

  const iterable = rawOrStream as AsyncIterable<{
    type?: string;
    index?: number;
    content_block?: { type?: string; name?: string; text?: string };
    delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string | null };
  }>;

  const blocks = new Map<number, { type: 'text' | 'tool_use'; name?: string; textBuf: string; jsonBuf: string }>();
  let stopReason: string | null = null;
  let lastReplyLen = 0;

  for await (const ev of iterable) {
    if (ev.type === 'content_block_start' && typeof ev.index === 'number') {
      const bType = ev.content_block?.type === 'tool_use' ? 'tool_use' : 'text';
      blocks.set(ev.index, {
        type: bType,
        name: ev.content_block?.name,
        textBuf: ev.content_block?.text ?? '',
        jsonBuf: '',
      });
    } else if (ev.type === 'content_block_delta' && typeof ev.index === 'number') {
      const entry = blocks.get(ev.index) ?? {
        type: ev.delta?.type === 'input_json_delta' ? 'tool_use' : 'text',
        textBuf: '',
        jsonBuf: '',
      };
      blocks.set(ev.index, entry);

      if (ev.delta?.type === 'text_delta' && ev.delta.text) {
        entry.textBuf += ev.delta.text;
        onDelta?.({ text: ev.delta.text });
      } else if (ev.delta?.type === 'input_json_delta' && ev.delta.partial_json) {
        entry.jsonBuf += ev.delta.partial_json;
        const partialReply = extractPartialReplyFromToolJson(entry.jsonBuf);
        if (partialReply.length > lastReplyLen) {
          lastReplyLen = partialReply.length;
          onDelta?.({ reply: partialReply });
        }
      }
    } else if (ev.type === 'message_delta' && ev.delta && 'stop_reason' in ev.delta) {
      stopReason = ev.delta.stop_reason ?? stopReason;
    }
  }

  const ordered = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  const content: NormalizedAnthropicBlock[] = ordered.map((b) => {
    if (b.type === 'tool_use') {
      let parsed: unknown = null;
      try {
        parsed = b.jsonBuf ? JSON.parse(b.jsonBuf) : {};
      } catch {
        parsed = null;
      }
      return { type: 'tool_use', name: b.name ?? 'coach_response', input: parsed };
    }
    return { type: 'text', text: b.textBuf };
  });

  return { stop_reason: stopReason, content };
}
