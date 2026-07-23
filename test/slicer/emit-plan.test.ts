import { describe, expect, it } from "vitest";
import { planEmission } from "../../src/slicer/emit-plan.js";
import type { EmissionPlan, PlannedFile } from "../../src/slicer/emit-plan.js";
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

function directoryOfFile(file: PlannedFile): string {
  if (file.relativePath === "SKILL.md") {
    return "resources";
  }
  return file.relativePath.endsWith("/index.md")
    ? file.relativePath.slice(0, -"/index.md".length)
    : file.relativePath;
}

function estimatedFileTokens(files: PlannedFile[], file: PlannedFile): number {
  if (file.role === "leaf") {
    return file.node.subtreeTokens;
  }

  const dir = directoryOfFile(file);
  const lines = file.childPaths.map((path) => {
    const target = files.find((candidate) => candidate.relativePath === path);
    const name = target?.node.name ?? path;
    const linkPath = path.startsWith(`${dir}/`)
      ? path.slice(dir.length + 1)
      : path;
    return `- [${name}](${linkPath})`;
  });
  const tocTokens = estimateTokens(lines.join("\n"));
  const bodyTokens = file.node.body === "" ? 0 : estimateTokens(file.node.body);

  return bodyTokens + tocTokens;
}

function assertAllFilesWithinBudgetOrFlagged(
  plan: EmissionPlan,
  budget: number,
): void {
  for (const file of plan.files) {
    const isFlagged =
      plan.oversized.includes(file.relativePath) ||
      plan.oversizedIndexes.includes(file.relativePath);

    if (isFlagged) {
      continue;
    }

    expect(estimatedFileTokens(plan.files, file)).toBeLessThanOrEqual(budget);
  }
}

