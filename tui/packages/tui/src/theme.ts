/** Theme system: semantic color slots, icon sets, motion flags.
 *  Resolution: builtin theme <- ~/.lathe/themes/<name>.json <- [brand] accent.
 *  Users restyle lathe without touching code. */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Brand } from "@lathe/core";

export interface Theme {
  name: string;
  colors: {
    bg: string; surface: string; text: string; muted: string;
    accent: string; success: string; warn: string; danger: string; info: string;
    border: string; selection: string;
  };
  icons: Record<string, string>;
  motion: boolean;
}

const UNICODE_ICONS: Record<string, string> = {
  user: "❯", assistant: "◆", tool: "⚙", thinking: "✶", success: "✓",
  error: "✗", warn: "▲", pending: "…", running: "●", folder: "▸",
};

export function builtinTheme(name: string): Theme {
  const dark: Theme = {
    name: "lathe-dark",
    colors: {
      bg: "#0E0F13", surface: "#16181F", text: "#E7E9EE", muted: "#6B7280",
      accent: "#F59E0B", success: "#34D399", warn: "#FBBF24", danger: "#F87171",
      info: "#60A5FA", border: "#2A2E3A", selection: "#2E3344",
    },
    icons: UNICODE_ICONS,
    motion: true,
  };
  if (name === "lathe-light") {
    return {
      ...dark,
      name,
      colors: {
        bg: "#FAFAFA", surface: "#F0F1F4", text: "#1F2430", muted: "#8A8F9C",
        accent: "#B45309", success: "#047857", warn: "#B45309", danger: "#DC2626",
        info: "#2563EB", border: "#D8DBE3", selection: "#E2E5EE",
      },
    };
  }
  return dark;
}

export function loadTheme(name: string, brand: Brand): Theme {
  const base = builtinTheme(name || brand.theme || "lathe-dark");
  const userPath = join(homedir(), ".lathe", "themes", `${base.name}.json`);
  let merged = base;
  if (existsSync(userPath)) {
    try {
      const override = JSON.parse(readFileSync(userPath, "utf8"));
      merged = {
        ...base,
        colors: { ...base.colors, ...(override.colors ?? {}) },
        icons: { ...base.icons, ...(override.icons ?? {}) },
        motion: override.motion ?? base.motion,
      };
    } catch {
      // malformed user theme: keep builtin, never crash the UI
    }
  }
  if (brand.accent) merged = { ...merged, colors: { ...merged.colors, accent: brand.accent } };
  return merged;
}
