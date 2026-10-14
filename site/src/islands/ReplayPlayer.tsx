import { useEffect, useMemo, useRef, useState } from "react";
import { stateAt, type RenderState } from "../replay/engine";
import type { TimedEvent } from "../replay/events";
import type { Chapter } from "../replay/chapters";
import { EntryView } from "./EntryView";
import "./replay.css";

interface Props {
  script: TimedEvent[];
  chapters?: readonly Chapter[];
  autoplay?: boolean;
  loop?: boolean;
  label: string;
}

export default function ReplayPlayer({ script, chapters, autoplay = false, loop = false, label }: Props) {
  const last = script.length ? script[script.length - 1]!.t : 0;
  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const raf = useRef(0);
  const prev = useRef(0);

  // Autoplay only when allowed and requested (Review Focus #5).
  useEffect(() => {
    if (autoplay && !reduced) setPlaying(true);
  }, [autoplay, reduced]);

  // Tell the Astro wrapper we hydrated so it can hide the JS-off poster.
  useEffect(() => {
    document.querySelectorAll("[data-player-wrap]").forEach((el) => el.setAttribute("data-hydrated", "true"));
  }, []);

  useEffect(() => {
    if (!playing) return;
    prev.current = performance.now();
    const step = (now: number) => {
      const dt = (now - prev.current) * speed;
      prev.current = now;
      setT((cur) => {
        const next = cur + dt;
        if (next >= last) {
          if (loop) return 0;
          setPlaying(false);
          return last;
        }
        return next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, last, loop]);

  const state: RenderState = useMemo(() => stateAt(script, t), [script, t]);
  const light = state.entries.some(
    (e) => e.kind === "notice" && e.tone === "info" && e.text.startsWith("theme → turnwright-light"),
  );

  const approvalResolved = (idx: number): boolean => {
    const ap = state.entries[idx];
    if (ap?.kind !== "approval") return false;
    const ids = new Set(ap.toolCalls.map((tc) => tc.id));
    return state.entries.some((e) => e.kind === "tool" && ids.has(e.id) && e.state !== "running");
  };

  return (
    <div
      className={`player ${light ? "light" : ""}`}
      data-player
      data-playing={playing ? "true" : "false"}
      aria-label={label}
    >
      <div className="player-chrome">
        <span className="dot" aria-hidden="true"></span>
        <span className="chrome-title">{label}</span>
        <span className="chrome-meta">{state.busy ? "● working" : "○ idle"}</span>
      </div>
      <div className="player-body" role="log" aria-live="off">
        {state.entries.map((e, i) => (
          <div key={i} className={e.kind === "approval" && !approvalResolved(i) ? "pending" : undefined}>
            <EntryView e={e} />
            {e.kind === "approval" && approvalResolved(i) && (
              <div className="entry entry-resolved">
                <span className="p">y</span> <span>allowed once</span>
              </div>
            )}
          </div>
        ))}
        {state.busy && <span className="cursor" aria-hidden="true">▌</span>}
      </div>
      <div className="player-status">
        <span>↑{state.inTok} ↓{state.outTok}</span>
        <span className="spacer"></span>
        <span>{(t / 1000).toFixed(1)}s / {(last / 1000).toFixed(1)}s</span>
      </div>
      <div className="player-controls">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" onClick={() => { setT(0); }} aria-label="Restart">↺</button>
        <input
          type="range"
          min={0}
          max={last}
          value={Math.round(t)}
          onChange={(ev) => setT(Number(ev.target.value))}
          aria-label="Seek"
        />
        <button type="button" onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))} aria-label="Playback speed">
          {speed}×
        </button>
        {chapters && (
          <span className="chapters">
            {chapters.map((c) => (
              <button
                key={c.id}
                type="button"
                className={t >= c.tStart ? "on" : undefined}
                onClick={() => { setT(c.tStart); setPlaying(true); }}
              >
                {c.label}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
