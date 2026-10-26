/** EngineClient: spawns `turnwright-engine serve` and speaks LCP over stdio. */

import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import { EventEmitter } from "node:events";
import type {
  AgentEvent,
  ModelListResult,
  ApprovalRequest,
  ConfigSnapshot,
  ConfirmResult,
  ElicitationRequest,
  ElicitResult,
  InitializeResult,
  SessionInfo,
  SessionCompactResult,
  TurnStartResult,
  UserShellResult,
} from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";

export interface EngineClientOptions {
  enginePath: string;
  engineArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface PendingCall {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export type ApprovalHandler = (req: ApprovalRequest) => Promise<{ confirmResults: ConfirmResult[] }>;

export type ElicitationHandler = (req: ElicitationRequest) => Promise<ElicitResult>;

/** TuiClient is the surface the TUI consumes. EngineClient implements it;
 *  tests inject fakes. */
export interface TuiClient {
  on(event: "event", handler: (ev: AgentEvent) => void): unknown;
  on(event: string, handler: (...args: any[]) => void): unknown;
  removeAllListeners(): unknown;
  onApproval(h: ApprovalHandler): void;
  sessionNew(): Promise<{ sessionId: string }>;
  sessionResume(sessionId: string): Promise<{ sessionId: string }>;
  sessionContinue(): Promise<{ sessionId: string }>;
  sessionList(): Promise<{ sessions: SessionInfo[] }>;
  sessionDelete(sessionId: string): Promise<void>;
  sessionClose(sessionId: string): Promise<void>;
  turnStart(sessionId: string, input: string): Promise<TurnStartResult>;
  turnCancel(sessionId: string): Promise<void>;
  modelSet(sessionId: string, model: string): Promise<{ model: string }>;
  modelList(): Promise<ModelListResult>;
  sessionSetPermission(sessionId: string, mode: string): Promise<void>;
  sessionCompact(sessionId: string): Promise<SessionCompactResult>;
  sessionUserShell(sessionId: string, command: string, timeoutMs?: number): Promise<UserShellResult>;
  onElicitation(h: ElicitationHandler): void;
  configGet(): Promise<ConfigSnapshot>;
  dispose(): void;
}

export class EngineClient extends EventEmitter implements TuiClient {
  private proc: ChildProcess;
  private seq = 0;
  private pending = new Map<number | string, PendingCall>();
  private approvalHandler: ApprovalHandler | null = null;
  private elicitationHandler: ElicitationHandler | null = null;
  private rl: readline.Interface;
  readonly info: Promise<InitializeResult>;

  constructor(opts: EngineClientOptions) {
    super();
    this.proc = spawn(opts.enginePath, ["serve", ...(opts.engineArgs ?? [])], {
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.rl = readline.createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.onLine(line));
    this.proc.on("error", (err) => {
      const wrapped = new Error(`cannot start engine at ${opts.enginePath}: ${err.message}`);
      for (const p of this.pending.values()) p.reject(wrapped);
      this.pending.clear();
      this.emit("engineError", wrapped);
    });
    this.proc.on("exit", (code) => {
      const err = new Error(`engine exited (code ${code})`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.emit("exit", code);
    });
    this.info = this.call<InitializeResult>("initialize", {}).then((r) => {
      if (r.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `LCP version mismatch: engine=${r.protocolVersion} client=${PROTOCOL_VERSION}`,
        );
      }
      return r;
    });
  }

  onApproval(h: ApprovalHandler): void {
    this.approvalHandler = h;
  }

  onElicitation(h: ElicitationHandler): void {
    this.elicitationHandler = h;
  }

  private onLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // not protocol traffic; engine logs go to stderr
    }
    if (msg.method === "agent/event") {
      this.emit("event", msg.params as AgentEvent);
      return;
    }
    if (msg.method === "approval/request" && msg.id !== undefined) {
      void this.handleApproval(msg.id, msg.params as ApprovalRequest);
      return;
    }
    if (msg.method === "elicitation/request" && msg.id !== undefined) {
      void this.handleElicitation(msg.id, msg.params as ElicitationRequest);
      return;
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    }
  }

  private async handleApproval(id: string, req: ApprovalRequest): Promise<void> {
    let result: { confirmResults: ConfirmResult[] };
    if (this.approvalHandler) {
      result = await this.approvalHandler(req);
    } else {
      result = {
        confirmResults: req.tool_calls.map((tc) => ({ confirmed: false, tool_call: tc })),
      };
    }
    this.send({ jsonrpc: "2.0", id, result });
  }

  private async handleElicitation(id: string, req: ElicitationRequest): Promise<void> {
    const result: ElicitResult = this.elicitationHandler
      ? await this.elicitationHandler(req)
      : { action: "decline" };
    this.send({ jsonrpc: "2.0", id, result });
  }

  private send(msg: Record<string, unknown>): void {
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  call<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  sessionNew(): Promise<{ sessionId: string }> {
    return this.call("session/new", {});
  }
  sessionResume(sessionId: string): Promise<{ sessionId: string }> {
    return this.call("session/resume", { sessionId });
  }
  sessionContinue(): Promise<{ sessionId: string }> {
    return this.call("session/continue", {});
  }
  sessionList(): Promise<{ sessions: SessionInfo[] }> {
    return this.call("session/list", {});
  }
  sessionDelete(sessionId: string): Promise<void> {
    return this.call("session/delete", { sessionId });
  }
  sessionClose(sessionId: string): Promise<void> {
    return this.call("session/close", { sessionId });
  }
  turnStart(sessionId: string, input: string): Promise<TurnStartResult> {
    return this.call("turn/start", { sessionId, input });
  }
  turnCancel(sessionId: string): Promise<void> {
    return this.call("turn/cancel", { sessionId });
  }
  modelSet(sessionId: string, model: string): Promise<{ model: string }> {
    return this.call("model/set", { sessionId, model });
  }
  configGet(): Promise<ConfigSnapshot> {
    return this.call("config/get", {});
  }
  modelList(): Promise<ModelListResult> {
    return this.call("model/list", {});
  }
  sessionSetPermission(sessionId: string, mode: string): Promise<void> {
    return this.call("session/set_permission", { sessionId, mode });
  }
  sessionCompact(sessionId: string): Promise<SessionCompactResult> {
    return this.call("session/compact", { sessionId });
  }
  sessionUserShell(sessionId: string, command: string, timeoutMs = 0): Promise<UserShellResult> {
    return this.call("session/user_shell", { sessionId, command, timeoutMs });
  }

  dispose(): void {
    this.proc.kill();
  }
}
