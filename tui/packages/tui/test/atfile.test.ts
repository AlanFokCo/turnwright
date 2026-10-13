import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completeAtPath, expandAtFiles } from "../src/atfile.js";

describe("@file", () => {
  it("expands existing files and reports missing ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "lathe-at-"));
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    const { text, missing } = expandAtFiles("check @a.ts and @gone.ts", dir);
    expect(text).toContain('<file path="a.ts">');
    expect(text).toContain("export const a = 1;");
    expect(missing).toEqual(["gone.ts"]);
  });

  it("completes paths while skipping node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "lathe-cp-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "src", "app.ts"), "");
    writeFileSync(join(dir, "node_modules", "junk.js"), "");
    const hits = completeAtPath("src", dir);
    expect(hits).toContain("src/");
    expect(hits.join(",")).not.toContain("junk");
  });
});
