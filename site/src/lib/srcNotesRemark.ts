import { inlineSrcNotes } from "./srcNotes";

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
}

function walk(node: MdNode): void {
  if (node.type === "html" && typeof node.value === "string") {
    node.value = inlineSrcNotes(node.value);
  }
  node.children?.forEach(walk);
}

/** remark plugin: turns `<!-- src: … -->` provenance comments into visible
 *  marginalia asides. Thin wrapper around the unit-tested inlineSrcNotes. */
export function remarkSrcNotes() {
  return (tree: MdNode) => {
    walk(tree);
  };
}
