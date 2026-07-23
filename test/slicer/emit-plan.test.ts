import { describe, expect, it } from "vitest";
import { planEmission } from "../../src/slicer/emit-plan.js";
import type { PlannedFile } from "../../src/slicer/emit-plan.js";
import { sizeTree } from "../../src/slicer/sizing.js";
import { estimateTokens } from "../../src/markdown/tokens.js";
import type { DocNode } from "../../src/types.js";

function unsizedNode(
  name: string,
  body: string,
  children: DocNode[] = [],
): DocNode {
  return { name, body, children, subtreeTokens: 0 };
}

function sized(node: DocNode): DocNode {
  return sizeTree(node);
}

function directoryOf(relativePath: string): string {
  if (relativePath === "SKILL.md") {
    return "resources";
  }
  return relativePath.endsWith("/index.md")
    ? relativePath.slice(0, -"/index.md".length)
    : relativePath;
}

function directChildrenOf(
  files: PlannedFile[],
  dir: string,
  ownFilePath: string,
): PlannedFile[] {
  return files.filter((file) => {
    if (file.relativePath === ownFilePath) {
      return false;
    }
    if (!file.relativePath.startsWith(`${dir}/`)) {
      return false;
    }
    const remainder = file.relativePath.slice(dir.length + 1);
    const segments = remainder.split("/");
    return (
      segments.length === 1 ||
      (segments.length === 2 && segments[1] === "index.md")
    );
  });
}

function reconstructedTocTokens(
  files: PlannedFile[],
  indexFile: PlannedFile,
): number {
  const dir = directoryOf(indexFile.relativePath);
  const children = directChildrenOf(files, dir, indexFile.relativePath);
  const lines = children.map((child) => {
    const remainder = child.relativePath.slice(dir.length + 1);
    return `- [${child.node.name}](${remainder})`;
  });
  return estimateTokens(lines.join("\n"));
}

function everyIndexLikeFile(files: PlannedFile[]): PlannedFile[] {
  return files.filter(
    (file) =>
      file.role === "index" || file.role === "group" || file.role === "skill",
  );
}

