import { describe, expect, it } from "vitest";
import { isValidHex, renderBrandToml } from "@/rebrand/toml";

describe("renderBrandToml", () => {
  it("emits a valid [brand] block", () => {
    const out = renderBrandToml({ name: "myagent", tagline: "ships code", accent: "#7C3AED", theme: "myagent-dark" });
    expect(out).toContain("[brand]");
    expect(out).toContain('name    = "myagent"');
    expect(out).toContain('accent  = "#7C3AED"');
  });
  it("escapes quotes and backslashes in strings", () => {
    const out = renderBrandToml({ name: 'a"b\\c', tagline: "", accent: "#000000", theme: "t" });
    expect(out).toContain('name    = "a\\"b\\\\c"');
  });
  it("validates hex colors", () => {
    expect(isValidHex("#F59E0B")).toBe(true);
    expect(isValidHex("#fff")).toBe(true);
    expect(isValidHex("F59E0B")).toBe(false);
    expect(isValidHex("#gggggg")).toBe(false);
  });
});
