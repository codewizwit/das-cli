import { sizeTree } from "./sizing.js";
import { buildTree } from "./tree.js";
import type { DocFile, DocNode } from "../types.js";

/**
 * Build a normalized, sized documentation tree from a fileset.
 *
 * Composes {@link buildTree} and {@link sizeTree}. This is the single entry
 * point every caller that needs a sized tree for `planEmission` should use
 * instead of calling them directly.
 *
 * `collapseSingleChildChains` is deliberately not applied. Emitted paths
 * mirror the source tree, so a collapsed folder would be a folder with no
 * emitted index and a resource at a path that does not match its source.
 * The redundant-wrapper defect collapsing existed to fix is gone with it,
 * because the emitter no longer synthesises headings from node names.
 *
 * @param files - The fileset to build a tree from, in resolver order
 * @param rootName - The name assigned to the tree's root node
 * @returns The root node of the normalized, sized tree
 */
export function buildSizedTree(files: DocFile[], rootName: string): DocNode {
  return sizeTree(buildTree(files, rootName));
}
