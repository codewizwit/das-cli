import { sanitizeSlug } from "../markdown/slug.js";
import { estimateTokens } from "../markdown/tokens.js";
import type { DocNode } from "../types.js";

/** A single file the emitter should write, referencing the node it renders. */
export interface PlannedFile {
  /** Path relative to the skill directory, using forward slashes. */
  relativePath: string;
  /** The node whose content this file renders. */
  node: DocNode;
  /** How this file participates in the skill's structure. */
  role: "skill" | "index" | "leaf" | "group";
  /**
   * Ordered relativePaths this file links to in its table of contents.
   *
   * For "skill", "index", and "group" roles, these are the group paths when
   * the children were grouped, otherwise the direct child paths, in
   * document order. Always empty for "leaf".
   */
  childPaths: string[];
}

/** The complete structural plan for emitting a documentation tree as a skill. */
export interface EmissionPlan {
  /** All files to plan for, in the order they were decided. */
  files: PlannedFile[];
  /** Relative paths of leaves that exceed the token budget and were emitted whole. */
  oversized: string[];
  /**
   * Relative paths of index/group/skill files whose table of contents
   * cannot fit the budget because one of their entries is an irreducible
   * link line (for example an unshrinkable heading name) that grouping
   * cannot reduce any further.
   */
  oversizedIndexes: string[];
}

interface TocEntry {
  name: string;
  linkPath: string;
}

interface ChildDescriptor extends TocEntry {
  node: DocNode;
  slug: string;
  recurses: boolean;
}

interface PlacementItem extends TocEntry {
  place: (dir: string) => void;
}

function assignSlugs(names: string[]): string[] {
  const occurrences = new Map<string, number>();

  return names.map((name) => {
    const base = sanitizeSlug(name);
    const priorCount = occurrences.get(base) ?? 0;
    occurrences.set(base, priorCount + 1);
    return priorCount === 0 ? base : `${base}-${String(priorCount + 1)}`;
  });
}

function describeChildren(nodes: DocNode[], budget: number): ChildDescriptor[] {
  const slugs = assignSlugs(nodes.map((node) => node.name));
  const descriptors: ChildDescriptor[] = [];

  for (const [index, node] of nodes.entries()) {
    const slug = slugs[index];
    if (slug === undefined) {
      continue;
    }
    const recurses = node.subtreeTokens > budget && node.children.length > 0;
    descriptors.push({
      node,
      name: node.name,
      slug,
      recurses,
      linkPath: `${slug}${recurses ? "/index.md" : ".md"}`,
    });
  }

  return descriptors;
}

function renderToc(entries: TocEntry[]): string {
  return entries
    .map((entry) => `- [${entry.name}](${entry.linkPath})`)
    .join("\n");
}

function planNode(
  node: DocNode,
  parentDir: string,
  slug: string,
  recurses: boolean,
  budget: number,
  files: PlannedFile[],
  oversized: string[],
  oversizedIndexes: string[],
): void {
  if (!recurses) {
    const relativePath = `${parentDir}/${slug}.md`;
    files.push({ relativePath, node, role: "leaf", childPaths: [] });
    if (node.subtreeTokens > budget) {
      oversized.push(relativePath);
    }
    return;
  }

  const ownDir = `${parentDir}/${slug}`;
  planIndexInto(
    node,
    `${ownDir}/index.md`,
    ownDir,
    "index",
    budget,
    files,
    oversized,
    oversizedIndexes,
  );
}

function toPlacementItem(
  descriptor: ChildDescriptor,
  budget: number,
  files: PlannedFile[],
  oversized: string[],
  oversizedIndexes: string[],
): PlacementItem {
  return {
    name: descriptor.name,
    linkPath: descriptor.linkPath,
    place: (dir: string) => {
      planNode(
        descriptor.node,
        dir,
        descriptor.slug,
        descriptor.recurses,
        budget,
        files,
        oversized,
        oversizedIndexes,
      );
    },
  };
}

function partitionByTocBudget(
  items: PlacementItem[],
  budget: number,
): PlacementItem[][] {
  const buckets: PlacementItem[][] = [];
  let current: PlacementItem[] = [];

  for (const item of items) {
    const tentative = [...current, item];
    const tentativeFits = estimateTokens(renderToc(tentative)) <= budget;

    if (!tentativeFits && current.length > 0) {
      buckets.push(current);
      current = [item];
    } else {
      current = tentative;
    }
  }

  if (current.length > 0) {
    buckets.push(current);
  }

  return buckets;
}

function buildGroupItem(
  bucket: PlacementItem[],
  index: number,
  budget: number,
  files: PlannedFile[],
  oversizedIndexes: string[],
): PlacementItem {
  const groupSlug = `group-${String(index + 1)}`;
  const firstItem = bucket[0];
  const lastItem = bucket[bucket.length - 1];
  const firstName = firstItem?.name ?? groupSlug;
  const lastName = lastItem?.name ?? groupSlug;
  const label =
    firstName === lastName ? firstName : `${firstName} – ${lastName}`;
  const bucketFits = estimateTokens(renderToc(bucket)) <= budget;

  return {
    name: label,
    linkPath: `${groupSlug}/index.md`,
    place: (dir: string) => {
      const groupDir = `${dir}/${groupSlug}`;
      const groupRelativePath = `${groupDir}/index.md`;
      const groupNode: DocNode = {
        name: label,
        body: "",
        children: [],
        subtreeTokens: 0,
      };
      const childPaths = bucket.map((item) => `${groupDir}/${item.linkPath}`);
      files.push({
        relativePath: groupRelativePath,
        node: groupNode,
        role: "group",
        childPaths,
      });
      if (!bucketFits) {
        oversizedIndexes.push(groupRelativePath);
      }
      for (const bucketItem of bucket) {
        bucketItem.place(groupDir);
      }
    },
  };
}

