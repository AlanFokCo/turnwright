/** Docs navigation: the ordered slug list is the site's contract with docs/.
 *  The build fails when the two disagree — no silent nav holes. */
export const DOCS_ORDER = [
  "getting-started",
  "cli-reference",
  "configuration",
  "tui-guide",
  "skills-and-mcp",
  "print-mode",
  "theming-and-branding",
  "lcp-protocol",
] as const;

export function checkDocsCompleteness(files: string[]): void {
  const have = new Set(files.map((f) => f.replace(/\.md$/, "")));
  const want = new Set<string>(DOCS_ORDER);
  const missing = [...want].filter((s) => !have.has(s));
  const unexpected = [...have].filter((s) => !want.has(s));
  if (missing.length || unexpected.length) {
    throw new Error(
      `docs/ out of sync with DOCS_ORDER — missing: ${missing.join(", ") || "none"}; ` +
        `unexpected: ${unexpected.join(", ") || "none"}. Update site/src/lib/docsNav.ts.`,
    );
  }
}

export function firstH1(md: string): string {
  const m = md.match(/^# (.+)$/m);
  if (!m) throw new Error("docs markdown has no H1 title");
  return m[1].trim();
}
