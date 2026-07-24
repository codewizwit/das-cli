import { describe, expect, it } from "vitest";
import { buildSizedTree } from "../../src/slicer/build-sized-tree.js";
import type { DocFile } from "../../src/types.js";

describe("buildSizedTree", () => {
  it("collapses a single-child chain produced by a title matching its first H1, and sizes the result", () => {
    const files: DocFile[] = [
      {
        relativePath: "guides/install.md",
        content: "# Installation\n\nFollow these steps to install the tool.",
        frontmatter: { title: "Installation" },
      },
    ];

    const tree = buildSizedTree(files, "root");

    expect(tree.children).toHaveLength(1);
    const guidesFolder = tree.children[0]!;
    expect(guidesFolder.name).toBe("Installation");
    expect(guidesFolder.body).toBe("Follow these steps to install the tool.");
    expect(guidesFolder.children).toEqual([]);
    expect(guidesFolder.subtreeTokens).toBeGreaterThan(0);
  });

  it("sizes the tree after collapsing, not before, so subtreeTokens reflects the collapsed shape", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        content: "# Introduction\n\nWelcome to the docs.",
        frontmatter: { title: "Introduction" },
      },
    ];

    const uncollapsedFileNodeBodyTokens = 0;
    const tree = buildSizedTree(files, "root");
    const fileNode = tree.children[0]!;

    expect(fileNode.subtreeTokens).toBeGreaterThan(
      uncollapsedFileNodeBodyTokens,
    );
    expect(fileNode.body).toContain("Welcome to the docs.");
  });

  it("leaves a genuinely nested, non-redundant tree intact", () => {
    const files: DocFile[] = [
      {
        relativePath: "guide.md",
        content:
          "# Guide\n\nIntro text.\n\n## Step One\n\nDo the first thing.\n\n## Step Two\n\nDo the second thing.",
        frontmatter: { title: "Guide" },
      },
    ];

    const tree = buildSizedTree(files, "root");
    const fileNode = tree.children[0]!;

    expect(fileNode.name).toBe("Guide");
    expect(fileNode.children.map((child) => child.name)).toEqual([
      "Step One",
      "Step Two",
    ]);
  });
});
