/** Lathe Core Protocol (LCP) v1 — shared types between engine and TUI. */

export const PROTOCOL_VERSION = 1;

export interface Brand {
  name: string;
  tagline: string;
  accent: string;
  logo: string[];
  theme: string;
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

export interface ConfigSnapshot {
  provider: string;
  model: string;
  permission: string;
  maxIters: number;
  cwd: string;
  brand: Brand;
}
