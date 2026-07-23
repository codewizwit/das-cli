import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLICER_VERSION, type DasJson } from "../../src/emitter/das-json.js";
import type { EmitFile } from "../../src/types.js";
import type * as FsPromises from "node:fs/promises";

const { renameFailureFlag } = vi.hoisted(() => ({
  renameFailureFlag: { armed: false },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: vi.fn(
      async (
        source: Parameters<typeof actual.rename>[0],
        destination: Parameters<typeof actual.rename>[1],
      ) => {
        if (renameFailureFlag.armed) {
          renameFailureFlag.armed = false;
          throw new Error("simulated rename failure");
        }
        return actual.rename(source, destination);
      },
    ),
  };
});

const { writeSkillTransactional, PathEscapeError, UnownedTargetError } =
  await import("../../src/emitter/write.js");

function validDasJson(): DasJson {
  return {
    dasVersion: "1.0.0",
    slicerVersion: SLICER_VERSION,
    name: "widget-docs",
    source: {
      type: "github",
      url: "https://github.com/acme/widget-docs.git",
      subpath: null,
    },
    trackedRef: "main",
    pinnedSha: "a".repeat(40),
    sourceHash: `sha256:${"b".repeat(64)}`,
    tokenBudget: 4000,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-22T12:00:00Z",
    generatedFiles: ["SKILL.md", "reference/topic.md"],
  };
}

function dasJsonFile(overrides: Partial<DasJson> = {}): EmitFile {
  return {
    relativePath: "das.json",
    content: JSON.stringify({ ...validDasJson(), ...overrides }, null, 2),
  };
}

describe("writeSkillTransactional", () => {
  let parentDir: string;
  let skillDir: string;

  beforeEach(async () => {
    parentDir = await mkdtemp(join(tmpdir(), "das-write-test-"));
    skillDir = join(parentDir, "skill");
  });

  afterEach(async () => {
    renameFailureFlag.armed = false;
    await rm(parentDir, { recursive: true, force: true });
  });

  it("creates the full tree when skillDir does not exist", async () => {
    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "SKILL.md", content: "# Widget Docs\n" },
      { relativePath: "reference/topic.md", content: "topic body\n" },
    ];

    await writeSkillTransactional(skillDir, files);

    await expect(readFile(join(skillDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Widget Docs\n",
    );
    await expect(
      readFile(join(skillDir, "reference/topic.md"), "utf-8"),
    ).resolves.toBe("topic body\n");
    await expect(readFile(join(skillDir, "das.json"), "utf-8")).resolves.toBe(
      files[0]!.content,
    );
  });

  it("replaces an existing owned tree wholesale, removing stale files", async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "das.json"), dasJsonFile().content, "utf-8");
    await writeFile(join(skillDir, "stale.md"), "old content\n", "utf-8");

    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "SKILL.md", content: "# New Content\n" },
    ];

    await writeSkillTransactional(skillDir, files);

    await expect(readFile(join(skillDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# New Content\n",
    );
    await expect(
      readFile(join(skillDir, "stale.md"), "utf-8"),
    ).rejects.toThrow();
  });

  it("throws UnownedTargetError and leaves an unowned target untouched", async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "notes.md"), "hand-written\n", "utf-8");

    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "SKILL.md", content: "x" },
    ];

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow(
      UnownedTargetError,
    );
    await expect(readFile(join(skillDir, "notes.md"), "utf-8")).resolves.toBe(
      "hand-written\n",
    );
    await expect(
      readFile(join(skillDir, "SKILL.md"), "utf-8"),
    ).rejects.toThrow();
  });

  it("throws UnownedTargetError when the existing das.json is invalid", async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "das.json"), "not json{", "utf-8");

    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "SKILL.md", content: "x" },
    ];

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow(
      UnownedTargetError,
    );
    await expect(readFile(join(skillDir, "das.json"), "utf-8")).resolves.toBe(
      "not json{",
    );
  });

  it("throws PathEscapeError for a relative path that escapes skillDir and writes nothing", async () => {
    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "../escape.md", content: "evil" },
    ];

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow(
      PathEscapeError,
    );
    await expect(readdir(parentDir)).resolves.toEqual([]);
  });

  it("throws PathEscapeError for an absolute relative path and writes nothing", async () => {
    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "/etc/evil.md", content: "evil" },
    ];

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow(
      PathEscapeError,
    );
    await expect(readdir(parentDir)).resolves.toEqual([]);
  });

  it("throws when skillDir is itself a symlink and never writes through it", async () => {
    const realDir = join(parentDir, "real-target");
    await mkdir(realDir, { recursive: true });
    await writeFile(join(realDir, "original.md"), "untouched\n", "utf-8");
    await symlink(realDir, skillDir);

    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "SKILL.md", content: "x" },
    ];

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow(
      UnownedTargetError,
    );
    await expect(readFile(join(realDir, "original.md"), "utf-8")).resolves.toBe(
      "untouched\n",
    );
  });

  it("leaves a fresh target untouched and removes the temp dir when building the tree fails", async () => {
    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "a", content: "file, not a dir" },
      { relativePath: "a/b.md", content: "cannot nest under a file" },
    ];

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow();
    await expect(readdir(parentDir)).resolves.toEqual([]);
  });

  it("leaves an existing owned tree untouched and removes the temp dir when building the tree fails", async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "das.json"), dasJsonFile().content, "utf-8");
    await writeFile(join(skillDir, "SKILL.md"), "original\n", "utf-8");

    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "a", content: "file, not a dir" },
      { relativePath: "a/b.md", content: "cannot nest under a file" },
    ];

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow();
    await expect(readFile(join(skillDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "original\n",
    );
    await expect(readdir(parentDir)).resolves.toEqual(["skill"]);
  });

  it("restores the previous tree when the atomic rename swap fails", async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "das.json"), dasJsonFile().content, "utf-8");
    await writeFile(join(skillDir, "SKILL.md"), "original\n", "utf-8");

    const files: EmitFile[] = [
      dasJsonFile(),
      { relativePath: "SKILL.md", content: "new content\n" },
    ];

    renameFailureFlag.armed = true;

    await expect(writeSkillTransactional(skillDir, files)).rejects.toThrow(
      "simulated rename failure",
    );

    await expect(readFile(join(skillDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "original\n",
    );
    await expect(readdir(parentDir)).resolves.toEqual(["skill"]);
  });
});
