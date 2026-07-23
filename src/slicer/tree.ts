import type { DocFile, DocNode } from "../types.js";

const headingLinePattern = /^(#{1,6})\s+(.*)$/;

interface FlatHeading {
  level: number;
  name: string;
  bodyLines: string[];
}

function humanize(segment: string): string {
  return segment.replace(/[-_]+/g, " ").trim();
}

function fileBaseName(relativePath: string): string {
  const fileName = relativePath.split("/").pop() ?? relativePath;
  return fileName.replace(/\.[^.]+$/, "");
}

function parseHeadings(content: string): {
  preamble: string;
  headings: FlatHeading[];
} {
  const lines = content.split("\n");
  const preambleLines: string[] = [];
  const headings: FlatHeading[] = [];
  let insideFence = false;
  let currentHeading: FlatHeading | undefined;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const targetLines = currentHeading?.bodyLines ?? preambleLines;

    if (insideFence) {
      targetLines.push(line);
      if (trimmedLine.startsWith("```")) {
        insideFence = false;
      }
      continue;
    }

    if (trimmedLine.startsWith("```")) {
      targetLines.push(line);
      insideFence = true;
      continue;
    }

    const headingMatch = headingLinePattern.exec(trimmedLine);
    if (headingMatch) {
      const [, hashes = "", text = ""] = headingMatch;
      currentHeading = {
        level: hashes.length,
        name: text.trim(),
        bodyLines: [],
      };
      headings.push(currentHeading);
      continue;
    }

    targetLines.push(line);
  }

  return {
    preamble: preambleLines.join("\n").trim(),
    headings,
  };
}

function nestHeadings(headings: FlatHeading[]): DocNode[] {
  const topLevelNodes: DocNode[] = [];
  const ancestorStack: { level: number; node: DocNode }[] = [];

  for (const heading of headings) {
    const node: DocNode = {
      name: heading.name,
      body: heading.bodyLines.join("\n").trim(),
      children: [],
      subtreeTokens: 0,
    };

    while (
      ancestorStack.length > 0 &&
      (ancestorStack[ancestorStack.length - 1]?.level ?? 0) >= heading.level
    ) {
      ancestorStack.pop();
    }

    const parent = ancestorStack[ancestorStack.length - 1];
    if (parent === undefined) {
      topLevelNodes.push(node);
    } else {
      parent.node.children.push(node);
    }

    ancestorStack.push({ level: heading.level, node });
  }

  return topLevelNodes;
}

function resolveFileName(
  file: DocFile,
  firstH1: FlatHeading | undefined,
): string {
  const trimmedTitle = file.frontmatter.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  if (firstH1?.name) {
    return firstH1.name;
  }

  return humanize(fileBaseName(file.relativePath));
}

function buildFileNode(file: DocFile): DocNode {
  const { preamble, headings } = parseHeadings(file.content);
  const firstH1 = headings.find((heading) => heading.level === 1);
  const name = resolveFileName(file, firstH1);

  return {
    name,
    body: preamble,
    children: nestHeadings(headings),
    subtreeTokens: 0,
  };
}

/**
 * Build a single normalized documentation tree spanning an entire fileset.
 *
 * Files are placed under their folder segments (humanized and merged in
 * first-appearance order), with each file becoming a node named from its
 * frontmatter title, else its first H1 heading, else its humanized
 * filename. Headings within each file become descendant nodes nested by
 * level, with skipped levels attaching to the nearest shallower ancestor.
 *
 * @param files - The fileset to build a tree from, in resolver order
 * @param rootName - The name assigned to the tree's root node
 * @returns The root node of the normalized tree
 */
export function buildTree(files: DocFile[], rootName: string): DocNode {
  const root: DocNode = {
    name: rootName,
    body: "",
    children: [],
    subtreeTokens: 0,
  };
  const folderNodesByPath = new Map<string, DocNode>([["", root]]);

  for (const file of files) {
    const segments = file.relativePath.split("/");
    const folderSegments = segments.slice(0, -1);
    let parentPath = "";
    let parentNode = root;

    for (const segment of folderSegments) {
      const folderPath =
        parentPath === "" ? segment : `${parentPath}/${segment}`;
      let folderNode = folderNodesByPath.get(folderPath);

      if (folderNode === undefined) {
        folderNode = {
          name: humanize(segment),
          body: "",
          children: [],
          subtreeTokens: 0,
        };
        parentNode.children.push(folderNode);
        folderNodesByPath.set(folderPath, folderNode);
      }

      parentNode = folderNode;
      parentPath = folderPath;
    }

    parentNode.children.push(buildFileNode(file));
  }

  return root;
}

function collapseNode(node: DocNode): DocNode {
  const collapsedChildren = node.children.map((child) => collapseNode(child));
  let current: DocNode = { ...node, children: collapsedChildren };

  while (current.body === "" && current.children.length === 1) {
    const [singleChild] = current.children;
    if (singleChild === undefined) {
      break;
    }
    current = singleChild;
  }

  return current;
}

/**
 * Collapse chains of empty-body, single-child nodes into their deepest node.
 *
 * While a node has exactly one child and an empty body, it is replaced by
 * that child, carrying forward the child's name, body, and children. The
 * root node is never collapsed, even if it would otherwise qualify, so its
 * name always survives.
 *
 * @param node - The root of the tree to collapse
 * @returns A new tree with single-child chains collapsed below the root
 */
export function collapseSingleChildChains(node: DocNode): DocNode {
  return {
    ...node,
    children: node.children.map((child) => collapseNode(child)),
  };
}
