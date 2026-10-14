import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:4321" },
  webServer: {
    command: "pnpm --filter @turnwright/site preview --port 4321",
    url: "http://localhost:4321/turnwright/",
    cwd: "..",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
