import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Brand } from "@turnwright/core";
import { loadTheme } from "../src/theme.js";

function brand(overrides: Partial<Brand> = {}): Brand {
  return { name: "turnwright", tagline: "", accent: "", logo: [], theme: "", ...overrides };
}

describe("loadTheme user overrides", () => {
  let home: string;
  let prevNoColor: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tw-theme-"));
    prevNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    if (prevNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prevNoColor;
  });

  function writeUserTheme(name: string, json: unknown) {
    const dir = join(home, ".turnwright", "themes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(json));
  }

  it("loads ~/.turnwright/themes/<name>.json for a custom theme name", () => {
    writeUserTheme("my-theme", { colors: { accent: "#123456", bg: "#000000" }, motion: false });
    const t = loadTheme("my-theme", brand(), home);
    expect(t.name).toBe("my-theme");
    expect(t.colors.accent).toBe("#123456");
    expect(t.colors.bg).toBe("#000000");
    expect(t.motion).toBe(false);
  });

  it("loads the override for a custom theme declared via brand.theme", () => {
    writeUserTheme("ocean", { colors: { info: "#0000AA" } });
    const t = loadTheme("", brand({ theme: "ocean" }), home);
    expect(t.name).toBe("ocean");
    expect(t.colors.info).toBe("#0000AA");
  });

  it("keeps the custom name with builtin-dark slots when no override file exists", () => {
    const t = loadTheme("my-theme", brand(), home);
    expect(t.name).toBe("my-theme");
    expect(t.colors.bg).toBe("#0E0F13");
  });

  it("still resolves builtin light and merges its override file", () => {
    writeUserTheme("turnwright-light", { colors: { accent: "#FF0000" } });
    const t = loadTheme("turnwright-light", brand(), home);
    expect(t.name).toBe("turnwright-light");
    expect(t.colors.bg).toBe("#FAFAFA");
    expect(t.colors.accent).toBe("#FF0000");
  });

  it("lets brand.accent win over the override file accent", () => {
    writeUserTheme("my-theme", { colors: { accent: "#123456" } });
    const t = loadTheme("my-theme", brand({ accent: "#F59E0B" }), home);
    expect(t.colors.accent).toBe("#F59E0B");
  });
});
