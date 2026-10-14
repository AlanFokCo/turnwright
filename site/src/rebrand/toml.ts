/** TOML generation for the live rebrand demo. Mirrors the real [brand]
 *  section shape (internal/config/config.go Brand) so the copy button hands
 *  users a snippet that drops straight into ~/.turnwright/config.toml. */

export interface BrandInput {
  name: string;
  tagline: string;
  accent: string;
  theme: string;
}

function escapeToml(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function renderBrandToml(b: BrandInput): string {
  return [
    "[brand]",
    `name    = "${escapeToml(b.name)}"`,
    `tagline = "${escapeToml(b.tagline)}"`,
    `accent  = "${escapeToml(b.accent)}"`,
    `theme   = "${escapeToml(b.theme)}"`,
  ].join("\n");
}

export function isValidHex(c: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c);
}
