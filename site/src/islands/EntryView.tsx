import type { Entry } from "../replay/engine";

/** Renders one replay entry in TUI-faithful visuals. Shared by the player,
 *  its poster fallback, and the playground. */
export function EntryView({ e }: { e: Entry }) {
  switch (e.kind) {
    case "user":
      return (
        <div className="entry entry-user">
          <span className="p">❯</span> <span>{e.text}</span>
        </div>
      );
    case "thinking":
      return (
        <div className="entry entry-thinking">
          <span className="p">✶</span> <span>{e.text}</span>
        </div>
      );
    case "text":
      return (
        <div className="entry entry-text">
          <span className="p">◆</span> <span>{e.text}</span>
        </div>
      );
    case "tool":
      return (
        <div className={`entry entry-tool state-${e.state}`}>
          <span className="p">{e.state === "denied" ? "✗" : e.state === "done" ? "✓" : "●"}</span>
          <span className="tool-name">{e.name}</span>
          {e.result && <DiffOrText text={e.result} />}
        </div>
      );
    case "approval":
      return (
        <div className="entry entry-approval">
          <span className="p">?</span>
          <span>
            permission required: {e.toolCalls.map((tc) => tc.name).join(", ")}{" "}
            <span className="keys">y / n / a</span>
          </span>
        </div>
      );
    case "notice":
      return (
        <div className={`entry entry-notice tone-${e.tone}`}>
          <span className="p">{e.tone === "error" ? "✗" : e.tone === "warn" ? "▲" : "•"}</span>{" "}
          <span>{e.text}</span>
        </div>
      );
  }
}

function DiffOrText({ text }: { text: string }) {
  const lines = text.split("\n");
  const isDiff = lines.some((l) => l.startsWith("+") || l.startsWith("-")) && lines.some((l) => l.startsWith("@@"));
  if (!isDiff) return <span className="tool-result">{text}</span>;
  return (
    <span className="tool-diff">
      {lines.map((l, i) => (
        <span key={i} className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : "ctx"}>
          {l}
          {"\n"}
        </span>
      ))}
    </span>
  );
}
