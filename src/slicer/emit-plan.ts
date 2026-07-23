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
}

/** The complete structural plan for emitting a documentation tree as a skill. */
export interface EmissionPlan {
  /** All files to plan for, in the order they were decided. */
  files: PlannedFile[];
  /** Relative paths of leaves that exceed the token budget and were emitted whole. */
  oversized: string[];
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
): void {
  if (!recurses) {
    const relativePath = `${parentDir}/${slug}.md`;
    files.push({ relativePath, node, role: "leaf" });
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
  );
}

function toPlacementItem(
  descriptor: ChildDescriptor,
  budget: number,
  files: PlannedFile[],
  oversized: string[],
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
  files: PlannedFile[],
): PlacementItem {
  const groupSlug = `group-${String(index + 1)}`;
  const firstItem = bucket[0];
  const lastItem = bucket[bucket.length - 1];
  const firstName = firstItem?.name ?? groupSlug;
  const lastName = lastItem?.name ?? groupSlug;
  const label =
    firstName === lastName ? firstName : `${firstName} – ${lastName}`;

  return {
    name: label,
    linkPath: `${groupSlug}/index.md`,
    place: (dir: string) => {
      const groupDir = `${dir}/${groupSlug}`;
      const groupNode: DocNode = {
        name: label,
        body: "",
        children: [],
        subtreeTokens: 0,
      };
      files.push({
        relativePath: `${groupDir}/index.md`,
        node: groupNode,
        role: "group",
      });
      for (const bucketItem of bucket) {
        bucketItem.place(groupDir);
      }
    },
  };
}

function resolveGroupedPlacement(
  items: PlacementItem[],
  budget: number,
  files: PlannedFile[],
): PlacementItem[] {
  if (items.length <= 1 || estimateTokens(renderToc(items)) <= budget) {
    return items;
  }

  const buckets = partitionByTocBudget(items, budget);
  const groupItems = buckets.map((bucket, index) =>
    buildGroupItem(bucket, index, files),
  );

  return resolveGroupedPlacement(groupItems, budget, files);
}

function planIndexInto(
  node: DocNode,
  ownFilePath: string,
  ownDir: string,
  role: "skill" | "index",
  budget: number,
  files: PlannedFile[],
  oversized: string[],
): void {
  const childDescriptors = describeChildren(node.children, budget);
  const rawTocTokens = estimateTokens(renderToc(childDescriptors));
  const bodyTokens = estimateTokens(node.body);
  const needsOverview = node.body !== "" && bodyTokens + rawTocTokens > budget;

  let indexNode = node;
  let descriptors = childDescriptors;

  if (needsOverview) {
    const overviewNode: DocNode = {
      name: "Overview",
      body: node.body,
      children: [],
      subtreeTokens: bodyTokens,
    };
    descriptors = describeChildren([overviewNode, ...node.children], budget);
    indexNode = { ...node, body: "" };
  }

  files.push({ relativePath: ownFilePath, node: indexNode, role });

  const items = descriptors.map((descriptor) =>
    toPlacementItem(descriptor, budget, files, oversized),
  );
  const topLevelItems = resolveGroupedPlacement(items, budget, files);

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
 * table of contents links to its children, recursing into each. If an
 * index's own body plus its table of contents would not fit, the body is
 * relocated to a separate "Overview" leaf placed first. If a table of
 * contents itself would not fit, its entries are partitioned in document
 * order into budget-sized "group" index files, applied recursively until
 * every emitted table of contents fits. A childless node whose own body
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

  if (root.subtreeTokens <= tokenBudget || root.children.length === 0) {
    files.push({ relativePath: "SKILL.md", node: root, role: "skill" });
    if (root.subtreeTokens > tokenBudget) {
      oversized.push("SKILL.md");
    }
    return { files, oversized };
  }

  planIndexInto(
    root,
    "SKILL.md",
    "resources",
    "skill",
    tokenBudget,
    files,
    oversized,
  );

  return { files, oversized };
}