describe("planEmission", () => {
  it("emits a small doc as exactly one SKILL.md file with role skill", () => {
    const root = sized(
      unsizedNode("root", "Intro body.", [
        unsizedNode("Getting Started", "Getting started body."),
        unsizedNode("Reference", "Reference body."),
      ]),
    );

    const plan = planEmission(root, { tokenBudget: 5000 });

    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toEqual({
      relativePath: "SKILL.md",
      node: root,
      role: "skill",
    });
    expect(plan.oversized).toEqual([]);
  });

  it("inlines a subtree that fits the budget as one leaf, even though it has child headings", () => {
    const smallSubtree = unsizedNode("Guide", "Guide intro.", [
      unsizedNode("Step One", "Step one body."),
      unsizedNode("Step Two", "Step two body."),
    ]);
    const filler = unsizedNode("Filler", "x ".repeat(2000));
    const root = sized(unsizedNode("root", "", [smallSubtree, filler]));

    const plan = planEmission(root, { tokenBudget: 100 });

    const guideFile = plan.files.find((file) => file.node.name === "Guide");
    expect(guideFile).toBeDefined();
    expect(guideFile?.role).toBe("leaf");
    expect(guideFile?.relativePath).toBe("resources/guide.md");

    const stepFiles = plan.files.filter(
      (file) => file.node.name === "Step One" || file.node.name === "Step Two",
    );
    expect(stepFiles).toHaveLength(0);
  });

  it("groups ~200 tiny sibling sections so every emitted index/group ToC stays within budget", () => {
    const budget = 400;
    const sections = Array.from({ length: 200 }, (_, index) =>
      unsizedNode(
        `Section ${String(index + 1)}`,
        `Body text for section number ${String(index + 1)}.`,
      ),
    );
    const root = sized(unsizedNode("root", "", sections));

    const plan = planEmission(root, { tokenBudget: budget });

    for (const indexLikeFile of everyIndexLikeFile(plan.files)) {
      const tocTokens = reconstructedTocTokens(plan.files, indexLikeFile);
      expect(tocTokens).toBeLessThanOrEqual(budget);
    }

    const groupFiles = plan.files.filter((file) => file.role === "group");
    expect(groupFiles.length).toBeGreaterThan(1);

    const sectionLeaves = plan.files.filter(
      (file) => file.role === "leaf" && file.node.name.startsWith("Section "),
    );
    expect(sectionLeaves).toHaveLength(200);
  });

  it("produces an index at every level of deep nesting, each within budget", () => {
    const budget = 30;
    const leafFiller = "word ".repeat(40);
    const level3 = unsizedNode("Level Three", leafFiller, [
      unsizedNode("Deep Leaf A", "Deep leaf a body."),
      unsizedNode("Deep Leaf B", "Deep leaf b body."),
    ]);
    const level2 = unsizedNode("Level Two", leafFiller, [
      level3,
      unsizedNode("Level Two Sibling", "Sibling body."),
    ]);
    const level1 = unsizedNode("Level One", leafFiller, [
      level2,
      unsizedNode("Level One Sibling", "Sibling body."),
    ]);
    const root = sized(unsizedNode("root", leafFiller, [level1]));

    const plan = planEmission(root, { tokenBudget: budget });

    const skillFile = plan.files.find(
      (file) => file.relativePath === "SKILL.md",
    );
    expect(skillFile?.role).toBe("skill");

    const levelOneIndex = plan.files.find(
      (file) => file.node.name === "Level One",
    );
    const levelTwoIndex = plan.files.find(
      (file) => file.node.name === "Level Two",
    );
    const levelThreeIndex = plan.files.find(
      (file) => file.node.name === "Level Three",
    );

    expect(levelOneIndex?.role).toBe("index");
    expect(levelTwoIndex?.role).toBe("index");
    expect(levelThreeIndex?.role).toBe("index");

    for (const indexFile of everyIndexLikeFile(plan.files)) {
      expect(reconstructedTocTokens(plan.files, indexFile)).toBeLessThanOrEqual(
        budget,
      );
    }
  });

  it("emits a childless oversized node whole and flags it in oversized, without splitting it", () => {
    const hugeBody = "word ".repeat(5000);
    const oversizedLeaf = unsizedNode("Giant Section", hugeBody);
    const root = sized(
      unsizedNode("root", "", [
        unsizedNode("Small Section", "Small body."),
        oversizedLeaf,
      ]),
    );

    const plan = planEmission(root, { tokenBudget: 200 });

    const giantFile = plan.files.find(
      (file) => file.node.name === "Giant Section",
    );
    expect(giantFile).toBeDefined();
    expect(giantFile?.role).toBe("leaf");
    expect(giantFile?.node.body).toBe(hugeBody);
    expect(plan.oversized).toEqual([giantFile?.relativePath]);
  });

  it("assigns deterministic distinct slugs to same-name siblings, stable across runs and unrelated insertions", () => {
    const filler = unsizedNode("Filler", "x ".repeat(3000));
    const buildRoot = (withUnrelatedFirst: boolean): DocNode => {
      const children = withUnrelatedFirst
        ? [
            unsizedNode("Unrelated", "Unrelated body."),
            unsizedNode("Setup", "First setup body."),
            unsizedNode("Setup", "Second setup body."),
          ]
        : [
            unsizedNode("Setup", "First setup body."),
            unsizedNode("Setup", "Second setup body."),
          ];
      return sized(unsizedNode("root", "", [filler, ...children]));
    };

    const withoutUnrelated = planEmission(buildRoot(false), {
      tokenBudget: 50,
    });
    const withoutUnrelatedAgain = planEmission(buildRoot(false), {
      tokenBudget: 50,
    });
    const withUnrelated = planEmission(buildRoot(true), { tokenBudget: 50 });

    expect(withoutUnrelated.files.map((file) => file.relativePath)).toEqual(
      withoutUnrelatedAgain.files.map((file) => file.relativePath),
    );

    const setupPaths = (files: PlannedFile[]): string[] =>
      files
        .filter((file) => file.node.name === "Setup")
        .map((file) => file.relativePath)
        .sort();

    expect(setupPaths(withoutUnrelated.files)).toEqual([
      "resources/setup-2.md",
      "resources/setup.md",
    ]);
    expect(setupPaths(withUnrelated.files)).toEqual([
      "resources/setup-2.md",
      "resources/setup.md",
    ]);
  });

  it("keeps every planned relativePath globally unique across a complex fixture", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      unsizedNode(
        index % 2 === 0 ? "Duplicate" : `Unique ${String(index)}`,
        `Body ${String(index)}.`,
      ),
    );
    const nested = unsizedNode("Nested Group", "word ".repeat(300), [
      unsizedNode("Duplicate", "Nested duplicate body."),
      unsizedNode("Duplicate", "Another nested duplicate body."),
    ]);
    const root = sized(
      unsizedNode("root", "word ".repeat(300), [...many, nested]),
    );

    const plan = planEmission(root, { tokenBudget: 80 });

    const relativePaths = plan.files.map((file) => file.relativePath);
    expect(new Set(relativePaths).size).toBe(relativePaths.length);
  });

  it("moves an oversized index's own body into a separate Overview leaf, placed first", () => {
    const bigBody = "word ".repeat(200);
    const root = sized(
      unsizedNode("root", bigBody, [
        unsizedNode("Child One", "Child one body."),
        unsizedNode("Child Two", "Child two body."),
      ]),
    );

    const plan = planEmission(root, { tokenBudget: 50 });

    const skillFile = plan.files.find(
      (file) => file.relativePath === "SKILL.md",
    );
    expect(skillFile?.role).toBe("skill");
    expect(skillFile?.node.body).toBe("");

    const overviewFile = plan.files.find(
      (file) => file.node.name === "Overview",
    );
    expect(overviewFile).toBeDefined();
    expect(overviewFile?.node.body).toBe(bigBody);
    expect(overviewFile?.relativePath).toBe("resources/overview.md");
  });
});
