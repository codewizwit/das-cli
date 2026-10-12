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
  /** Skill-relative path of the file this entry links to. */
  emitPath: string;
}

interface ChildDescriptor extends TocEntry {
  node: DocNode;
  /** True when this child is a folder and becomes an index of its own. */
  recurses: boolean;
  /** Directory the child's own children are emitted into, folders only. */
  ownDir: string | undefined;
}

interface PlacementItem extends TocEntry {
  place: () => void;
}

/**
 * Emitted file name for a source file: its own base name, extension
 * normalised to `.md`.
 *
 * Paths mirror the source tree, so this never consults a display name.
 */
function resourceFileName(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? relativePath;
  return `${base.replace(/\.(md|mdx|markdown)$/i, "")}.md`;
}

function describeChildren(
  nodes: DocNode[],
  parentDir: string,
): ChildDescriptor[] {
  return nodes.flatMap((node): ChildDescriptor[] => {
    // A folder is checked first, because a folder that adopted its own
    // index.md carries a source too and must still become an index.
    if (node.segment !== undefined) {
      const ownDir = `${parentDir}/${node.segment}`;
      return [
        {
          node,
          name: node.name,
          emitPath: `${ownDir}/index.md`,
          recurses: true,
          ownDir,
        },
      ];
    }

    if (node.source !== undefined) {
      return [
        {
          node,
          name: node.name,
          emitPath: `${parentDir}/${resourceFileName(node.source.relativePath)}`,
          recurses: false,
          ownDir: undefined,
        },
      ];
    }

    // Heading nodes are never emitted: a document is emitted whole.
    return [];
  });
}

function renderToc(entries: TocEntry[]): string {
  return entries
    .map((entry) => `- [${entry.name}](${entry.emitPath})`)
    .join("\n");
}

function planNode(
  descriptor: ChildDescriptor,
  budget: number,
  files: PlannedFile[],
  oversized: string[],
  oversizedIndexes: string[],
): void {
  const { node, emitPath, ownDir } = descriptor;

  if (!descriptor.recurses || ownDir === undefined) {
    files.push({
      relativePath: emitPath,
      node,
      role: "leaf",
      childPaths: [],
    });
    const tokens =
      node.source === undefined
        ? node.subtreeTokens
        : estimateTokens(node.source.raw);
    if (tokens > budget) {
      oversized.push(emitPath);
    }
    return;
  }

  planIndexInto(
    node,
    emitPath,
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
    emitPath: descriptor.emitPath,
    place: () => {
      planNode(descriptor, budget, files, oversized, oversizedIndexes);
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
  ordinal: number,
  ownDir: string,
  budget: number,
  files: PlannedFile[],
  oversizedIndexes: string[],
): PlacementItem {
  const groupSlug = `group-${String(ordinal)}`;
  const groupRelativePath = `${ownDir}/${groupSlug}/index.md`;
  const firstItem = bucket[0];
  const lastItem = bucket[bucket.length - 1];
  const firstName = firstItem?.name ?? groupSlug;
  const lastName = lastItem?.name ?? groupSlug;
  const label =
    firstName === lastName ? firstName : `${firstName} – ${lastName}`;
  const bucketFits = estimateTokens(renderToc(bucket)) <= budget;

  return {
    name: label,
    emitPath: groupRelativePath,
    place: () => {
      const groupNode: DocNode = {
        name: label,
        body: "",
        children: [],
        subtreeTokens: 0,
      };
      files.push({
        relativePath: groupRelativePath,
        node: groupNode,
        role: "group",
        childPaths: bucket.map((item) => item.emitPath),
      });
      if (!bucketFits) {
        oversizedIndexes.push(groupRelativePath);
      }
      for (const bucketItem of bucket) {
        bucketItem.place();
      }
    },
  };
}

/**
 * Reduce a list of table-of-contents entries to one that fits the budget.
 *
 * Recursively partitions entries into budget-sized "group" index files,
 * wrapping the resulting group links and re-checking them the same way,
 * until the top-level list fits. Grouping only ever partitions link lists:
 * a resource stays at its mirrored source path no matter which group lists
 * it, so a group index links across to siblings rather than owning them.
 *
 * If a partitioning pass fails to reduce the entry count (every entry is
 * already alone in its own bucket, meaning at least one entry's own rendered
 * line cannot fit the budget and grouping cannot help), the list is returned
 * as-is: the caller flags the file that lists it in `oversizedIndexes`.
 */
function resolveGroupedPlacement(
  items: PlacementItem[],
  ownDir: string,
  budget: number,
  files: PlannedFile[],
  oversizedIndexes: string[],
  // Group indexes all live directly in ownDir now, because grouping
  // partitions link lists and never relocates a resource. The counter has to
  // span every recursion level, or a second partitioning pass would reissue
  // group-1 in a directory that already has one.
  nextOrdinal: { value: number } = { value: 1 },
): PlacementItem[] {
  if (estimateTokens(renderToc(items)) <= budget) {
    return items;
  }

  const buckets = partitionByTocBudget(items, budget);
  if (buckets.length >= items.length) {
    return items;
  }

  const groupItems = buckets.map((bucket) =>
    buildGroupItem(
      bucket,
      nextOrdinal.value++,
      ownDir,
      budget,
      files,
      oversizedIndexes,
    ),
  );

  return resolveGroupedPlacement(
    groupItems,
    ownDir,
    budget,
    files,
    oversizedIndexes,
    nextOrdinal,
  );
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
  const childItems = describeChildren(node.children, ownDir).map((descriptor) =>
    toPlacementItem(descriptor, budget, files, oversized, oversizedIndexes),
  );
  const topLevelItems = resolveGroupedPlacement(
    childItems,
    ownDir,
    budget,
    files,
    oversizedIndexes,
  );

  const ownContent = node.source?.raw ?? node.body;
  const ownFits =
    estimateTokens(ownContent) + estimateTokens(renderToc(topLevelItems)) <=
    budget;

  files.push({
    relativePath: ownFilePath,
    node,
    role,
    childPaths: topLevelItems.map((item) => item.emitPath),
  });
  if (!ownFits) {
    oversizedIndexes.push(ownFilePath);
  }

  for (const item of topLevelItems) {
    item.place();
  }
}

/**
 * Decide which nodes of a sized documentation tree become which emitted files.
 *
 * Every source file becomes one resource at its mirrored source path, with
 * its extension normalised to `.md`, and every source folder becomes one
 * `index.md` beside its contents. The root becomes `SKILL.md`, indexing the
 * top level of `resources`. A document is never split, so the token budget
 * no longer decides what becomes a file; it decides only how a table of
 * contents is partitioned and which files are reported as too large to read
 * cheaply.
 *
 * A resource whose own bytes exceed the budget is emitted whole and flagged
 * in `oversized`. An index whose table of contents cannot be partitioned any
 * further, because a single entry's rendered line exceeds the budget on its
 * own, is emitted whole and flagged in `oversizedIndexes`.
 *
 * @param root - The sized root of the documentation tree to plan
 * @param options - Planning options, including the maximum tokens allowed per emitted file
 * @returns The structural plan of files to emit
 */
export function planEmission(
  root: DocNode,
  options: { tokenBudget: number },
): EmissionPlan {
  const files: PlannedFile[] = [];
  const oversized: string[] = [];
  const oversizedIndexes: string[] = [];

  planIndexInto(
    root,
    "SKILL.md",
    "resources",
    "skill",
    options.tokenBudget,
    files,
    oversized,
    oversizedIndexes,
  );

  return { files, oversized, oversizedIndexes };
}
