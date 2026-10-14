# Theming & branding

Two independent knobs, both pure data — no code, no rebuild:

- **Themes** restyle the TUI (colors, icons, motion)
- **`[brand]`** renames and repaints the whole product (name, tagline, logo,
  accent, status layout) — this is where forks start

## How a theme resolves

<!-- src: tui/packages/tui/src/theme.ts loadTheme -->

```
builtin base  ←  ~/.turnwright/themes/<name>.json  ←  [brand].accent  (wins last)
```

1. **Declared name**: `/theme <name>` at runtime, or `[brand] theme` in
   config; fallback `turnwright-dark`
2. **Builtin base**: `turnwright-light` if the name is exactly that;
   *any other name* starts from the dark builtin
3. **User override**: if `~/.turnwright/themes/<declared-name>.json` exists,
   its `colors` / `icons` / `motion` are merged over the base (partial files
   are fine; malformed JSON is ignored silently — the builtin stays, the UI
   never crashes)
4. **`[brand] accent`**, if set, repaints the `accent` slot last — one color
   rebrands every highlight

So a custom theme = any name + a matching override file:

```sh
mkdir -p ~/.turnwright/themes
$EDITOR ~/.turnwright/themes/ocean.json
```

```json
{
  "colors": { "bg": "#0B1320", "surface": "#12203A", "accent": "#38BDF8" },
  "motion": false
}
```

Activate with `/theme ocean` (live) or `theme = "ocean"` under `[brand]`
(startup). Switch back with `/theme turnwright-dark` or `/theme
turnwright-light`.

> The `/theme` **picker** lists only the two builtins; custom names work via
> the typed argument (`/theme ocean`) or config.

### Color slots

`bg`, `surface`, `text`, `muted`, `accent`, `success`, `warn`, `danger`,
`info`, `border`, `selection` — hex strings (`"#RRGGBB"`).

### Icon slots

`user`, `assistant`, `tool`, `thinking`, `success`, `error`, `warn`, `pending`,
`running`, `folder` — any single glyph. Defaults are Unicode
(`❯ ◆ ⚙ ✶ ✓ ✗ ▲ … ● ▸`).

### Motion

`"motion": false` disables animation (equivalent to `--no-anim` for the whole
theme).

### NO_COLOR

If `NO_COLOR` is **defined** (any value, including empty —
[no-color.org](https://no-color.org) convention), it wins over everything: the
TUI renders a mono theme using the terminal's own default foreground /
background plus grayscale, with motion off. Independently of themes, the
underlying OpenTUI renderer detects the terminal's color capability (e.g. via
`COLORTERM`) and falls back as needed.

## `[brand]`: rebrand the product

Everything user-visible is data-driven from `~/.turnwright/config.toml`:

<!-- src: internal/config/config.go Brand / DefaultBrand -->

```toml
[brand]
name    = "myagent"                          # hero, status line, terminal title
tagline = "ships code, asks questions later" # hero subtitle
accent  = "#7C3AED"                          # any hex; repaints the accent slot everywhere
logo    = ["█▀▄▀█ █▄█", "█ ▀ █  █ "]         # ASCII art, one string per line
theme   = "myagent-dark"                     # ~/.turnwright/themes/myagent-dark.json
status  = ["busy", "model", "branch", "tokens"]  # status-line slot order (subset ok)
```

Defaults when a field is omitted: `turnwright` / `shape your code at the
lathe` / `#F59E0B` / the `┌┬┐` logo / `turnwright-dark` / all seven status
slots.

### Status slots

`busy`, `model`, `branch`, `permission`, `tokens`, `toks`, `session` — list
them in the order you want; unknown names are ignored. On narrow terminals
low-priority slots drop out (thresholds in the
[TUI guide](./tui-guide.md#status-line)).

### Fork checklist

A rebranded fork needs **zero code changes**:

1. Ship your own `config.toml` (or bake `[brand]` defaults into your fork's
   `DefaultBrand()` if you maintain a code fork)
2. Drop theme overrides in `~/.turnwright/themes/`
3. Everything else — engine, TUI, protocol — is unchanged

## See also

- [Configuration](./configuration.md) — the `[brand]` keys in the full config
  reference
- [TUI guide](./tui-guide.md) — `/theme`, `/vim`, status line behavior
