import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedSourceError } from "../../src/resolver/github-url.js";
import type { GitRunner } from "../../src/resolver/git.js";
import {
  defaultMaxFileCount,
  defaultMaxTotalContentBytes,
  resolveSource,
  SourceTooLargeError,
} from "../../src/resolver/resolve.js";
import type { SourceRef } from "../../src/types.js";

const repoUrl = "https://github.com/octocat/hello-world.git";
const pinnedSha = "1111111111111111111111111111111111111111";
const headSha = "2222222222222222222222222222222222222222";

interface MockGitRunnerFixtures {
  headSha?: string;
  populateClone?: (destinationPath: string) => Promise<void>;
}

function createMockGitRunner(fixtures: MockGitRunnerFixtures = {}): {
  runner: GitRunner;
  calls: string[][];
  clonedDestinations: string[];
} {
  const calls: string[][] = [];
  const clonedDestinations: string[] = [];

  const runner: GitRunner = async (args) => {
    calls.push(args);

    if (args[0] === "ls-remote") {
      const sha = fixtures.headSha ?? headSha;
      return { exitCode: 0, stdout: `${sha}\tHEAD\n` };
    }

    if (args[0] === "clone") {
      const destinationPath = args.at(-1);

      if (destinationPath === undefined) {
        throw new Error("mock clone call missing a destination argument");
      }

      clonedDestinations.push(destinationPath);

      if (fixtures.populateClone) {
        await fixtures.populateClone(destinationPath);
      }
    }

    return { exitCode: 0, stdout: "" };
  };

  return { runner, calls, clonedDestinations };
}

async function writeFlatMarkdownFiles(
  directoryPath: string,
  count: number,
  bytesPerFile: number,
): Promise<void> {
  const writes: Promise<void>[] = [];

  for (let index = 0; index < count; index += 1) {
    const fileName = `file-${String(index).padStart(5, "0")}.md`;
    writes.push(
      writeFile(join(directoryPath, fileName), "a".repeat(bytesPerFile)),
    );
  }

  await Promise.all(writes);
}