function assertReferentialIntegrity(plan: EmissionPlan): void {
  const allPaths = new Set(plan.files.map((file) => file.relativePath));

  for (const file of plan.files) {
    for (const childPath of file.childPaths) {
      expect(allPaths.has(childPath)).toBe(true);
    }
  }
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
      childPaths: [],
    });
    expect(plan.oversized).toEqual([]);
    expect(plan.oversizedIndexes).toEqual([]);
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
    expect(guideFile?.childPaths).toEqual([]);

    const stepFiles = plan.files.filter(
      (file) => file.node.name === "Step One" || file.node.name === "Step Two",
    );
    expect(stepFiles).toHaveLength(0);

    assertAllFilesWithinBudgetOrFlagged(plan, 100);
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

    assertAllFilesWithinBudgetOrFlagged(plan, budget);
    assertReferentialIntegrity(plan);
    expect(plan.oversizedIndexes).toEqual([]);

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

    assertAllFilesWithinBudgetOrFlagged(plan, budget);
    assertReferentialIntegrity(plan);
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
    expect(giantFile?.childPaths).toEqual([]);
    expect(plan.oversized).toEqual([giantFile?.relativePath]);

    assertReferentialIntegrity(plan);
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

    assertReferentialIntegrity(plan);
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

  describe("irreducible ToC entries (Rule 3 base case)", () => {
    it("does not throw and flags the enclosing file when one of two siblings has an unshrinkable heading name", () => {
      const budget = 30;
      const hugeName = "X ".repeat(500);
      const root = sized(
        unsizedNode("root", "word ".repeat(20), [
          unsizedNode(hugeName, "Small body."),
          unsizedNode("Normal Section", "Small body."),
        ]),
      );

      expect(() => planEmission(root, { tokenBudget: budget })).not.toThrow();

      const plan = planEmission(root, { tokenBudget: budget });
      const skillFile = plan.files.find(
        (file) => file.relativePath === "SKILL.md",
      );
      expect(skillFile).toBeDefined();
      expect(plan.oversizedIndexes).toContain("SKILL.md");

      assertAllFilesWithinBudgetOrFlagged(plan, budget);
      assertReferentialIntegrity(plan);
    });

    it("completes without crashing when a single child's ToC line alone exceeds the budget", () => {
      const budget = 30;
      const hugeName = "X ".repeat(500);
      const root = sized(
        unsizedNode("root", "word ".repeat(40), [
          unsizedNode(hugeName, "Small body."),
        ]),
      );

      expect(() => planEmission(root, { tokenBudget: budget })).not.toThrow();

      const plan = planEmission(root, { tokenBudget: budget });
      expect(plan.oversizedIndexes).toContain("SKILL.md");

      assertAllFilesWithinBudgetOrFlagged(plan, budget);
      assertReferentialIntegrity(plan);
    });

    it("still groups a genuinely groupable large set with no oversizedIndexes entries", () => {
      const budget = 400;
      const sections = Array.from({ length: 200 }, (_, index) =>
        unsizedNode(
          `Section ${String(index + 1)}`,
          `Body text for section number ${String(index + 1)}.`,
        ),
      );
      const root = sized(unsizedNode("root", "", sections));

      const plan = planEmission(root, { tokenBudget: budget });

      expect(plan.oversizedIndexes).toEqual([]);
      assertAllFilesWithinBudgetOrFlagged(plan, budget);
    });
  });

  describe("Overview trigger uses the post-grouping table of contents", () => {
    it("keeps the body in SKILL.md when the grouped ToC easily fits alongside it", () => {
      const budget = 400;
      const body = "word ".repeat(60);
      const sections = Array.from({ length: 300 }, (_, index) =>
        unsizedNode(
          `Section ${String(index + 1)}`,
          `Body text for section number ${String(index + 1)}.`,
        ),
      );
      const root = sized(unsizedNode("root", body, sections));

      const plan = planEmission(root, { tokenBudget: budget });

      const overviewFile = plan.files.find(
        (file) => file.node.name === "Overview",
      );
      expect(overviewFile).toBeUndefined();

      const skillFile = plan.files.find(
        (file) => file.relativePath === "SKILL.md",
      );
      expect(skillFile?.node.body).toBe(body);
    });

    it("still relocates the body to Overview when body plus the real ToC exceeds budget", () => {
      const budget = 40;
      const body = "word ".repeat(40);
      const root = sized(
        unsizedNode("root", body, [
          unsizedNode("Child One", "Child one body."),
          unsizedNode("Child Two", "Child two body."),
        ]),
      );

      const plan = planEmission(root, { tokenBudget: budget });

      const overviewFile = plan.files.find(
        (file) => file.node.name === "Overview",
      );
      expect(overviewFile).toBeDefined();
      expect(overviewFile?.node.body).toBe(body);

      const skillFile = plan.files.find(
        (file) => file.relativePath === "SKILL.md",
      );
      expect(skillFile?.node.body).toBe("");
    });
  });

  describe("childPaths", () => {
    it("lists an index's childPaths as the ordered relativePaths of the files it links", () => {
      const root = sized(
        unsizedNode("root", "", [
          unsizedNode("Alpha", "word ".repeat(15)),
          unsizedNode("Beta", "word ".repeat(15)),
        ]),
      );

      const plan = planEmission(root, { tokenBudget: 20 });

      const skillFile = plan.files.find(
        (file) => file.relativePath === "SKILL.md",
      );
      const alphaFile = plan.files.find((file) => file.node.name === "Alpha");
      const betaFile = plan.files.find((file) => file.node.name === "Beta");

      expect(skillFile?.childPaths).toEqual([
        alphaFile?.relativePath,
        betaFile?.relativePath,
      ]);
    });

    it("lists a grouped parent's childPaths as the group index paths, not the grandchildren", () => {
      const budget = 400;
      const sections = Array.from({ length: 200 }, (_, index) =>
        unsizedNode(
          `Section ${String(index + 1)}`,
          `Body text for section number ${String(index + 1)}.`,
        ),
      );
      const root = sized(unsizedNode("root", "", sections));

      const plan = planEmission(root, { tokenBudget: budget });

      const skillFile = plan.files.find(
        (file) => file.relativePath === "SKILL.md",
      );
      expect(skillFile?.childPaths.length).toBeGreaterThan(0);
      for (const childPath of skillFile?.childPaths ?? []) {
        expect(childPath).toMatch(/^resources\/group-\d+\/index\.md$/);
      }
    });

    it("gives a leaf an empty childPaths array", () => {
      const root = sized(
        unsizedNode("root", "", [unsizedNode("Only Child", "Body.")]),
      );

      const plan = planEmission(root, { tokenBudget: 5000 });

      expect(plan.files[0]?.role).toBe("skill");
      expect(plan.files[0]?.childPaths).toEqual([]);
    });

    it("keeps every childPath referentially valid across a complex grouped and nested fixture", () => {
      const nested = unsizedNode("Nested", "word ".repeat(200), [
        unsizedNode("Nested Child One", "Body one."),
        unsizedNode("Nested Child Two", "Body two."),
      ]);
      const sections = Array.from({ length: 150 }, (_, index) =>
        unsizedNode(`Topic ${String(index + 1)}`, `Body ${String(index)}.`),
      );
      const root = sized(
        unsizedNode("root", "word ".repeat(100), [...sections, nested]),
      );

      const plan = planEmission(root, { tokenBudget: 300 });

      assertReferentialIntegrity(plan);
    });
  });
});
