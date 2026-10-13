/** Generic list picker built on OpenTUI's select component. */

import React from "react";
import type { Theme } from "./theme.js";

export interface PickerItem {
  name: string;
  description?: string;
  value: string;
}

export function ListPicker({
  title, items, theme, onPick, onCancel,
}: {
  title: string;
  items: PickerItem[];
  theme: Theme;
  onPick: (value: string) => void;
  onCancel: () => void;
}) {
  if (items.length === 0) {
    return (
      <box border borderColor={theme.colors.border} paddingX={2} marginX={1} marginTop={1} flexShrink={0}>
        <text fg={theme.colors.muted}>{title}: nothing to show (esc)</text>
      </box>
    );
  }
  return (
    <box
      border borderColor={theme.colors.accent} marginX={1} marginTop={1}
      backgroundColor={theme.colors.surface} flexDirection="column" paddingX={1} flexShrink={0}
    >
      <text fg={theme.colors.accent}><strong>{title}</strong></text>
      <select
        options={items.map((i) => ({ name: i.name, description: i.description ?? "", value: i.value }))}
        focused
        onSelect={(_i: number, opt: { value?: unknown } | null) => {
          if (opt?.value != null) onPick(String(opt.value));
        }}
        height={Math.min(items.length, 10) * (items.some((i) => i.description) ? 2 : 1)}
        showDescription={items.some((i) => i.description)}
      />
      <text fg={theme.colors.muted}>↑↓ move · enter select · esc cancel</text>
    </box>
  );
}