describe("resolveSource", () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "das-resolve-facade-"));
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  describe("path refs", () => {
    it("delegates to resolveLocal and returns its DocFiles", async () => {
      await writeFile(join(fixtureRoot, "notes.md"), "# Notes\n\nBody text.");

      const ref: SourceRef = {
        type: "path",
        path: fixtureRoot,
        kind: "project",
      };

      const result = await resolveSource(ref, { includeLarge: false });

      expect(result).toEqual([
        {
          relativePath: "notes.md",
          content: "# Notes\n\nBody text.",
          frontmatter: {},
        },
      ]);
    });

    it("throws SourceTooLargeError when a local fileset exceeds the injected file-count cap", async () => {
      await writeFlatMarkdownFiles(fixtureRoot, 3, 10);

      const ref: SourceRef = {
        type: "path",
        path: fixtureRoot,
        kind: "folder",
      };

      await expect(
        resolveSource(ref, { includeLarge: false, maxFiles: 2 }),
      ).rejects.toThrow(SourceTooLargeError);
    });
  });

  describe("github refs", () => {
    it("clones at the pinned sha without calling lsRemote", async () => {
      const { runner, calls } = createMockGitRunner({
        populateClone: (destinationPath) =>
          writeFile(join(destinationPath, "notes.md"), "Pinned body"),
      });

      const ref: SourceRef = { type: "github", url: repoUrl, subpath: null };

      const result = await resolveSource(ref, {
        includeLarge: false,
        pinnedSha,
        gitRunner: runner,
      });

      expect(calls.some((args) => args[0] === "ls-remote")).toBe(false);
      expect(calls.some((args) => args.includes(pinnedSha))).toBe(true);
      expect(result).toEqual([
        {
          relativePath: "notes.md",
          content: "Pinned body",
          frontmatter: {},
        },
      ]);
    });

    it("resolves HEAD via lsRemote when no pinnedSha is given", async () => {
      const { runner, calls } = createMockGitRunner({
        headSha,
        populateClone: (destinationPath) =>
          writeFile(join(destinationPath, "notes.md"), "HEAD body"),
      });

      const ref: SourceRef = { type: "github", url: repoUrl, subpath: null };

      const result = await resolveSource(ref, {
        includeLarge: false,
        gitRunner: runner,
      });

      const lsRemoteCall = calls.find((args) => args[0] === "ls-remote");
      expect(lsRemoteCall).toEqual(["ls-remote", "--", repoUrl, "HEAD"]);
      expect(calls.some((args) => args.includes(headSha))).toBe(true);
      expect(result).toEqual([
        {
          relativePath: "notes.md",
          content: "HEAD body",
          frontmatter: {},
        },
      ]);
    });

    it("resolves resolveLocal against the given subpath within the clone", async () => {
      const { runner } = createMockGitRunner({
        populateClone: async (destinationPath) => {
          await writeFile(
            join(destinationPath, "README.md"),
            "Should not appear",
          );
          await mkdir(join(destinationPath, "docs"));
          await writeFile(
            join(destinationPath, "docs", "intro.md"),
            "Intro body",
          );
        },
      });

      const ref: SourceRef = {
        type: "github",
        url: repoUrl,
        subpath: "docs",
      };

      const result = await resolveSource(ref, {
        includeLarge: false,
        pinnedSha,
        gitRunner: runner,
      });

      expect(result).toEqual([
        {
          relativePath: "intro.md",
          content: "Intro body",
          frontmatter: {},
        },
      ]);
    });

    it("still enforces the injected caps on a cloned fileset", async () => {
      const { runner } = createMockGitRunner({
        populateClone: (destinationPath) =>
          writeFlatMarkdownFiles(destinationPath, 3, 10),
      });

      const ref: SourceRef = { type: "github", url: repoUrl, subpath: null };

      await expect(
        resolveSource(ref, {
          includeLarge: false,
          pinnedSha,
          gitRunner: runner,
          maxFiles: 2,
        }),
      ).rejects.toThrow(SourceTooLargeError);
    });

    it("throws UnsupportedSourceError with a subpath-specific message when the subpath escapes the clone root", async () => {
      const { runner } = createMockGitRunner();
      const subpath = "../../etc";

      const ref: SourceRef = {
        type: "github",
        url: repoUrl,
        subpath,
      };

      await expect(
        resolveSource(ref, {
          includeLarge: false,
          pinnedSha,
          gitRunner: runner,
        }),
      ).rejects.toThrow(UnsupportedSourceError);

      try {
        await resolveSource(ref, {
          includeLarge: false,
          pinnedSha,
          gitRunner: runner,
        });
        throw new Error("expected resolveSource to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedSourceError);
        expect((error as UnsupportedSourceError).message).toContain(
          "escapes the repository root",
        );
        expect((error as UnsupportedSourceError).message).toContain(subpath);
        expect((error as UnsupportedSourceError).message).not.toContain(
          "Supported forms are",
        );
      }
    });

    it("removes the temp clone directory after resolving", async () => {
      const { runner, clonedDestinations } = createMockGitRunner({
        populateClone: (destinationPath) =>
          writeFile(join(destinationPath, "notes.md"), "Body"),
      });

      const ref: SourceRef = { type: "github", url: repoUrl, subpath: null };

      await resolveSource(ref, {
        includeLarge: false,
        pinnedSha,
        gitRunner: runner,
      });

      expect(clonedDestinations).toHaveLength(1);
      const clonedDestination = clonedDestinations[0];
      expect(clonedDestination).toBeDefined();
      await expect(access(clonedDestination ?? "")).rejects.toThrow();
    });
  });

  describe("caps", () => {
    it("exports the real default caps of 5000 files and 100MB", () => {
      expect(defaultMaxFileCount).toBe(5000);
      expect(defaultMaxTotalContentBytes).toBe(100 * 1024 * 1024);
    });

    it("does not throw when file count is exactly at the injected cap", async () => {
      await writeFlatMarkdownFiles(fixtureRoot, 2, 10);

      const ref: SourceRef = {
        type: "path",
        path: fixtureRoot,
        kind: "folder",
      };

      await expect(
        resolveSource(ref, { includeLarge: false, maxFiles: 2 }),
      ).resolves.toHaveLength(2);
    });

    it("throws SourceTooLargeError naming the file cap when one over", async () => {
      await writeFlatMarkdownFiles(fixtureRoot, 3, 10);

      const ref: SourceRef = {
        type: "path",
        path: fixtureRoot,
        kind: "folder",
      };

      await expect(
        resolveSource(ref, { includeLarge: false, maxFiles: 2 }),
      ).rejects.toThrow(/file cap/);
    });

    it("does not throw when total content bytes are exactly at the injected cap", async () => {
      await writeFile(join(fixtureRoot, "exact.md"), "a".repeat(10));

      const ref: SourceRef = {
        type: "path",
        path: fixtureRoot,
        kind: "folder",
      };

      await expect(
        resolveSource(ref, { includeLarge: false, maxBytes: 10 }),
      ).resolves.toHaveLength(1);
    });

    it("throws SourceTooLargeError naming the byte cap when one over", async () => {
      await writeFile(join(fixtureRoot, "over.md"), "a".repeat(11));

      const ref: SourceRef = {
        type: "path",
        path: fixtureRoot,
        kind: "folder",
      };

      await expect(
        resolveSource(ref, { includeLarge: false, maxBytes: 10 }),
      ).rejects.toThrow(/byte/);
    });
  });
});
