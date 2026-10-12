import { describe, expect, it } from "vitest";
import { buildSizedTree } from "../../src/slicer/build-sized-tree.js";
import type { DocFile } from "../../src/types.js";

describe("buildSizedTree", () => {
  it("keeps a source folder as a node of its own, because emitted paths mirror the source", () => {
    const files: DocFile[] = [
      {
        relativePath: "guides/install.md",
        raw: "# Installation\n\nFollow these steps to install the tool.",
        content: "# Installation\n\nFollow these steps to install the tool.",
        frontmatter: { title: "Installation" },
      },
    ];

    const tree = buildSizedTree(files, "root");

    expect(tree.children).toHaveLength(1);
    const guidesFolder = tree.children[0]!;
    expect(guidesFolder.segment).toBe("guides");
    expect(guidesFolder.children).toHaveLength(1);
    expect(guidesFolder.subtreeTokens).toBeGreaterThan(0);

    const installFile = guidesFolder.children[0]!;
    expect(installFile.name).toBe("Installation");
    expect(installFile.source?.relativePath).toBe("guides/install.md");
  });

  it("sizes the tree it builds, so a file node's tokens cover its headings", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        raw: "# Introduction\n\nWelcome to the docs.",
        content: "# Introduction\n\nWelcome to the docs.",
        frontmatter: { title: "Introduction" },
      },
    ];

    const tree = buildSizedTree(files, "root");
    const fileNode = tree.children[0]!;

    expect(fileNode.source?.relativePath).toBe("intro.md");
    expect(fileNode.subtreeTokens).toBeGreaterThan(0);
    expect(fileNode.children[0]?.body).toContain("Welcome to the docs.");
  });

  it("leaves a genuinely nested, non-redundant tree intact", () => {
    const files: DocFile[] = [
      {
        relativePath: "guide.md",
        raw:
          "# Guide\n\nIntro text.\n\n## Step One\n\nDo the first thing.\n\n## Step Two\n\nDo the second thing.",
        content:
          "# Guide\n\nIntro text.\n\n## Step One\n\nDo the first thing.\n\n## Step Two\n\nDo the second thing.",
        frontmatter: { title: "Guide" },
      },
    ];

    const tree = buildSizedTree(files, "root");
    const fileNode = tree.children[0]!;

    expect(fileNode.name).toBe("Guide");
    expect(fileNode.children.map((child) => child.name)).toEqual(["Guide"]);
    expect(
      fileNode.children[0]?.children.map((child) => child.name),
    ).toEqual(["Step One", "Step Two"]);
  });
});
