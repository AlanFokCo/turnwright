/** lathe TUI root: wires the LCP client event stream into chat state. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { execSync } from "node:child_process";
import { basename } from "node:path";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import {
  defaultTextareaKeyBindings,
  type InputKeyBinding, type KeyEvent, type ScrollBoxRenderable, type TextareaRenderable,
} from "@opentui/core";
import {
  type AgentEvent, type ApprovalRequest,
  type ConfirmResult, type InitializeResult, type TuiClient,
} from "@lathe/core";
import { builtinTheme, loadTheme, type Theme } from "./theme.js";
import {
  initialChatState, pushNotice, pushUser, reduce, type ChatState, type ReplyEntry,
} from "./store.js";
import { ApprovalDialog, MessageView, StatusLine, WelcomeHero } from "./components.js";
import { ListPicker, type PickerItem } from "./pickers.js";
import { completeSlash, SLASH_COMMANDS } from "./slash.js";
import { completeAtPath, expandAtFiles } from "./atfile.js";

type Picker = { kind: "sessions" | "model" | "theme"; items: PickerItem[] } | null;

// Normal-mode keys map onto the textarea's native editing actions; mode
// switches and insertion blocking live in onInputKeyDown.
const vimNormalBindings: InputKeyBinding[] = [
  { name: "h", action: "move-left" },
  { name: "l", action: "move-right" },
  { name: "w", action: "word-forward" },
  { name: "b", action: "word-backward" },
  { name: "0", action: "line-home" },
  { name: "$", action: "line-end" },
  { name: "x", action: "delete" },
  { name: "d", action: "delete-to-line-end", shift: true },
  { name: "a", action: "move-right" },
  { name: "i", action: "line-home", shift: true },
  { name: "a", action: "line-end", shift: true },
];

// Keys the normal-mode binding table acts on; everything else gets eaten.
// Bare "d" is excluded (no dd chord in the minimal set; D = delete-to-line-end).
const vimNormalMotions = new Set(["h", "l", "w", "b", "0", "$", "x"]);

// Insert-mode adds shift+enter for newline on terminals that report it;
// ctrl+j always works via the default linefeed binding.
const insertBindings: InputKeyBinding[] = [
  ...defaultTextareaKeyBindings,
  { name: "return", shift: true, action: "newline" },
];

function gitBranch(cwd: string): string {
  try {
    return execSync("git branch --show-current", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {
    return "";
  }
}

export function App({ client, info, resume, noAnim }: {
  client: TuiClient; info: InitializeResult; resume: string | null; noAnim?: boolean;
}) {
  const brand = info.brand;
  const [themeName, setThemeName] = useState(brand.theme || "lathe-dark");
  const theme = useMemo(() => {
    const t = loadTheme(themeName, brand);
    return noAnim ? { ...t, motion: false } : t;
  }, [themeName, brand, noAnim]);
  const [chat, setChat] = useState<ChatState>(initialChatState);
  const [sessionId, setSessionId] = useState("");
  const [model, setModel] = useState(info.model);
  const [permission, setPermission] = useState("accept_edits");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [input, setInput] = useState("");
  const [branch, setBranch] = useState(() => gitBranch(info.cwd));
  const [vimEnabled, setVimEnabled] = useState(false);
  const [vimMode, setVimMode] = useState<"insert" | "normal">("insert");
  const approvalResolve = useRef<((r: { confirmResults: ConfirmResult[] }) => void) | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const renderer = useRenderer();
  const { width: termWidth } = useTerminalDimensions();
  // The chat input is uncontrolled: the native buffer is the source of truth.
  // React state only mirrors it for completion candidates, because the
  // reconciler delivers change/enter events with stale closures under fast input.
  const inputRef = useRef<TextareaRenderable | null>(null);
  const cursorLineRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef<number | null>(null);
  const setInputValue = useCallback((v: string) => {
    if (inputRef.current) inputRef.current.setText(v);
    setInput(v);
  }, []);

  useEffect(() => {
    if (!vimEnabled) return;
    renderer.setCursorStyle(
      vimMode === "normal" ? { style: "block", blinking: false } : { style: "line", blinking: true },
    );
  }, [vimEnabled, vimMode, renderer]);

  useEffect(() => {
    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b]0;${brand.name} — ${basename(info.cwd)}\x07`);
    }
  }, [brand, info.cwd]);

  useEffect(() => {
    // Token batching (~60fps): bursts of stream events coalesce into one React
    // update per 16ms window; sparse events still render immediately.
    let queue: AgentEvent[] = [];
    let lastFlush = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (queue.length === 0) return;
      const batch = queue;
      queue = [];
      lastFlush = performance.now();
      setChat((st) => batch.reduce(reduce, st));
      if (batch.some((e) => e.type === "reply_end")) setBranch(gitBranch(info.cwd));
    };
    const onEvent = (ev: AgentEvent) => {
      queue.push(ev);
      const since = performance.now() - lastFlush;
      if (since >= 16) flush();
      else if (!timer) timer = setTimeout(flush, 16 - since);
    };
    client.on("event", onEvent);
    client.on("exit", (code: number) => {
      setChat((st) => pushNotice(
        st,
        `engine exited (code ${code}) — restart ${brand.name} to continue; session state is checkpointed`,
        "error",
      ));
    });
    client.onApproval(
      (req) =>
        new Promise((resolve) => {
          approvalResolve.current = resolve;
          setApproval(req);
        }),
    );
    const open = resume === "continue"
      ? client.sessionContinue()
      : resume
        ? client.sessionResume(resume)
        : client.sessionNew();
    open
      .then((s) => {
        setSessionId(s.sessionId);
        if (resume) setChat((st) => pushNotice(st, `resumed session ${s.sessionId.slice(0, 8)}`));
      })
      .catch((e) => setChat((st) => pushNotice(st, `session: ${e.message}`, "error")));
    return () => {
      if (timer) clearTimeout(timer);
      client.removeAllListeners();
    };
  }, [client, resume, info.cwd, brand]);

  const answerApproval = useCallback(
    (decision: "once" | "deny" | "always") => {
      if (!approval || !approvalResolve.current) return;
      const resolve = approvalResolve.current;
      approvalResolve.current = null;
      setApproval(null);
      resolve({
        confirmResults: approval.tool_calls.map((tc) => ({
          confirmed: decision !== "deny",
          tool_call: tc,
          ...(decision === "always" && tc.suggested_rules ? { rules: tc.suggested_rules } : {}),
        })),
      });
    },
    [approval],
  );

  const openPicker = useCallback(async (kind: NonNullable<Picker>["kind"]) => {
    if (kind === "sessions") {
      const { sessions } = await client.sessionList();
      setPicker({
        kind,
        items: sessions.map((s) => ({
          name: s.session_id.slice(0, 8), description: s.summary ?? "", value: s.session_id,
        })),
      });
    } else if (kind === "model") {
      const { models } = await client.modelList();
      setPicker({
        kind,
        items: models.map((m) => ({
          name: m.name,
          description: [m.contextSize ? `${Math.round(m.contextSize / 1024)}k ctx` : "", m.thinking ? "thinking" : ""]
            .filter(Boolean).join(" · "),
          value: m.name,
        })),
      });
    } else {
      setPicker({
        kind,
        items: ["lathe-dark", "lathe-light"].map((t) => ({ name: t, value: t })),
      });
    }
  }, [client]);

  const pickValue = useCallback(async (value: string) => {
    const kind = picker?.kind;
    setPicker(null);
    if (kind === "sessions") {
      try {
        await client.sessionResume(value);
        setSessionId(value);
        setChat(initialChatState);
        setChat((st) => pushNotice(st, `resumed session ${value.slice(0, 8)}`));
      } catch (e) {
        setChat((st) => pushNotice(st, `resume: ${(e as Error).message}`, "error"));
      }
    } else if (kind === "model") {
      try {
        await client.modelSet(sessionId, value);
        setModel(value);
        setChat((st) => pushNotice(st, `model → ${value}`));
      } catch (e) {
        setChat((st) => pushNotice(st, `model: ${(e as Error).message}`, "error"));
      }
    } else if (kind === "theme") {
      setThemeName(value);
      setChat((st) => pushNotice(st, `theme → ${value}`));
    }
  }, [picker, client, sessionId]);

  const handleSlash = useCallback(async (cmd: string) => {
    const [name, ...rest] = cmd.split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (name) {
      case "/quit": case "/exit":
        client.dispose();
        process.exit(0);
        break;
      case "/clear":
        setChat(initialChatState);
        return;
      case "/help":
        setChat((st) => pushNotice(
          st,
          SLASH_COMMANDS.map((c) => `${c.usage ?? c.name} — ${c.description}`).join("\n"),
        ));
        return;
      case "/model":
        if (arg) await pickValueModel(arg);
        else void openPicker("model");
        return;
      case "/sessions":
        void openPicker("sessions");
        return;
      case "/theme":
        if (arg) {
          setThemeName(arg);
          setChat((st) => pushNotice(st, `theme → ${arg}`));
        }
        else void openPicker("theme");
        return;
      case "/permission": {
        if (!arg) {
          setChat((st) => pushNotice(st, `permission: ${permission} (modes: default|accept_edits|explore|bypass|dont_ask)`));
          return;
        }
        try {
          await client.sessionSetPermission(sessionId, arg);
          setPermission(arg);
          setChat((st) => pushNotice(st, `permission → ${arg}`));
        } catch (e) {
          setChat((st) => pushNotice(st, `permission: ${(e as Error).message}`, "error"));
        }
        return;
      }
      case "/status":
        setChat((st) => pushNotice(
          st,
          `session ${sessionId.slice(0, 8)} · model ${model} · permission ${permission} · cwd ${info.cwd}`,
        ));
        return;
      case "/vim": {
        const on = arg ? arg !== "off" : !vimEnabled;
        setVimEnabled(on);
        setVimMode("insert");
        if (!on) renderer.setCursorStyle({ style: "default" });
        setChat((st) => pushNotice(st, `vim mode ${on ? "on (esc/ctrl+g: normal · i/a/A/I: insert)" : "off"}`));
        return;
      }
      case "/compact":
        setChat((st) => pushNotice(
          st,
          "manual /compact needs an exported API in agentscope-go; agent-driven and token-threshold auto-compact are already active",
          "warn",
        ));
        return;
      default:
        setChat((st) => pushNotice(st, `unknown command: ${name} (try /help)`, "warn"));
    }
  }, [client, sessionId, model, permission, info.cwd, openPicker, vimEnabled, renderer]);

  const pickValueModel = useCallback(async (m: string) => {
    try {
      await client.modelSet(sessionId, m);
      setModel(m);
      setChat((st) => pushNotice(st, `model → ${m}`));
    } catch (e) {
      setChat((st) => pushNotice(st, `model: ${(e as Error).message}`, "error"));
    }
  }, [client, sessionId]);

  const submit = useCallback(
    (raw: string) => {
      const t = raw.trim();
      if (!t || !sessionId || chat.busy) return;
      if (t.startsWith("/")) {
        void handleSlash(t);
        return;
      }
      const { text, missing } = expandAtFiles(t, info.cwd);
      for (const m of missing) {
        setChat((st) => pushNotice(st, `@${m} not found`, "warn"));
      }
      setChat((st) => pushUser(st, t));
      client.turnStart(sessionId, text).catch((e) =>
        setChat((st) => pushNotice(st, `turn: ${e.message}`, "error")),
      );
    },
    [client, sessionId, chat.busy, handleSlash, info.cwd],
  );

  // completions: trailing @path or leading /command
  const atMatch = input.match(/@([^\s@]*)$/);
  const atCandidates = atMatch ? completeAtPath(atMatch[1] ?? "", info.cwd, 8) : [];
  const slashCandidates = input.startsWith("/") && !input.includes(" ")
    ? completeSlash(input).map((c) => c.name)
    : [];
  const candidates = [...atCandidates.map((c) => "@" + c), ...slashCandidates];

  const applyCompletion = useCallback((c: string) => {
    const cur = inputRef.current?.plainText ?? input;
    const next = c.startsWith("@")
      ? cur.replace(/@[^\s@]*$/, () => c)
      : c + " ";
    setInputValue(next);
  }, [input, setInputValue]);

  const onInputKeyDown = useCallback((key: KeyEvent) => {
    if (key.name === "return" && !key.shift && !key.ctrl && !key.meta) {
      const v = inputRef.current?.plainText ?? "";
      if (!v.trim() || !sessionId || chat.busy) return;
      key.preventDefault();
      setInputValue("");
      const h = historyRef.current;
      if (h[h.length - 1] !== v) h.push(v);
      histIdxRef.current = null;
      submit(v);
      return;
    }
    // prompt history: walk with up/down from the first/last line of the buffer
    if ((key.name === "up" || key.name === "down") && !(vimEnabled && vimMode === "normal")) {
      const h = historyRef.current;
      if (h.length === 0) return;
      const lines = (inputRef.current?.plainText ?? "").split("\n").length;
      const navigating = histIdxRef.current !== null;
      if (key.name === "up" && (navigating || cursorLineRef.current === 0)) {
        const next = navigating ? Math.max(0, histIdxRef.current! - 1) : h.length - 1;
        histIdxRef.current = next;
        key.preventDefault();
        setInputValue(h[next]!);
      } else if (key.name === "down" && (navigating || cursorLineRef.current === lines - 1)) {
        if (navigating && histIdxRef.current! < h.length - 1) {
          histIdxRef.current! += 1;
          key.preventDefault();
          setInputValue(h[histIdxRef.current!]!);
        } else {
          histIdxRef.current = null;
          key.preventDefault();
          setInputValue("");
        }
      }
      return;
    }
    if (!vimEnabled) return;
    if (vimMode === "insert") {
      // esc works on kitty/disambiguate terminals; ctrl+g is the universal escape
      if (key.name === "escape" || (key.ctrl && key.name === "g")) {
        key.preventDefault();
        setVimMode("normal");
      }
      return;
    }
    // normal mode: i/a/I/A switch to insert; their cursor moves ride along via
    // vimNormalBindings, except bare "i" which has no binding and must be eaten.
    if (key.ctrl || key.meta) {
      if (!(key.ctrl && key.name === "c")) key.preventDefault();
      return;
    }
    if (key.name === "i" || key.name === "a") {
      if (key.name === "i" && !key.shift) key.preventDefault();
      setVimMode("insert");
      return;
    }
    if (!vimNormalMotions.has(key.name)) key.preventDefault();
  }, [sessionId, chat.busy, submit, setInputValue, vimEnabled, vimMode]);

  useKeyboard((key) => {
    if (picker) {
      if (key.name === "escape") setPicker(null);
      return; // select handles its own keys
    }
    if (key.ctrl && key.name === "c") {
      if (chat.busy && sessionId) {
        void client.turnCancel(sessionId);
        return;
      }
      client.dispose();
      process.exit(0);
    }
    if (key.name === "pageup") scrollRef.current?.scrollBy(-20);
    if (key.name === "pagedown") scrollRef.current?.scrollBy(20);
    if (key.name === "tab" && candidates.length > 0) {
      applyCompletion(candidates[0]!);
    }
    if (approval) {
      if (key.name === "y") answerApproval("once");
      else if (key.name === "n") answerApproval("deny");
      else if (key.name === "a") answerApproval("always");
    }
  });

  const totals = chat.entries.reduce(
    (acc, e) => (e.kind === "reply" ? { inTok: acc.inTok + e.inTok, outTok: acc.outTok + e.outTok } : acc),
    { inTok: 0, outTok: 0 },
  );

  // busy clock + spinner: tick fast while animating, once a second otherwise
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!chat.busy) return;
    const t = setInterval(() => setTick((n) => n + 1), theme.motion ? 120 : 1000);
    return () => clearInterval(t);
  }, [chat.busy, theme.motion]);
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const spinner: string = theme.motion
    ? (spinnerFrames[tick % spinnerFrames.length] ?? "•")
    : (theme.icons.running ?? "●");

  const replies = chat.entries.filter((e) => e.kind === "reply");
  let activeReply: ReplyEntry | undefined;
  let lastDone: ReplyEntry | undefined;
  for (let i = replies.length - 1; i >= 0; i--) {
    const r = replies[i]!;
    if (!r.done && !activeReply) activeReply = r;
    if (r.done && !lastDone) lastDone = r;
  }
  const busySecs = activeReply ? Math.floor((Date.now() - activeReply.startedAt) / 1000) : 0;
  const tokPerSec = lastDone?.endedAt != null && lastDone.endedAt > lastDone.startedAt
    ? Math.round(lastDone.outTok / ((lastDone.endedAt - lastDone.startedAt) / 1000))
    : null;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg}>
      <scrollbox
        ref={(r) => { scrollRef.current = r; }}
        flexGrow={1} paddingY={1}
        stickyScroll stickyStart="bottom"
      >
        <WelcomeHero brand={brand} theme={theme} />
        {chat.entries.map((e, i) => (
          <MessageView key={i} entry={e} theme={theme} />
        ))}
        <box height={1} />
      </scrollbox>
      {approval && <ApprovalDialog toolCalls={approval.tool_calls} theme={theme} />}
      {picker && (
        <ListPicker
          title={picker.kind}
          items={picker.items}
          theme={theme}
          onPick={(v) => void pickValue(v)}
          onCancel={() => setPicker(null)}
        />
      )}
      {candidates.length > 0 && !picker && (
        <box paddingX={2} flexShrink={0}>
          <text fg={theme.colors.muted}>{candidates.slice(0, 6).join("   ")}</text>
        </box>
      )}
      <box
        border
        borderColor={approval ? theme.colors.warn : picker ? theme.colors.border : theme.colors.accent}
        marginX={1} paddingX={1} flexShrink={0}
      >
        <textarea
          ref={(r: TextareaRenderable | null) => { inputRef.current = r; }}
          onContentChange={() => setInput(inputRef.current?.plainText ?? "")}
          onCursorChange={(e: { line: number }) => { cursorLineRef.current = e.line; }}
          onKeyDown={onInputKeyDown}
          keyBindings={vimEnabled && vimMode === "normal" ? vimNormalBindings : insertBindings}
          placeholder={approval ? "answer the approval above (y/n/a)" : `ask ${brand.name}…  (/help)`}
          focused={!approval && !picker}
          minHeight={1}
          maxHeight={8}
        />
      </box>
      <StatusLine
        theme={theme} brand={brand} model={model} busy={chat.busy}
        busySecs={busySecs} inTok={totals.inTok} outTok={totals.outTok} tokPerSec={tokPerSec}
        sessionId={sessionId} spinner={spinner}
        branch={branch} permission={permission}
        vimMode={vimEnabled ? vimMode : null}
        width={termWidth}
      />
    </box>
  );
}

export { builtinTheme };
export type { Theme };
