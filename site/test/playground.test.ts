import { describe, expect, it } from "vitest";
import { initialPlaygroundState, playgroundRespond } from "@/playground/script";

describe("playground", () => {
  it("/help lists the real command set", () => {
    const { events } = playgroundRespond("/help", initialPlaygroundState());
    const json = JSON.stringify(events);
    expect(json).toContain("/model");
    expect(json).toContain("/vim");
  });
  it("/theme turnwright-light flips state and announces", () => {
    const { events, state } = playgroundRespond("/theme turnwright-light", initialPlaygroundState());
    expect(state.theme).toBe("light");
    expect(JSON.stringify(events)).toContain("theme → turnwright-light");
  });
  it("'run tests' triggers an approval prompt with suggested rules", () => {
    const { events } = playgroundRespond("run tests", initialPlaygroundState());
    const confirm = events.find((e) => e.type === "require_user_confirm");
    expect(confirm?.tool_calls?.[0]?.name).toBe("bash");
    expect(confirm?.tool_calls?.[0]?.suggested_rules?.length).toBeGreaterThan(0);
  });
  it("unknown slash command gets the real warning", () => {
    const { events } = playgroundRespond("/frobnicate", initialPlaygroundState());
    expect(JSON.stringify(events)).toContain("unknown command: /frobnicate (try /help)");
  });
  it("free text produces a short representative agent turn", () => {
    const { events } = playgroundRespond("what does the engine do?", initialPlaygroundState());
    expect(events.some((e) => e.type === "reply_start")).toBe(true);
    expect(events.some((e) => e.type === "text_block_delta")).toBe(true);
    expect(events.some((e) => e.type === "reply_end")).toBe(true);
  });
});
