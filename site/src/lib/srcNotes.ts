/** Pre-render transform: turn `<!-- src: file symbol -->` provenance comments
 *  (the docs drift-check convention) into visible marginalia. */
const SRC_RE = /<!--\s*src:\s*([^>]*?)\s*-->/g;

export function inlineSrcNotes(md: string): string {
  return md.replace(
    SRC_RE,
    (_m, ref: string) =>
      `<p class="src-note">⊕ src: ${ref.replace(/[<&]/g, "")}</p>`,
  );
}
