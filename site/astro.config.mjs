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
  // static site with small CSS: inline everything to kill render-blocking requests
  build: { inlineStylesheets: "always" },
  vite: { build: { assetsInlineLimit: 4096 } },
});
