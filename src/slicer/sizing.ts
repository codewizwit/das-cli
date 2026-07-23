import { estimateTokens } from "../markdown/tokens.js";
import type { DocNode } from "../types.js";

/**
 * Calculate subtree token counts bottom-up, returning a new tree without mutation.
 *
 * Each node's subtreeTokens equals the estimated tokens of its body plus the
 * sum of all its children's subtreeTokens. The function recursively processes
 * the entire tree, creating new node objects while leaving the input untouched.
 *
 * @param node - The root node to size
 * @returns A new tree with subtreeTokens populated for all nodes
 */
export function sizeTree(node: DocNode): DocNode {
  const sizedChildren = node.children.map(sizeTree);
  const childrenTokenSum = sizedChildren.reduce(
    (sum, child) => sum + child.subtreeTokens,
    0,
  );
  const nodeBodyTokens = estimateTokens(node.body);

  return {
    ...node,
    children: sizedChildren,
    subtreeTokens: nodeBodyTokens + childrenTokenSum,
  };
}
