import { sizeTree } from "./sizing.js";
import { buildTree, collapseSingleChildChains } from "./tree.js";
import type { DocFile, DocNode } from "../types.js";

/**
 * Build a normalized, collapsed, sized documentation tree from a fileset.
 *
 * Composes {@link buildTree}, {@link collapseSingleChildChains}, and
 * {@link sizeTree} in that order: collapsing must run before sizing, since
 * sizing computed on an uncollapsed tree would be discarded by the
 * subsequent collapse. This is the single entry point every caller that
 * needs a sized tree for {@link planEmission} should use instead of calling
 * `buildTree`/`sizeTree` directly, so a file whose frontmatter title matches
 * its first `H1` (the common case) never produces the redundant single-child
 * wrapper node that collapsing exists to remove.
 *
 * @param files - The fileset to build a tree from, in resolver order
 * @param rootName - The name assigned to the tree's root node
 * @returns The root node of the normalized, collapsed, sized tree
 */
export function buildSizedTree(files: DocFile[], rootName: string): DocNode {
  return sizeTree(collapseSingleChildChains(buildTree(files, rootName)));
}
