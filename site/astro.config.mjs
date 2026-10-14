import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { rehypeDocLinks } from "./src/lib/docLinksRehype.ts";
import { remarkSrcNotes } from "./src/lib/srcNotesRemark.ts";

export default defineConfig({
  site: "https://alanfokco.github.io",
  base: "/turnwright",
  output: "static",
  integrations: [react()],
  markdown: {
    remarkPlugins: [remarkSrcNotes],
    rehypePlugins: [rehypeDocLinks],
    shikiConfig: { theme: "github-dark", wrap: false },
  },
  build: { inlineStylesheets: "auto" },
  vite: { build: { assetsInlineLimit: 4096 } },
});
