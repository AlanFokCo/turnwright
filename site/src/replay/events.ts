import { z } from "zod";

/** The 14 event types the TUI renders (docs/print-mode.md table). Replay
 *  scripts are restricted to this vocabulary so the player stays honest to
 *  the real LCP stream; the event body itself stays open (passthrough) like
 *  the upstream AgentEvent type. */
export const REPLAY_EVENT_TYPES = [
  "reply_start",
  "text_block_start",
  "text_block_delta",
  "thinking_block_delta",
  "tool_call_start",
  "tool_call_delta",
  "tool_call_end",
  "tool_result_text_delta",
  "tool_result_end",
  "tool_policy_denied",
  "require_user_confirm",
  "model_call_end",
  "reply_end",
  "exceed_max_iters",
] as const;

export const ToolCallLikeSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    name: z.string(),
    input: z.string(),
    state: z.string().optional(),
    suggested_rules: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const AgentEventLikeSchema = z
  .object({
    type: z.string(),
    session_id: z.string().optional(),
    reply_id: z.string().optional(),
    block_id: z.string().optional(),
    delta: z.string().optional(),
    tool_call_id: z.string().optional(),
    tool_call_name: z.string().optional(),
    tool_call_input: z.string().optional(),
    state: z.string().optional(),
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_creation_tokens: z.number().optional(),
    cache_read_tokens: z.number().optional(),
    finished_reason: z.string().optional(),
    error: z.object({ message: z.string() }).optional(),
    message: z.string().optional(),
    tool_calls: z.array(ToolCallLikeSchema).optional(),
  })
  .passthrough();

export const TimedEventSchema = z.object({
  t: z.number().int().nonnegative(),
  ev: AgentEventLikeSchema,
});

export type AgentEventLike = z.infer<typeof AgentEventLikeSchema>;
export type ToolCallLike = z.infer<typeof ToolCallLikeSchema>;
export type TimedEvent = z.infer<typeof TimedEventSchema>;

/** Validate an authored replay script; throws a ZodError naming the path. */
export function validateScript(script: unknown): TimedEvent[] {
  return z.array(TimedEventSchema).parse(script);
}
