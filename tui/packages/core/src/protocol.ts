/** Line-delimited Control Protocol (LCP) v2 — shared types between engine and TUI. */

export const PROTOCOL_VERSION = 2;

export interface Brand {
  name: string;
  tagline: string;
  accent: string;
  logo: string[];
  theme: string;
  /** status-line slot order; empty/absent = default layout */
  status?: string[];
}

export interface InitializeResult {
  protocolVersion: number;
  version: string;
  brand: Brand;
  provider: string;
  model: string;
  cwd: string;
  capabilities: Record<string, boolean>;
}

export interface SessionInfo {
  session_id: string;
  agent_name?: string;
  summary?: string;
}

/** Events forwarded 1:1 from agentscope-go, with "type" + "session_id". */
export interface AgentEvent {
  type: string;
  session_id: string;
  reply_id?: string;
  block_id?: string;
  delta?: string;
  tool_call_id?: string;
  tool_call_name?: string;
  tool_call_input?: string;
  state?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  finished_reason?: string;
  error?: { message: string };
  message?: string;
  tool_calls?: ToolCallBlock[];
  /** Custom events (compacted, steering, interrupt, overflow recovery). */
  name?: string;
  value?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolCallBlock {
  type: string;
  id: string;
  name: string;
  input: string;
  state?: string;
  suggested_rules?: unknown[];
  extra?: Record<string, unknown>;
}

export interface ConfirmResult {
  confirmed: boolean;
  tool_call: ToolCallBlock;
  rules?: unknown[];
}

export interface ApprovalRequest {
  session_id: string;
  reply_id: string;
  tool_calls: ToolCallBlock[];
}

export interface ModelCardInfo {
  name: string;
  provider: string;
  contextSize?: number;
  thinking?: boolean;
}

export interface ModelListResult {
  models: ModelCardInfo[];
  provider: string;
  current: string;
}

export interface ConfigSnapshot {
  provider: string;
  model: string;
  permission: string;
  maxIters: number;
  cwd: string;
  brand: Brand;
}

/** turn/start result: input accepted; queued = steered into a running turn. */
export interface TurnStartResult {
  started: boolean;
  queued?: boolean;
}

/** session/compact result. */
export interface SessionCompactResult {
  compacted: boolean;
}

/** session/user_shell result: the command id correlating the user_shell_* events. */
export interface UserShellResult {
  commandId: string;
}

/** MCP elicitation request: a server asks the user for input mid tool call. */
export interface ElicitationRequest {
  session_id: string;
  message: string;
  /** JSON Schema for the requested form data; absent when the server sent none. */
  requested_schema?: unknown;
}

/** Client's answer to an elicitation request. */
export interface ElicitResult {
  /** "accept" | "decline" | "cancel" */
  action: string;
  /** Submitted form data; sent to the server only on accept. */
  content?: Record<string, unknown>;
}
