import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SLICER_VERSION, type DasJson } from "../../src/emitter/das-json.js";
import {
  loadManifest,
  rebuildManifest,
  saveManifest,
  type Manifest,
} from "../../src/state/manifest.js";
import {
  runDoctorCommand,
  type RunDoctorCommandDeps,
} from "../../src/cli/doctor.js";

function dasJsonFor(name: string): DasJson {
  return {
    dasVersion: "1.0.0",
    slicerVersion: SLICER_VERSION,
    name,
    source: { type: "path", path: `/docs/${name}`, kind: "folder" },
    trackedRef: null,
    pinnedSha: null,
    sourceHash: `sha256:${"b".repeat(64)}`,
    tokenBudget: 4000,
    includeLarge: false,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-24T00:00:00.000Z",
    generatedFiles: ["SKILL.md", "das.json"],
  };
}

describe("runDoctorCommand", () => {
  let home: string;
  let skillsDir: string;
  let manifestBaseDir: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "das-doctor-home-"));
    skillsDir = join(home, ".claude", "skills");
    manifestBaseDir = await mkdtemp(join(tmpdir(), "das-doctor-manifest-"));
    await mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(manifestBaseDir, { recursive: true, force: true });
  });

  async function seedSkill(name: string): Promise<void> {
    const skillDir = join(skillsDir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Docs\n", "utf-8");
    await writeFile(
      join(skillDir, "das.json"),
      JSON.stringify(dasJsonFor(name), null, 2),
      "utf-8",
    );
  }

  function createDeps(overrides: Partial<RunDoctorCommandDeps> = {}): {
    deps: RunDoctorCommandDeps;
    stdoutLines: string[];
  } {
    const stdoutLines: string[] = [];

    const deps: RunDoctorCommandDeps = {
      loadManifest,
      rebuildManifest,
      saveManifest,
      home,
      manifestBaseDir,
      stdout: (line) => stdoutLines.push(line),
      ...overrides,
    };

    return { deps, stdoutLines };
  }

  it("rebuilds a manifest from a fixture skills dir and reports it as added", async () => {
    await seedSkill("widget-docs");
    const { deps, stdoutLines } = createDeps();

    const report = await runDoctorCommand(deps);

    expect(report.added).toEqual([{ name: "widget-docs", scope: "personal" }]);
    expect(report.removed).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(stdoutLines.some((line) => line.includes("added"))).toBe(true);

    const persisted = await loadManifest(manifestBaseDir);
    expect(persisted.skills).toHaveLength(1);
  });

  it("recreates a deleted manifest matching the fixture", async () => {
    await seedSkill("widget-docs");
    await seedSkill("other-docs");

    const { deps } = createDeps();
    await runDoctorCommand(deps);

    const rebuilt = await loadManifest(manifestBaseDir);
    expect(rebuilt.skills.map((entry) => entry.name).sort()).toEqual([
      "other-docs",
      "widget-docs",
    ]);
  });

  it("reports a removed skill no longer found on disk", async () => {
    await seedSkill("widget-docs");
    const manifest: Manifest = {
      version: 1,
      skills: [
        {
          name: "widget-docs",
          skillPath: join(skillsDir, "widget-docs"),
          scope: "personal",
          lastCheck: "2026-07-01T00:00:00.000Z",
          updateAvailable: false,
        },
        {
          name: "ghost-docs",
          skillPath: join(skillsDir, "ghost-docs"),
          scope: "personal",
          lastCheck: "2026-07-01T00:00:00.000Z",
          updateAvailable: false,
        },
      ],
    };
    await saveManifest(manifestBaseDir, manifest);

    const { deps, stdoutLines } = createDeps();
    const report = await runDoctorCommand(deps);

    expect(report.removed).toEqual([{ name: "ghost-docs", scope: "personal" }]);
    expect(stdoutLines.some((line) => line.includes("removed"))).toBe(true);
  });

  it("reports an updated skill whose path changed", async () => {
    await seedSkill("widget-docs");
    const manifest: Manifest = {
      version: 1,
      skills: [
        {
          name: "widget-docs",
          skillPath: join(skillsDir, "stale-path"),
          scope: "personal",
          lastCheck: "2026-07-01T00:00:00.000Z",
          updateAvailable: false,
        },
      ],
    };
    await saveManifest(manifestBaseDir, manifest);

    const { deps, stdoutLines } = createDeps();
    const report = await runDoctorCommand(deps);

    expect(report.updated).toEqual([
      { name: "widget-docs", scope: "personal" },
    ]);
    expect(stdoutLines.some((line) => line.includes("updated"))).toBe(true);
  });

  it("reports the manifest as already up to date when nothing changed", async () => {
    await seedSkill("widget-docs");
    const { deps } = createDeps();
    await runDoctorCommand(deps);

    const { deps: secondRunDeps, stdoutLines } = createDeps();
    const report = await runDoctorCommand(secondRunDeps);

    expect(report).toEqual({ added: [], removed: [], updated: [] });
    expect(
      stdoutLines.some((line) => line.includes("already up to date")),
    ).toBe(true);
  });

  it("scans the project skills dir too when projectRoot is set", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "das-doctor-project-"));
    const projectSkillsDir = join(projectRoot, ".claude", "skills");
    await mkdir(projectSkillsDir, { recursive: true });
    const projectSkillDir = join(projectSkillsDir, "project-docs");
    await mkdir(projectSkillDir, { recursive: true });
    await writeFile(join(projectSkillDir, "SKILL.md"), "# Docs\n", "utf-8");
    await writeFile(
      join(projectSkillDir, "das.json"),
      JSON.stringify(dasJsonFor("project-docs"), null, 2),
      "utf-8",
    );

    const { deps } = createDeps({ projectRoot });
    const report = await runDoctorCommand(deps);

    expect(report.added).toContainEqual({
      name: "project-docs",
      scope: "project",
    });

    await rm(projectRoot, { recursive: true, force: true });
  });
});
