import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmptyFilesetError,
  resolveLocal,
  SymlinkSourceError,
} from "../../src/resolver/local.js";

describe("resolveLocal", () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "das-local-resolver-"));
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("resolves a single Markdown file to itself", async () => {
    const filePath = join(fixtureRoot, "notes.md");
    await writeFile(filePath, "# Notes\n\nSome content.");

    const result = await resolveLocal(filePath, { includeLarge: false });

    expect(result).toEqual([
      {
        relativePath: "notes.md",
        content: "# Notes\n\nSome content.",
        frontmatter: {},
      },
    ]);
  });

  it("recurses a folder and includes .md, .mdx, and .markdown case-insensitively, depth-first in order", async () => {
    await writeFile(join(fixtureRoot, "intro.MD"), "Intro body");
    await mkdir(join(fixtureRoot, "guides"));
    await writeFile(join(fixtureRoot, "guides", "setup.MDX"), "Setup body");
    await writeFile(
      join(fixtureRoot, "guides", "extra.Markdown"),
      "Extra body",
    );

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual([
      "guides/extra.Markdown",
      "guides/setup.MDX",
      "intro.MD",
    ]);
  });

  it("prefers a docs/ folder for a project root and always includes the top-level README first", async () => {
    await writeFile(join(fixtureRoot, "README.md"), "# Project\n\nOverview.");
    await writeFile(join(fixtureRoot, "ignored.md"), "Should not appear");
    await mkdir(join(fixtureRoot, "docs"));
    await writeFile(join(fixtureRoot, "docs", "intro.md"), "Intro body");

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual([
      "README.md",
      "intro.md",
    ]);
    expect(result[0]).toEqual({
      relativePath: "README.md",
      content: "# Project\n\nOverview.",
      frontmatter: {},
    });
  });

  it("excludes node_modules, hidden entries, CHANGELOG.md, and LICENSE files", async () => {
    await writeFile(join(fixtureRoot, "keep.md"), "Keep me");
    await mkdir(join(fixtureRoot, "node_modules"));
    await writeFile(
      join(fixtureRoot, "node_modules", "pkg.md"),
      "Should not appear",
    );
    await mkdir(join(fixtureRoot, ".hidden"));
    await writeFile(
      join(fixtureRoot, ".hidden", "secret.md"),
      "Should not appear",
    );
    await writeFile(join(fixtureRoot, ".dotfile.md"), "Should not appear");
    await writeFile(join(fixtureRoot, "CHANGELOG.md"), "Should not appear");
    await writeFile(join(fixtureRoot, "LICENSE.md"), "Should not appear");
    await writeFile(join(fixtureRoot, "LICENSE"), "Should not appear");

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual(["keep.md"]);
  });

  it("skips files over 1MB unless includeLarge is set, and warns to stderr", async () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const bigContent = "a".repeat(1024 * 1024 + 10);
    await writeFile(join(fixtureRoot, "big.md"), bigContent);
    await writeFile(join(fixtureRoot, "small.md"), "small body");

    const withoutLarge = await resolveLocal(fixtureRoot, {
      includeLarge: false,
    });

    expect(withoutLarge.map((file) => file.relativePath)).toEqual(["small.md"]);
    expect(stderrSpy).toHaveBeenCalled();

    stderrSpy.mockClear();

    const withLarge = await resolveLocal(fixtureRoot, {
      includeLarge: true,
    });

    expect(withLarge.map((file) => file.relativePath).sort()).toEqual([
      "big.md",
      "small.md",
    ]);

    stderrSpy.mockRestore();
  });

  it("skips files marked draft: true", async () => {
    await writeFile(
      join(fixtureRoot, "draft.md"),
      "---\ndraft: true\n---\nHidden",
    );
    await writeFile(join(fixtureRoot, "published.md"), "Visible");

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual(["published.md"]);
  });

  it("skips a symlinked file", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "das-local-outside-"));
    const targetPath = join(outsideRoot, "target.md");
    await writeFile(targetPath, "Target body");
    const linkPath = join(fixtureRoot, "link.md");

    try {
      await symlink(targetPath, linkPath, "file");
    } catch {
      console.warn(
        "Skipping symlinked-file test: platform forbids symlink creation",
      );
      await rm(outsideRoot, { recursive: true, force: true });
      return;
    }

    await writeFile(join(fixtureRoot, "other.md"), "Other body");

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual(["other.md"]);

    await rm(outsideRoot, { recursive: true, force: true });
  });

  it("skips a symlinked directory", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "das-local-outside-"));
    const realDirectory = join(outsideRoot, "real-docs");
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, "hidden.md"), "Should not appear");
    const linkedDirectory = join(fixtureRoot, "linked-docs");

    try {
      await symlink(realDirectory, linkedDirectory, "dir");
    } catch {
      console.warn(
        "Skipping symlinked-directory test: platform forbids symlink creation",
      );
      await rm(outsideRoot, { recursive: true, force: true });
      return;
    }

    await writeFile(join(fixtureRoot, "visible.md"), "Visible");

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual(["visible.md"]);

    await rm(outsideRoot, { recursive: true, force: true });
  });

  it("throws EmptyFilesetError when every file is a draft, listing what was searched", async () => {
    await writeFile(
      join(fixtureRoot, "draft-one.md"),
      "---\ndraft: true\n---\nHidden one",
    );
    await writeFile(
      join(fixtureRoot, "draft-two.md"),
      "---\ndraft: true\n---\nHidden two",
    );

    await expect(
      resolveLocal(fixtureRoot, { includeLarge: false }),
    ).rejects.toThrow(EmptyFilesetError);

    try {
      await resolveLocal(fixtureRoot, { includeLarge: false });
      throw new Error("expected resolveLocal to throw EmptyFilesetError");
    } catch (error) {
      expect(error).toBeInstanceOf(EmptyFilesetError);
      const emptyFilesetError = error as EmptyFilesetError;
      expect(emptyFilesetError.searchedPaths).toContain(fixtureRoot);
      expect(emptyFilesetError.message).toContain(fixtureRoot);
    }
  });

  it("rejects a symlinked top-level file with SymlinkSourceError", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "das-local-outside-"));
    const targetPath = join(outsideRoot, "target.md");
    await writeFile(targetPath, "Target body");
    const linkPath = join(fixtureRoot, "linked-file.md");

    try {
      await symlink(targetPath, linkPath, "file");
    } catch {
      console.warn(
        "Skipping symlinked top-level file test: platform forbids symlink creation",
      );
      await rm(outsideRoot, { recursive: true, force: true });
      return;
    }

    try {
      await resolveLocal(linkPath, { includeLarge: false });
      throw new Error("expected resolveLocal to throw SymlinkSourceError");
    } catch (error) {
      expect(error).toBeInstanceOf(SymlinkSourceError);
      expect((error as SymlinkSourceError).message).toContain(linkPath);
    }

    await rm(outsideRoot, { recursive: true, force: true });
  });

  it("rejects a symlinked top-level directory with SymlinkSourceError", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "das-local-outside-"));
    const realDirectory = join(outsideRoot, "real-docs-root");
    await mkdir(realDirectory);
    await writeFile(join(realDirectory, "intro.md"), "Intro body");
    const linkedDirectory = join(fixtureRoot, "linked-docs-root");

    try {
      await symlink(realDirectory, linkedDirectory, "dir");
    } catch {
      console.warn(
        "Skipping symlinked top-level directory test: platform forbids symlink creation",
      );
      await rm(outsideRoot, { recursive: true, force: true });
      return;
    }

    try {
      await resolveLocal(linkedDirectory, { includeLarge: false });
      throw new Error("expected resolveLocal to throw SymlinkSourceError");
    } catch (error) {
      expect(error).toBeInstanceOf(SymlinkSourceError);
      expect((error as SymlinkSourceError).message).toContain(linkedDirectory);
    }

    await rm(outsideRoot, { recursive: true, force: true });
  });

  it("falls through to documentation/ when docs/ contains only drafts", async () => {
    await mkdir(join(fixtureRoot, "docs"));
    await writeFile(
      join(fixtureRoot, "docs", "draft.md"),
      "---\ndraft: true\n---\nHidden",
    );
    await mkdir(join(fixtureRoot, "documentation"));
    await writeFile(join(fixtureRoot, "documentation", "real.md"), "Real body");

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual(["real.md"]);
  });

  it("keeps a file of exactly 1MB without includeLarge", async () => {
    const exactContent = "a".repeat(1024 * 1024);
    await writeFile(join(fixtureRoot, "exact.md"), exactContent);

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual(["exact.md"]);
  });

  it("orders files by sidebar_position across the fixture, unpositioned entries last", async () => {
    await writeFile(
      join(fixtureRoot, "z-last.md"),
      "---\nsidebar_position: 3\n---\nLast",
    );
    await writeFile(
      join(fixtureRoot, "a-first.md"),
      "---\nsidebar_position: 1\n---\nFirst",
    );
    await writeFile(
      join(fixtureRoot, "m-middle.md"),
      "---\nsidebar_position: 2\n---\nMiddle",
    );
    await writeFile(join(fixtureRoot, "unpositioned.md"), "No position");

    const result = await resolveLocal(fixtureRoot, { includeLarge: false });

    expect(result.map((file) => file.relativePath)).toEqual([
      "a-first.md",
      "m-middle.md",
      "z-last.md",
      "unpositioned.md",
    ]);
  });
});
