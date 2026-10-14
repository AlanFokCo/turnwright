import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/** Docs single source of truth: the repo's docs/*.md, exactly what GitHub
 *  renders. Sources carry no frontmatter; titles come from the first H1. */
const docs = defineCollection({
  loader: glob({ pattern: "*.md", base: "../docs" }),
  schema: z.object({}).passthrough(),
});

export const collections = { docs };
