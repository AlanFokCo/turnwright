/** lathe TUI root: wires the LCP client event stream into chat state. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { EngineClient, type ApprovalRequest, type Brand, type ConfirmResult } from "@lathe/core";
import { loadTheme } from "./theme.js";
import {
  initialChatState, pushNotice, pushUser, reduce, type ChatState,
} from "./store.js";
import { ApprovalDialog, MessageView, StatusLine, WelcomeHero } from "./components.js";

export function App({ client, brand, model: initialModel }: {
  client: EngineClient; brand: Brand; model: string;
}) {
  const theme = useMemo(() => loadTheme(brand.theme, brand), [brand]);
  const [chat, setChat] = useState<ChatState>(initialChatState);
  const [sessionId, setSessionId] = useState<string>("");
  const [model, setModel] = useState(initialModel);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const approvalResolve = useRef<((r: { confirmResults: ConfirmResult[] }) => void) | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    client.on("event", (ev) => setChat((st) => reduce(st, ev)));
    client.onApproval(
      (req) =>
        new Promise((resolve) => {
          approvalResolve.current = resolve;
          setApproval(req);
        }),
    );
    client
      .sessionNew()
      .then((s) => setSessionId(s.sessionId))
      .catch((e) => setChat((st) => pushNotice(st, `session: ${e.message}`, "error")));
    return () => {
      client.removeAllListeners();
    };
  }, [client]);

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

  const submit = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || !sessionId || chat.busy) return;
      if (t.startsWith("/")) {
        void handleSlash(t);
        return;
      }
      setChat((st) => pushUser(st, t));
      client.turnStart(sessionId, t).catch((e) =>
        setChat((st) => pushNotice(st, `turn: ${e.message}`, "error")),
      );
    },
    [client, sessionId, chat.busy],
  );

  const handleSlash = async (cmd: string) => {
    const [name, ...rest] = cmd.split(/\s+/);
    switch (name) {
      case "/quit":
      case "/exit":
        client.dispose();
        process.exit(0);
      case "/model": {
        const m = rest.join(" ").trim();
        if (!m) {
          setChat((st) => pushNotice(st, `current model: ${model}`));
          return;
        }
        try {
          await client.modelSet(sessionId, m);
          setModel(m);
          setChat((st) => pushNotice(st, `model → ${m}`));
        } catch (e) {
          setChat((st) => pushNotice(st, `model: ${(e as Error).message}`, "error"));
        }
        return;
      }
      case "/clear":
        setChat(initialChatState);
        return;
      case "/help":
        setChat((st) => pushNotice(st, "/model <name> · /clear · /quit — more in docs"));
        return;
      default:
        setChat((st) => pushNotice(st, `unknown command: ${name} (try /help)`, "warn"));
    }
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (chat.busy && sessionId) {
        void client.turnCancel(sessionId);
        return;
      }
      client.dispose();
      process.exit(0);
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

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.bg}>
      <scrollbox flexGrow={1} paddingY={1}>
        <WelcomeHero brand={brand} theme={theme} />
        {chat.entries.map((e, i) => (
          <MessageView key={i} entry={e} theme={theme} />
        ))}
        <box height={1} />
      </scrollbox>
      {approval && (
        <ApprovalDialog toolNames={approval.tool_calls.map((t) => t.name)} theme={theme} />
      )}
      <box
        border
        borderColor={approval ? theme.colors.warn : theme.colors.border}
        marginX={1}
        paddingX={1}
      >
        <input
          value={input}
          onChange={(v: string) => setInput(v)}
          onSubmit={() => {
            const v = input;
            setInput("");
            submit(v);
          }}
          placeholder={approval ? "answer the approval above (y/n/a)" : "ask lathe…  (/help)"}
          focused={!approval}
        />
      </box>
      <StatusLine
        theme={theme} brand={brand} model={model} busy={chat.busy}
        inTok={totals.inTok} outTok={totals.outTok} sessionId={sessionId}
      />
    </box>
  );
}
