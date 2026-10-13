/** EngineClient framing against a fake LCP engine (executable node script). */

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EngineClient } from "../src/client.js";

function makeEngine(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lathe-fake-engine-"));
  const path = join(dir, "engine.cjs");
  writeFileSync(path, `#!/usr/bin/env node\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

const HELLO = `
const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: {
      protocolVersion: 1, version: "fake", cwd: "/tmp",
      brand: { name: "t", tagline: "", accent: "#fff", logo: [], theme: "" },
      provider: "fake", model: "fake", capabilities: {},
    } }) + "\\n");
  } else if (m.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { sessionId: "s1" } }) + "\\n");
  }
});
`;

const WRONG_VERSION = HELLO.replace("protocolVersion: 1", "protocolVersion: 99");

describe("EngineClient", () => {
  test("initialize handshake resolves info", async () => {
    const c = new EngineClient({ enginePath: makeEngine(HELLO) });
    const info = await c.info;
    expect(info.version).toBe("fake");
    const s = await c.sessionNew();
    expect(s.sessionId).toBe("s1");
    c.dispose();
  });

  test("protocol version mismatch rejects", async () => {
    const c = new EngineClient({ enginePath: makeEngine(WRONG_VERSION) });
    await expect(c.info).rejects.toThrow("version mismatch");
    c.dispose();
  });

  test("unstartable engine surfaces engineError", async () => {
    const c = new EngineClient({ enginePath: "/nonexistent/lathe-engine" });
    c.info.catch(() => {}); // awaited indirectly via engineError
    const err = await new Promise<Error>((resolve) => c.on("engineError", resolve));
    expect(err.message).toContain("cannot start engine");
    c.dispose();
  });
});