/**
 * Reduce a list of table-of-contents entries to one that fits the budget.
 *
 * Recursively partitions entries into budget-sized "group" files, wrapping
 * the resulting group links and re-checking them the same way, until the
 * top-level list fits. If a partitioning pass fails to reduce the entry
 * count (every entry is already alone in its own bucket, meaning at least
 * one entry's own rendered line cannot fit the budget and grouping cannot
 * help), the list is returned as-is: the caller is responsible for flagging
 * the file that ends up listing it in `oversizedIndexes`.
 */
function resolveGroupedPlacement(
  items: PlacementItem[],
  budget: number,
  files: PlannedFile[],
  oversizedIndexes: string[],
): PlacementItem[] {
  if (estimateTokens(renderToc(items)) <= budget) {
    return items;
  }

  const buckets = partitionByTocBudget(items, budget);
  if (buckets.length >= items.length) {
    return items;
  }

  const groupItems = buckets.map((bucket, index) =>
    buildGroupItem(bucket, index, budget, files, oversizedIndexes),
  );

  return resolveGroupedPlacement(groupItems, budget, files, oversizedIndexes);
}

function planIndexInto(
  node: DocNode,
  ownFilePath: string,
  ownDir: string,
  role: "skill" | "index",
  budget: number,
  files: PlannedFile[],
  oversized: string[],
  oversizedIndexes: string[],
): void {
  const childDescriptors = describeChildren(node.children, budget);
  const childItems = childDescriptors.map((descriptor) =>
    toPlacementItem(descriptor, budget, files, oversized, oversizedIndexes),
  );
  const groupedChildItems = resolveGroupedPlacement(
    childItems,
    budget,
    files,
    oversizedIndexes,
  );

  const bodyTokens = estimateTokens(node.body);
  const renderedChildTocTokens = estimateTokens(renderToc(groupedChildItems));
  const needsOverview =
    node.body !== "" && bodyTokens + renderedChildTocTokens > budget;

  let indexNode = node;
  let topLevelItems = groupedChildItems;

  if (needsOverview) {
    const overviewNode: DocNode = {
      name: "Overview",
      body: node.body,
      children: [],
      subtreeTokens: bodyTokens,
    };
    const overviewDescriptors = describeChildren(
      [overviewNode, ...node.children],
      budget,
    );
    const overviewItems = overviewDescriptors.map((descriptor) =>
      toPlacementItem(descriptor, budget, files, oversized, oversizedIndexes),
    );
    topLevelItems = resolveGroupedPlacement(
      overviewItems,
      budget,
      files,
      oversizedIndexes,
    );
    indexNode = { ...node, body: "" };
  }

  const childPaths = topLevelItems.map((item) => `${ownDir}/${item.linkPath}`);
  const ownBodyTokens = indexNode.body === "" ? 0 : bodyTokens;
  const ownFits =
    ownBodyTokens + estimateTokens(renderToc(topLevelItems)) <= budget;

  files.push({ relativePath: ownFilePath, node: indexNode, role, childPaths });
  if (!ownFits) {
    oversizedIndexes.push(ownFilePath);
  }

  for (const item of topLevelItems) {
    item.place(ownDir);
  }
}

/**
 * Decide which nodes of a sized documentation tree become which emitted files.
 *
 * The root always becomes `SKILL.md`. When a node's subtree fits the token
 * budget, it is emitted whole as a single leaf (its children are not emitted
 * separately). When it does not fit, the node becomes an index whose
 * table of contents links to its children, recursing into each. The
 * decision to relocate the body to a separate "Overview" leaf is based on
 * the actual rendered table of contents after grouping is resolved, not the
 * raw, pre-grouping child list. If a table of contents itself would not
 * fit, its entries are partitioned in document order into budget-sized
 * "group" index files, applied recursively until every emitted table of
 * contents fits. When an entry's own rendered link line cannot fit the
 * budget on its own, grouping cannot help further: the entry is placed
 * as-is and the enclosing file is flagged in `oversizedIndexes` instead of
 * looping forever or overflowing silently. A childless node whose own body
 * exceeds the budget is emitted whole and flagged in `oversized`.
 *
 * @param root - The sized root of the documentation tree to plan
 * @param options - Planning options, including the maximum tokens allowed per emitted file
 * @returns The structural plan of files to emit
 */
export function planEmission(
  root: DocNode,
  options: { tokenBudget: number },
): EmissionPlan {
  const { tokenBudget } = options;
  const files: PlannedFile[] = [];
  const oversized: string[] = [];
  const oversizedIndexes: string[] = [];

  if (root.subtreeTokens <= tokenBudget || root.children.length === 0) {
    files.push({
      relativePath: "SKILL.md",
      node: root,
      role: "skill",
      childPaths: [],
    });
    if (root.subtreeTokens > tokenBudget) {
      oversized.push("SKILL.md");
    }
    return { files, oversized, oversizedIndexes };
  }

  planIndexInto(
    root,
    "SKILL.md",
    "resources",
    "skill",
    tokenBudget,
    files,
    oversized,
    oversizedIndexes,
  );

  return { files, oversized, oversizedIndexes };
}
