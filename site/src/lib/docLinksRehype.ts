import { docLinkToRoute } from "./docLinks";

interface HastNode {
  type: string;
  tagName?: string;
  properties?: { href?: unknown };
  children?: HastNode[];
}

function walk(node: HastNode): void {
  if (node.type === "element" && node.tagName === "a" && node.properties) {
    const href = node.properties.href;
    if (typeof href === "string") {
      const route = docLinkToRoute(href);
      if (route !== null) node.properties.href = route;
    }
  }
  node.children?.forEach(walk);
}

/** rehype plugin: rewrites relative .md cross-links to site routes during
 *  markdown rendering. Shares DOC_LINK_RE contract with lib/docLinks.ts. */
export function rehypeDocLinks() {
  return (tree: HastNode) => {
    walk(tree);
  };
}
