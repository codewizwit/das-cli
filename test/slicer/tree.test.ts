import { describe, expect, it } from "vitest";
import { buildTree, collapseSingleChildChains } from "../../src/slicer/tree.js";
import type { DocFile, DocNode } from "../../src/types.js";

describe("buildTree", () => {
  it("names the file node from frontmatter title when present", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        raw: "# Introduction\n\nWelcome to the docs.",
        content: "# Introduction\n\nWelcome to the docs.",
        frontmatter: { title: "Getting Started" },
      },
    ];

    const tree = buildTree(files, "root");

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.name).toBe("Getting Started");
  });

  it("names the file node from the first H1 when no frontmatter title is present", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        raw: "# Introduction\n\nWelcome to the docs.",
        content: "# Introduction\n\nWelcome to the docs.",
        frontmatter: {},
      },
    ];

    const tree = buildTree(files, "root");

    expect(tree.children[0]?.name).toBe("Introduction");
  });

  it("names the file node from the humanized filename when neither title nor H1 exists", () => {
    const files: DocFile[] = [
      {
        relativePath: "getting-started.md",
        raw: "Just some prose with no headings.",
        content: "Just some prose with no headings.",
        frontmatter: {},
      },
    ];

    const tree = buildTree(files, "root");

    expect(tree.children[0]?.name).toBe("getting started");
  });

  it("attaches preamble prose before the first heading as the file node body", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        raw:
          "This is preamble text.\n\n# Introduction\n\nBody after heading.",
        content:
          "This is preamble text.\n\n# Introduction\n\nBody after heading.",
        frontmatter: {},
      },
    ];

    const tree = buildTree(files, "root");

    expect(tree.children[0]?.body).toBe("This is preamble text.");
  });

  it("attaches a skipped-level heading to the nearest shallower ancestor", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        raw:
          "# Introduction\n\nIntro body.\n\n### Details\n\nDetails body.",
        content:
          "# Introduction\n\nIntro body.\n\n### Details\n\nDetails body.",
        frontmatter: {},
      },
    ];

    const tree = buildTree(files, "root");
    const fileNode = tree.children[0]!;

    expect(fileNode.name).toBe("Introduction");
    expect(fileNode.children).toHaveLength(1);

    const h1 = fileNode.children[0]!;
    expect(h1.name).toBe("Introduction");
    expect(h1.body).toBe("Intro body.");
    expect(h1.children).toHaveLength(1);
    expect(h1.children[0]?.name).toBe("Details");
    expect(h1.children[0]?.body).toBe("Details body.");
  });

  it("treats multiple H1 headings as siblings under the file node", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        raw:
          "# First Section\n\nFirst body.\n\n# Second Section\n\nSecond body.",
        content:
          "# First Section\n\nFirst body.\n\n# Second Section\n\nSecond body.",
        frontmatter: {},
      },
    ];

    const tree = buildTree(files, "root");
    const fileNode = tree.children[0]!;

    expect(fileNode.children.map((child) => child.name)).toEqual([
      "First Section",
      "Second Section",
    ]);
    expect(fileNode.children.map((child) => child.body)).toEqual([
      "First body.",
      "Second body.",
    ]);
  });

  it("nests files under folder nodes named from the folder segments, in first-appearance order", () => {
    const files: DocFile[] = [
      {
        relativePath: "guides/setup.md",
        raw: "# Setup\n\nSetup body.",
        content: "# Setup\n\nSetup body.",
        frontmatter: {},
      },
      {
        relativePath: "api-reference/overview.md",
        raw: "# Overview\n\nOverview body.",
        content: "# Overview\n\nOverview body.",
        frontmatter: {},
      },
      {
        relativePath: "guides/advanced.md",
        raw: "# Advanced\n\nAdvanced body.",
        content: "# Advanced\n\nAdvanced body.",
        frontmatter: {},
      },
    ];

    const tree = buildTree(files, "root");

    expect(tree.children.map((child) => child.name)).toEqual([
      "guides",
      "api reference",
    ]);

    const guidesFolder = tree.children[0]!;
    expect(guidesFolder.children.map((child) => child.name)).toEqual([
      "Setup",
      "Advanced",
    ]);

    const apiReferenceFolder = tree.children[1]!;
    expect(apiReferenceFolder.children.map((child) => child.name)).toEqual([
      "Overview",
    ]);
  });

  it("does not treat a hash-prefixed line inside a fenced code block as a heading", () => {
    const files: DocFile[] = [
      {
        relativePath: "intro.md",
        raw: "# Introduction\n\n```\n# not a heading\n```\n\nReal prose.",
        content: "# Introduction\n\n```\n# not a heading\n```\n\nReal prose.",
        frontmatter: {},
      },
    ];

    const tree = buildTree(files, "root");
    const fileNode = tree.children[0]!;

    expect(fileNode.children).toHaveLength(1);
    expect(fileNode.children[0]?.name).toBe("Introduction");
    expect(fileNode.children[0]?.body).toBe(
      "```\n# not a heading\n```\n\nReal prose.",
    );
  });
});

