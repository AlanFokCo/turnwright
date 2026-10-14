import { useEffect, useRef, useState } from "react";
import { applyEvent, initialRenderState } from "../replay/engine";
import type { AgentEventLike } from "../replay/events";
import { approvalOutcome, initialPlaygroundState, playgroundRespond, type PlaygroundState } from "../playground/script";
import { EntryView } from "./EntryView";
import "./replay.css";

const HINTS = ["/help", "/status", "/theme turnwright-light", "run tests", "what does the engine do?"];

/** Interactive fake terminal: canned responses shaped exactly like the real
 *  product's events, including approval prompts and its unknown-command
 *  warning. No backend, no network. */
export default function Playground() {
  const [st, setSt] = useState(initialRenderState);
  const [pg, setPg] = useState<PlaygroundState>(initialPlaygroundState);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const queue = useRef<AgentEventLike[]>([]);
  const reduced =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const id = setInterval(
      () => {
        const batch = reduced ? queue.current.splice(0) : queue.current.splice(0, 1);
        if (batch.length) setSt((s) => batch.reduce((acc, ev) => applyEvent(acc, ev), s));
      },
      reduced ? 16 : 40,
    );
    return () => clearInterval(id);
  }, [reduced]);

  const push = (events: AgentEventLike[]) => queue.current.push(...events);

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setHistory((h) => [...h, text]);
    setHistIdx(null);
    setInput("");
    const { events, state } = playgroundRespond(text, pg);
    setPg(state);
    // the real TUI echoes the user's line into the transcript
    push([{ type: "user_message", text }, ...events]);
  };

  const pendingId = (() => {
    for (let i = st.entries.length - 1; i >= 0; i--) {
      const e = st.entries[i]!;
      if (e.kind !== "approval") continue;
      const ids = new Set(e.toolCalls.map((t) => t.id));
      const resolved = st.entries.some((x) => x.kind === "tool" && ids.has(x.id) && x.state !== "running");
      return resolved ? null : (e.toolCalls[0]?.id ?? null);
    }
    return null;
  })();

  const answer = (decision: "once" | "deny" | "always") => {
    if (!pendingId) return;
    push(approvalOutcome(decision, pendingId));
  };

  return (
    <div className={`term ${pg.theme === "light" ? "light" : ""}`} data-playground>
      <div className="player-chrome">
        <span className="dot" aria-hidden="true"></span>
        <span className="chrome-title">playground — try turnwright in your browser</span>
        <span className="chrome-meta">permission {pg.permission}</span>
      </div>
      <div className="player-body term-body" role="log" aria-live="polite">
        {st.entries.map((e, i) => (
          <EntryView key={i} e={e} />
        ))}
        {pendingId && (
          <div className="approval-actions">
            <button type="button" onClick={() => answer("once")}>y — allow once</button>
            <button type="button" onClick={() => answer("deny")}>n — deny</button>
            <button type="button" onClick={() => answer("always")}>a — always</button>
          </div>
        )}
      </div>
      <div className="hints" aria-label="Example commands">
        {HINTS.map((h) => (
          <button type="button" key={h} onClick={() => submit(h)}>{h}</button>
        ))}
      </div>
      <form
        className="term-input"
        onSubmit={(ev) => {
          ev.preventDefault();
          submit(input);
        }}
      >
        <span className="p" aria-hidden="true">❯</span>
        <input
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "ArrowUp" && history.length) {
              ev.preventDefault();
              const idx = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
              setHistIdx(idx);
              setInput(history[idx]!);
            } else if (ev.key === "ArrowDown" && histIdx !== null) {
              ev.preventDefault();
              const idx = histIdx + 1;
              if (idx >= history.length) { setHistIdx(null); setInput(""); }
              else { setHistIdx(idx); setInput(history[idx]!); }
            }
          }}
          placeholder="type a command — /help to start"
          aria-label="Playground input"
        />
      </form>
    </div>
  );
}
