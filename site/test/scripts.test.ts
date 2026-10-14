import { describe, expect, it } from "vitest";
import canonical from "@/replay/canonical.json";
import highlight from "@/replay/highlight.json";
import { CHAPTERS } from "@/replay/chapters";
import { validateScript } from "@/replay/events";

for (const [name, script] of [
  ["canonical", canonical],
  ["highlight", highlight],
] as const) {
  describe(`${name} script`, () => {
    it("validates against the event schema", () => {
      expect(() => validateScript(script)).not.toThrow();
    });
    it("has strictly increasing timestamps", () => {
      const ts = (script as { t: number }[]).map((e) => e.t);
      expect(ts.every((t, i) => i === 0 || t > ts[i - 1]!)).toBe(true);
    });
  });
}

describe("chapters", () => {
  it("all chapter starts exist inside the canonical script window", () => {
    const last = (canonical as { t: number }[]).at(-1)!.t;
    for (const c of CHAPTERS) {
      expect(c.tStart).toBeGreaterThanOrEqual(0);
      expect(c.tStart).toBeLessThan(last);
    }
  });
  it("chapter order is monotonic", () => {
    const ts = CHAPTERS.map((c) => c.tStart);
    expect(ts.every((t, i) => i === 0 || t > ts[i - 1]!)).toBe(true);
  });
});