describe("a folder's own landing page", () => {
  const titleFor = (fileName: string): string =>
    fileName.replace(/\.(md|mdx|markdown)$/i, "").toUpperCase();

  const folderWith = (names: string[]): DocFile[] =>
    names.map((name) => {
      const title = titleFor(name);
      return {
        relativePath: `architecture/${name}`,
        raw: `---\ntitle: ${title}\ndescription: About ${title}.\n---\n\n# ${title}\n`,
        content: `# ${title}\n`,
        frontmatter: { title, description: `About ${title}.` },
      };
    });

  it("reads an index.md for the folder's name and description, and still lists it", () => {
    const tree = buildTree(folderWith(["index.md", "overview.md"]), "root");
    const folder = tree.children[0]!;

    expect(folder.segment).toBe("architecture");
    expect(folder.landing?.relativePath).toBe("architecture/index.md");
    // The landing page's own title names the folder.
    expect(folder.name).toBe("INDEX");
    // It stays an ordinary entry; das's index has a name of its own.
    expect(folder.children.map((child) => child.source?.relativePath)).toEqual([
      "architecture/index.md",
      "architecture/overview.md",
    ]);
    expect(folder.source).toBeUndefined();
  });

  it("reads a README.md the same way, and prefers index.md when both exist", () => {
    const readmeOnly = buildTree(folderWith(["README.md", "a.md"]), "root");
    expect(readmeOnly.children[0]?.landing?.relativePath).toBe(
      "architecture/README.md",
    );

    const both = buildTree(
      folderWith(["README.md", "index.md", "a.md"]),
      "root",
    );
    expect(both.children[0]?.landing?.relativePath).toBe(
      "architecture/index.md",
    );
    expect(
      both.children[0]?.children.map((child) => child.source?.relativePath),
    ).toEqual([
      "architecture/index.md",
      "architecture/README.md",
      "architecture/a.md",
    ]);
  });

  it("keeps the folder segment as the name when the landing page declares no title", () => {
    const tree = buildTree(
      [
        {
          relativePath: "architecture/index.md",
          raw: "Just prose, no heading and no frontmatter.\n",
          content: "Just prose, no heading and no frontmatter.\n",
          frontmatter: {},
        },
      ],
      "root",
    );
    const folder = tree.children[0]!;

    expect(folder.landing?.relativePath).toBe("architecture/index.md");
    expect(folder.name).toBe("architecture");
  });

  it("leaves a top-level README alone, since SKILL.md is the root index", () => {
    const tree = buildTree(
      [
        {
          relativePath: "README.md",
          raw: "# Handbook\n",
          content: "# Handbook\n",
          frontmatter: {},
        },
      ],
      "root",
    );

    expect(tree.landing).toBeUndefined();
    expect(tree.children.map((child) => child.source?.relativePath)).toEqual([
      "README.md",
    ]);
  });
});

describe("collapseSingleChildChains", () => {
  it("collapses a chain of empty-body single-child nodes into one node carrying the deepest node's content", () => {
    const leaf: DocNode = {
      name: "leaf-child",
      body: "leaf child body",
      children: [],
      subtreeTokens: 0,
    };
    const deepest: DocNode = {
      name: "C",
      body: "C body",
      children: [leaf],
      subtreeTokens: 0,
    };
    const middle: DocNode = {
      name: "B",
      body: "",
      children: [deepest],
      subtreeTokens: 0,
    };
    const top: DocNode = {
      name: "A",
      body: "",
      children: [middle],
      subtreeTokens: 0,
    };
    const root: DocNode = {
      name: "root",
      body: "",
      children: [top],
      subtreeTokens: 0,
    };

    const collapsed = collapseSingleChildChains(root);

    expect(collapsed.name).toBe("root");
    expect(collapsed.children).toHaveLength(1);

    const collapsedChain = collapsed.children[0]!;
    expect(collapsedChain.name).toBe("C");
    expect(collapsedChain.body).toBe("C body");
    expect(collapsedChain.children).toEqual([leaf]);
  });

  it("does not collapse the root even when it has a single empty-body child", () => {
    const onlyChild: DocNode = {
      name: "only-child",
      body: "child body",
      children: [],
      subtreeTokens: 0,
    };
    const root: DocNode = {
      name: "root",
      body: "",
      children: [onlyChild],
      subtreeTokens: 0,
    };

    const collapsed = collapseSingleChildChains(root);

    expect(collapsed.name).toBe("root");
    expect(collapsed.children).toEqual([onlyChild]);
  });

  it("does not collapse a single-child node that has a non-empty body", () => {
    const grandchild: DocNode = {
      name: "grandchild",
      body: "grandchild body",
      children: [],
      subtreeTokens: 0,
    };
    const child: DocNode = {
      name: "child",
      body: "child has content",
      children: [grandchild],
      subtreeTokens: 0,
    };
    const root: DocNode = {
      name: "root",
      body: "",
      children: [child],
      subtreeTokens: 0,
    };

    const collapsed = collapseSingleChildChains(root);

    expect(collapsed.children).toHaveLength(1);
    expect(collapsed.children[0]?.name).toBe("child");
    expect(collapsed.children[0]?.children).toEqual([grandchild]);
  });
});
