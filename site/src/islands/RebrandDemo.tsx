import { useMemo, useState } from "react";
import { isValidHex, renderBrandToml } from "../rebrand/toml";
import "./rebrand.css";

const DEFAULTS = {
  name: "myagent",
  tagline: "ships code, asks questions later",
  accent: "#7C3AED",
  theme: "myagent-dark",
};

/** Live proof that branding is data: edit [brand] fields and watch a mini
 *  TUI repaint instantly. Component-local state only — nothing persisted. */
export default function RebrandDemo() {
  const [name, setName] = useState(DEFAULTS.name);
  const [tagline, setTagline] = useState(DEFAULTS.tagline);
  const [accent, setAccent] = useState(DEFAULTS.accent);
  const [theme, setTheme] = useState(DEFAULTS.theme);

  const hexOk = isValidHex(accent);
  const toml = useMemo(
    () => renderBrandToml({ name, tagline, accent: hexOk ? accent : DEFAULTS.accent, theme }),
    [name, tagline, accent, theme, hexOk],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toml);
    } catch {
      /* clipboard unavailable — the pre is selectable */
    }
  };

  return (
    <div className="rebrand" data-rebrand style={{ "--demo-accent": hexOk ? accent : DEFAULTS.accent } as React.CSSProperties}>
      <div className="rebrand-form">
        <label>
          <span className="label">name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        </label>
        <label>
          <span className="label">tagline</span>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={48} />
        </label>
        <label>
          <span className="label">accent</span>
          <span className="accent-row">
            <input type="color" value={hexOk && accent.length === 7 ? accent : DEFAULTS.accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent color picker" />
            <input value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent hex value" className="hex" />
          </span>
          {!hexOk && <span className="invalid">not a hex color — using {DEFAULTS.accent}</span>}
        </label>
        <label>
          <span className="label">theme</span>
          <input value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={32} />
        </label>
      </div>

      <div className="rebrand-preview" aria-label="Branded preview">
        <div className="mini-hero">
          <span className="mini-mark" aria-hidden="true">┌┬</span>
          <strong className="mini-name">{name || "…"}</strong>
          <span className="mini-tagline">{tagline}</span>
        </div>
        <div className="mini-status">
          <span className="mini-brand">{name || "…"}</span>
          <span>● ready</span>
          <span>claude-sonnet-4-5</span>
          <span>⎇ main</span>
          <span>accept_edits</span>
        </div>
      </div>

      <div className="rebrand-toml">
        <div className="toml-head">
          <span className="label">~/.turnwright/config.toml</span>
          <button type="button" onClick={copy} data-copy-toml>copy ⧉</button>
        </div>
        <pre>{toml}</pre>
      </div>
    </div>
  );
}
