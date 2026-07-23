import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedSourceError } from "../../src/resolver/github-url.js";
import type { GitRunner } from "../../src/resolver/git.js";
import {
  resolveSource,
  SourceTooLargeError,
} from "../../src/resolver/resolve.js";
import type { SourceRef } from "../../src/types.js";

const repoUrl = "https://github.com/octocat/hello-world.git";
const pinnedSha = "1111111111111111111111111111111111111111";
const headSha = "2222222222222222222222222222222222222222";
const maxFileCount = 5000;
const maxTotalContentBytes = 100 * 1024 * 1024;

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

    it("throws SourceTooLargeError when the cloned fileset exceeds the file-count cap", async () => {
      const { runner } = createMockGitRunner({
        populateClone: async (destinationPath) => {
          const fileCount = maxFileCount + 1;
          const writes: Promise<void>[] = [];

          for (let index = 0; index < fileCount; index += 1) {
            const fileName = `file-${String(index).padStart(5, "0")}.md`;
            writes.push(
              writeFile(
                join(destinationPath, fileName),
                `Body ${String(index)}`,
              ),
            );
          }

          await Promise.all(writes);
        },
      });

      const ref: SourceRef = { type: "github", url: repoUrl, subpath: null };

      await expect(
        resolveSource(ref, {
          includeLarge: false,
          pinnedSha,
          gitRunner: runner,
        }),
      ).rejects.toThrow(SourceTooLargeError);
    });

    it("throws SourceTooLargeError when the cloned fileset exceeds the content byte cap", async () => {
      const { runner } = createMockGitRunner({
        populateClone: (destinationPath) =>
          writeFile(
            join(destinationPath, "big.md"),
            "a".repeat(maxTotalContentBytes + 1),
          ),
      });

      const ref: SourceRef = { type: "github", url: repoUrl, subpath: null };

      await expect(
        resolveSource(ref, {
          includeLarge: true,
          pinnedSha,
          gitRunner: runner,
        }),
      ).rejects.toThrow(SourceTooLargeError);
    });

    it("throws UnsupportedSourceError when the subpath escapes the clone root", async () => {
      const { runner } = createMockGitRunner();

      const ref: SourceRef = {
        type: "github",
        url: repoUrl,
        subpath: "../../etc",
      };

      await expect(
        resolveSource(ref, {
          includeLarge: false,
          pinnedSha,
          gitRunner: runner,
        }),
      ).rejects.toThrow(UnsupportedSourceError);
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
});
