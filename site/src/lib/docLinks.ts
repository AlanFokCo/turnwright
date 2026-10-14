/** Doc cross-link rewriting: GitHub-style relative Markdown links inside
 *  docs/*.md ("./configuration.md#anchor") become site routes. Only href
 *  values matching DOC_LINK_RE are touched; everything else passes through
 *  byte-identical. The rehype plugin (docLinksRehype.ts) shares DOC_LINK_RE. */

/** Full-string match: optional "./", filename, optional #fragment. */
export const DOC_LINK_RE = /^(?:\.\/)?([A-Za-z0-9._-]+)\.md(#.*)?$/;

export function docLinkToRoute(href: string): string | null {
  const m = href.match(DOC_LINK_RE);
  if (!m) return null;
  return `/turnwright/docs/${m[1]}/${m[2] ?? ""}`;
}

export function rewriteDocLinks(html: string): string {
  return html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    const route = docLinkToRoute(href);
    return route === null ? whole : `href="${route}"`;
  });
}
