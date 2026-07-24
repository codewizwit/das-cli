import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SLICER_VERSION,
  readDasJson,
  type DasJson,
} from "../../src/emitter/das-json.js";
import {
  assertManagedPath,
  loadManifest,
  saveManifest,
  type Manifest,
} from "../../src/state/manifest.js";
import {
  runRemoveCommand,
  type RunRemoveCommandDeps,
} from "../../src/cli/remove.js";

function validDasJson(overrides: Partial<DasJson> = {}): DasJson {
  return {
    dasVersion: "1.0.0",
    slicerVersion: SLICER_VERSION,
    name: "widget-docs",
    source: {
      type: "path",
      path: "/docs/widget",
      kind: "folder",
    },
    trackedRef: null,
    pinnedSha: null,
    sourceHash: `sha256:${"b".repeat(64)}`,
    tokenBudget: 4000,
    includeLarge: false,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-24T00:00:00.000Z",
    generatedFiles: ["SKILL.md", "das.json"],
    ...overrides,
  };
}

describe("runRemoveCommand", () => {
  let home: string;
  let skillsDir: string;
  let skillDir: string;
  let manifestBaseDir: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "das-remove-home-"));
    skillsDir = join(home, ".claude", "skills");
    skillDir = join(skillsDir, "widget-docs");
    manifestBaseDir = await mkdtemp(join(tmpdir(), "das-remove-manifest-"));
    await mkdir(skillDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(manifestBaseDir, { recursive: true, force: true });
  });

  async function writeSkillFiles(
    files: Record<string, string>,
    dasJsonOverrides: Partial<DasJson> = {},
  ): Promise<void> {
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(skillDir, relativePath);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    const dasJson = validDasJson(dasJsonOverrides);
    await writeFile(
      join(skillDir, "das.json"),
      JSON.stringify(dasJson, null, 2),
      "utf-8",
    );
  }

  async function seedManifest(): Promise<void> {
    const manifest: Manifest = {
      version: 1,
      skills: [
        {
          name: "widget-docs",
          skillPath: skillDir,
          scope: "personal",
          lastCheck: null,
          updateAvailable: false,
        },
      ],
    };
    await saveManifest(manifestBaseDir, manifest);
  }

  function createDeps(overrides: Partial<RunRemoveCommandDeps> = {}): {
    deps: RunRemoveCommandDeps;
    stdoutLines: string[];
    stderrLines: string[];
  } {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const deps: RunRemoveCommandDeps = {
      loadManifest,
      saveManifest,
      assertManagedPath,
      readDasJson,
      home,
      manifestBaseDir,
      stdout: (line) => stdoutLines.push(line),
      stderr: (line) => stderrLines.push(line),
      ...overrides,
    };

    return { deps, stdoutLines, stderrLines };
  }

  it("deletes only the tracked generatedFiles and removes the manifest entry", async () => {
    await writeSkillFiles({ "SKILL.md": "# Widget docs\n" });
    await seedManifest();
    const { deps } = createDeps();

    const outcome = await runRemoveCommand({ name: "widget-docs" }, deps);

    expect(outcome).toEqual({
      status: "removed",
      name: "widget-docs",
      scope: "personal",
      filesDeleted: 2,
    });

    await expect(readFile(join(skillDir, "SKILL.md"))).rejects.toThrow();

    const manifest = await loadManifest(manifestBaseDir);
    expect(manifest.skills).toHaveLength(0);
  });

  it("refuses when a foreign file is present, and leaves it untouched", async () => {
    await writeSkillFiles({ "SKILL.md": "# Widget docs\n" });
    await writeFile(join(skillDir, "notes.md"), "personal notes", "utf-8");
    await seedManifest();
    const { deps, stderrLines } = createDeps();

    const outcome = await runRemoveCommand({ name: "widget-docs" }, deps);

    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toContain("notes.md");
    }
    expect(stderrLines.length).toBeGreaterThan(0);

    await expect(readFile(join(skillDir, "notes.md"), "utf-8")).resolves.toBe(
      "personal notes",
    );
    await expect(readFile(join(skillDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Widget docs\n",
    );

    const manifest = await loadManifest(manifestBaseDir);
    expect(manifest.skills).toHaveLength(1);
  });

  it("proceeds with --force, deleting tracked files but leaving the foreign file", async () => {
    await writeSkillFiles({ "SKILL.md": "# Widget docs\n" });
    await writeFile(join(skillDir, "notes.md"), "personal notes", "utf-8");
    await seedManifest();
    const { deps } = createDeps();

    const outcome = await runRemoveCommand(
      { name: "widget-docs", force: true },
      deps,
    );

    expect(outcome).toEqual({
      status: "removed",
      name: "widget-docs",
      scope: "personal",
      filesDeleted: 2,
    });

    await expect(readFile(join(skillDir, "SKILL.md"))).rejects.toThrow();
    await expect(readFile(join(skillDir, "notes.md"), "utf-8")).resolves.toBe(
      "personal notes",
    );

    const manifest = await loadManifest(manifestBaseDir);
    expect(manifest.skills).toHaveLength(0);
  });

  it("refuses when the skill directory itself is a symlink", async () => {
    const realDir = await mkdtemp(join(tmpdir(), "das-remove-real-"));
    await writeFile(join(realDir, "SKILL.md"), "# Widget docs\n", "utf-8");
    await writeFile(
      join(realDir, "das.json"),
      JSON.stringify(validDasJson(), null, 2),
      "utf-8",
    );
    await rm(skillDir, { recursive: true, force: true });
    await symlink(realDir, skillDir, "dir");
    await seedManifest();
    const { deps, stderrLines } = createDeps();

    const outcome = await runRemoveCommand({ name: "widget-docs" }, deps);

    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toContain("symlink");
    }
    expect(stderrLines.length).toBeGreaterThan(0);

    await expect(readFile(join(realDir, "SKILL.md"))).resolves.toBeDefined();
    await rm(realDir, { recursive: true, force: true });
  });

  it("refuses when a tracked target inside the skill directory is a symlink", async () => {
    const externalFile = await mkdtemp(join(tmpdir(), "das-remove-ext-"));
    const externalTarget = join(externalFile, "secret.txt");
    await writeFile(externalTarget, "sensitive", "utf-8");

    await writeSkillFiles({ "SKILL.md": "# Widget docs\n" });
    await symlink(externalTarget, join(skillDir, "linked.md"), "file");
    await seedManifest();
    const { deps, stderrLines } = createDeps();

    const outcome = await runRemoveCommand({ name: "widget-docs" }, deps);

    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toContain("symlink");
    }
    expect(stderrLines.length).toBeGreaterThan(0);
    await expect(readFile(externalTarget, "utf-8")).resolves.toBe("sensitive");

    await rm(externalFile, { recursive: true, force: true });
  });

  it("refuses when the target has no valid das.json", async () => {
    await writeFile(join(skillDir, "SKILL.md"), "# Widget docs\n", "utf-8");
    await seedManifest();
    const { deps, stderrLines } = createDeps();

    const outcome = await runRemoveCommand({ name: "widget-docs" }, deps);

    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toContain("das.json");
    }
    expect(stderrLines.length).toBeGreaterThan(0);
  });

  it("enforces assertManagedPath before touching the filesystem", async () => {
    const manifest: Manifest = {
      version: 1,
      skills: [
        {
          name: "widget-docs",
          skillPath: join(home, "somewhere-else", "widget-docs"),
          scope: "personal",
          lastCheck: null,
          updateAvailable: false,
        },
      ],
    };
    await saveManifest(manifestBaseDir, manifest);
    const { deps } = createDeps();

    await expect(
      runRemoveCommand({ name: "widget-docs" }, deps),
    ).rejects.toThrow(/Refusing to manage path/);
  });

  it("refuses an ambiguous name across scopes without --scope", async () => {
    await writeSkillFiles({ "SKILL.md": "# Widget docs\n" });
    const manifest: Manifest = {
      version: 1,
      skills: [
        {
          name: "widget-docs",
          skillPath: skillDir,
          scope: "personal",
          lastCheck: null,
          updateAvailable: false,
        },
        {
          name: "widget-docs",
          skillPath: join(home, "somewhere-else"),
          scope: "project",
          lastCheck: null,
          updateAvailable: false,
        },
      ],
    };
    await saveManifest(manifestBaseDir, manifest);
    const { deps, stderrLines } = createDeps();

    const outcome = await runRemoveCommand({ name: "widget-docs" }, deps);

    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toContain("--scope");
    }
    expect(stderrLines.length).toBeGreaterThan(0);
  });

  it("refuses when no manifest entry matches the name", async () => {
    await seedManifest();
    const { deps, stderrLines } = createDeps();

    const outcome = await runRemoveCommand({ name: "does-not-exist" }, deps);

    expect(outcome.status).toBe("refused");
    expect(stderrLines.length).toBeGreaterThan(0);
  });

  it("removes now-empty subdirectories left after deletion", async () => {
    await writeSkillFiles({ "reference/api.md": "# API\n" });
    await seedManifest();
    const dasJson = validDasJson({
      generatedFiles: ["reference/api.md", "das.json"],
    });
    await writeFile(
      join(skillDir, "das.json"),
      JSON.stringify(dasJson, null, 2),
      "utf-8",
    );
    const { deps } = createDeps();

    const outcome = await runRemoveCommand({ name: "widget-docs" }, deps);

    expect(outcome.status).toBe("removed");
    await expect(lstat(skillDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
