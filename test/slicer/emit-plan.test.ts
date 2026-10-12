import { describe, expect, it } from "vitest";
import { planEmission } from "../../src/slicer/emit-plan.js";
import type { EmissionPlan, PlannedFile } from "../../src/slicer/emit-plan.js";
import { sizeTree } from "../../src/slicer/sizing.js";
import { estimateTokens } from "../../src/markdown/tokens.js";
import type { DocNode } from "../../src/types.js";

function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * A node as the slicer now builds them: a childless node is a source file and
 * a node with children is a source folder. Emitted paths mirror the source,
 * so the segment and file name come from here rather than from a slug the
 * planner invents.
 */
function unsizedNode(
  name: string,
  body: string,
  children: DocNode[] = [],
): DocNode {
  const segment = slugOf(name);

  if (children.length === 0) {
    return {
      name,
      body,
      children,
      subtreeTokens: 0,
      source: {
        relativePath: `${segment}.md`,
        raw: body,
        content: body,
        frontmatter: {},
      },
    };
  }

  return { name, body, children, subtreeTokens: 0, segment };
}

/** A source file at an explicit path, for cases where the name differs. */
function fileNode(relativePath: string, name: string, body: string): DocNode {
  return {
    name,
    body,
    children: [],
    subtreeTokens: 0,
    source: { relativePath, raw: body, content: body, frontmatter: {} },
  };
}

function sized(node: DocNode): DocNode {
  return sizeTree(node);
}

function estimatedFileTokens(files: PlannedFile[], file: PlannedFile): number {
  if (file.role === "leaf") {
    return file.node.source === undefined
      ? file.node.subtreeTokens
      : estimateTokens(file.node.source.raw);
  }

  const lines = file.childPaths.map((path) => {
    const target = files.find((candidate) => candidate.relativePath === path);
    const name = target?.node.name ?? path;
    return `- [${name}](${path})`;
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
  it("emits SKILL.md plus one resource per source file even when the whole tree fits", () => {
    const root = sized(
      unsizedNode("root", "Intro body.", [
        unsizedNode("Getting Started", "Getting started body."),
        unsizedNode("Reference", "Reference body."),
      ]),
    );

    const plan = planEmission(root, { tokenBudget: 5000 });

    expect(plan.files.map((file) => file.relativePath)).toEqual([
      "SKILL.md",
      "resources/getting-started.md",
      "resources/reference.md",
    ]);
    expect(plan.files[0]?.role).toBe("skill");
    expect(plan.files[0]?.childPaths).toEqual([
      "resources/getting-started.md",
      "resources/reference.md",
    ]);
    expect(plan.oversized).toEqual([]);
    expect(plan.oversizedIndexes).toEqual([]);
  });

  it("never splits a document into per-heading files, whatever the budget", () => {
    const guide = fileNode(
      "guide.md",
      "Guide",
      `# Guide\n\n## Step One\n\n${"word ".repeat(400)}`,
    );
    const root = sized(unsizedNode("root", "", [guide]));

    const plan = planEmission(root, { tokenBudget: 50 });

    const guideFiles = plan.files.filter((file) => file.node.name === "Guide");
    expect(guideFiles).toHaveLength(1);
    expect(guideFiles[0]?.role).toBe("leaf");
    expect(guideFiles[0]?.relativePath).toBe("resources/guide.md");
    expect(guideFiles[0]?.childPaths).toEqual([]);
    expect(plan.oversized).toContain("resources/guide.md");
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

  it("gives two files sharing a display name distinct paths, taken from their file names", () => {
    const filler = unsizedNode("Filler", "x ".repeat(3000));
    const buildRoot = (): DocNode =>
      sized(
        unsizedNode("root", "", [
          filler,
          fileNode("setup.md", "Setup", "First setup body."),
          fileNode("setup-advanced.md", "Setup", "Second setup body."),
        ]),
      );

    const first = planEmission(buildRoot(), { tokenBudget: 50 });
    const again = planEmission(buildRoot(), { tokenBudget: 50 });

    expect(first.files.map((file) => file.relativePath)).toEqual(
      again.files.map((file) => file.relativePath),
    );

    const setupPaths = first.files
      .filter((file) => file.node.name === "Setup")
      .map((file) => file.relativePath)
      .sort();
    expect(setupPaths).toEqual([
      "resources/setup-advanced.md",
      "resources/setup.md",
    ]);
  });

  it("keeps every planned relativePath globally unique across a complex fixture", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      fileNode(
        `doc-${String(index)}.md`,
        index % 2 === 0 ? "Duplicate" : `Unique ${String(index)}`,
        `Body ${String(index)}.`,
      ),
    );
    const nested = unsizedNode("Nested Group", "word ".repeat(300), [
      fileNode("one.md", "Duplicate", "Nested duplicate body."),
      fileNode("two.md", "Duplicate", "Another nested duplicate body."),
    ]);
    const root = sized(
      unsizedNode("root", "word ".repeat(300), [...many, nested]),
    );

    const plan = planEmission(root, { tokenBudget: 80 });

    const relativePaths = plan.files.map((file) => file.relativePath);
    expect(new Set(relativePaths).size).toBe(relativePaths.length);

    assertReferentialIntegrity(plan);
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

  describe("an index keeps its own body", () => {
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

      const leaf = plan.files.find((file) => file.role === "leaf");
      expect(leaf?.relativePath).toBe("resources/only-child.md");
      expect(leaf?.childPaths).toEqual([]);
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
