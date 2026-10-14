import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://alanfokco.github.io",
  base: "/turnwright",
  output: "static",
  integrations: [react()],
  build: { inlineStylesheets: "auto" },
  vite: { build: { assetsInlineLimit: 4096 } },
});
