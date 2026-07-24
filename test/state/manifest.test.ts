import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SLICER_VERSION,
  writeDasJson,
  type DasJson,
} from "../../src/emitter/das-json.js";
import {
  UnmanagedPathError,
  assertManagedPath,
  expectedSkillPath,
  loadManifest,
  rebuildManifest,
  saveManifest,
  type Manifest,
} from "../../src/state/manifest.js";

function validDasJson(name: string): DasJson {
  return {
    dasVersion: "1.0.0",
    slicerVersion: SLICER_VERSION,
    name,
    source: {
      type: "github",
      url: "https://github.com/acme/widget-docs.git",
      subpath: null,
    },
    trackedRef: "main",
    pinnedSha: "a".repeat(40),
    sourceHash: `sha256:${"b".repeat(64)}`,
    tokenBudget: 4000,
    includeLarge: false,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-22T12:00:00Z",
    generatedFiles: ["SKILL.md"],
  };
}

function validManifest(): Manifest {
  return {
    version: 1,
    skills: [
      {
        name: "widget-docs",
        skillPath: "/home/user/.claude/skills/widget-docs",
        scope: "personal",
        lastCheck: "2026-07-22T12:00:00Z",
        updateAvailable: false,
      },
    ],
  };
}

describe("loadManifest", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "das-manifest-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("round-trips a valid manifest written directly to disk", async () => {
    const manifest = validManifest();
    await writeFile(
      join(baseDir, "manifest.json"),
      JSON.stringify(manifest),
      "utf-8",
    );

    const result = await loadManifest(baseDir);

    expect(result).toEqual(manifest);
  });

  it("returns an empty manifest when manifest.json is missing, without throwing", async () => {
    const result = await loadManifest(baseDir);

    expect(result).toEqual({ version: 1, skills: [] });
  });

  it("backs up and returns an empty manifest when manifest.json is corrupt JSON", async () => {
    await writeFile(join(baseDir, "manifest.json"), "not json{", "utf-8");

    const result = await loadManifest(baseDir);

    expect(result).toEqual({ version: 1, skills: [] });
    const backup = await readFile(join(baseDir, "manifest.json.bak"), "utf-8");
    expect(backup).toBe("not json{");
  });

  it("backs up and returns an empty manifest when manifest.json fails schema validation", async () => {
    await writeFile(
      join(baseDir, "manifest.json"),
      JSON.stringify({ version: 1, skills: [{ name: "Bad Name!" }] }),
      "utf-8",
    );

    const result = await loadManifest(baseDir);

    expect(result).toEqual({ version: 1, skills: [] });
    const backup = await readFile(join(baseDir, "manifest.json.bak"), "utf-8");
    expect(JSON.parse(backup)).toEqual({
      version: 1,
      skills: [{ name: "Bad Name!" }],
    });
  });

  it("overwrites a prior manifest.json.bak on repeated corruption", async () => {
    await writeFile(
      join(baseDir, "manifest.json.bak"),
      "stale backup",
      "utf-8",
    );
    await writeFile(join(baseDir, "manifest.json"), "not json{", "utf-8");

    await loadManifest(baseDir);

    const backup = await readFile(join(baseDir, "manifest.json.bak"), "utf-8");
    expect(backup).toBe("not json{");
  });
});

describe("saveManifest", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "das-manifest-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("writes atomically and round-trips through loadManifest", async () => {
    const manifest = validManifest();

    await saveManifest(baseDir, manifest);
    const result = await loadManifest(baseDir);

    expect(result).toEqual(manifest);
  });

  it("rejects an invalid manifest and does not write a file", async () => {
    const invalid = {
      version: 1,
      skills: [{ name: "ok", extraField: "nope" }],
    } as unknown as Manifest;

    await expect(saveManifest(baseDir, invalid)).rejects.toThrow();
    const result = await loadManifest(baseDir);
    expect(result).toEqual({ version: 1, skills: [] });
  });

  it("does not write when the lock is already held", async () => {
    const manifestPath = join(baseDir, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({ version: 1, skills: [] }),
      "utf-8",
    );
    await writeFile(
      `${manifestPath}.lock`,
      JSON.stringify({ pid: 999_999, timestamp: Date.now() }),
      "utf-8",
    );

    await saveManifest(baseDir, validManifest());

    const result = await loadManifest(baseDir);
    expect(result).toEqual({ version: 1, skills: [] });
  });

  it("creates a not-yet-existing baseDir before writing", async () => {
    const freshBaseDir = join(baseDir, ".claude", "das");
    const manifest = validManifest();

    await saveManifest(freshBaseDir, manifest);
    const result = await loadManifest(freshBaseDir);

    expect(result).toEqual(manifest);
  });
});

describe("expectedSkillPath", () => {
  it("builds a personal-scope path under home", () => {
    const result = expectedSkillPath("personal", "widget-docs", {
      home: "/home/user",
    });

    expect(result).toBe("/home/user/.claude/skills/widget-docs");
  });

  it("builds a project-scope path under projectRoot", () => {
    const result = expectedSkillPath("project", "widget-docs", {
      home: "/home/user",
      projectRoot: "/repo",
    });

    expect(result).toBe("/repo/.claude/skills/widget-docs");
  });

  it("throws when project scope is requested without a projectRoot", () => {
    expect(() =>
      expectedSkillPath("project", "widget-docs", { home: "/home/user" }),
    ).toThrow();
  });
});

describe("assertManagedPath", () => {
  let home: string;
  let projectRoot: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "das-manifest-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "das-manifest-project-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("accepts a personal skill path under home", () => {
    const skillPath = join(home, ".claude", "skills", "widget-docs");

    expect(() => {
      assertManagedPath(skillPath, { home });
    }).not.toThrow();
  });

  it("accepts a project skill path under projectRoot", () => {
    const skillPath = join(projectRoot, ".claude", "skills", "widget-docs");

    expect(() => {
      assertManagedPath(skillPath, { home, projectRoot });
    }).not.toThrow();
  });

  it("rejects a path outside .claude/skills entirely", () => {
    const skillPath = join(home, "Documents", "widget-docs");

    expect(() => {
      assertManagedPath(skillPath, { home });
    }).toThrow(UnmanagedPathError);
  });

  it("rejects a sibling directory that merely shares the skills prefix", () => {
    const skillPath = join(home, ".claude", "skills-evil", "widget-docs");

    expect(() => {
      assertManagedPath(skillPath, { home });
    }).toThrow(UnmanagedPathError);
  });

  it("rejects a path that escapes the skills directory via ..", () => {
    const skillPath = join(
      home,
      ".claude",
      "skills",
      "widget-docs",
      "..",
      "..",
      "..",
      "etc",
    );

    expect(() => {
      assertManagedPath(skillPath, { home });
    }).toThrow(UnmanagedPathError);
  });

  it("uses a separator boundary so a longer sibling name does not pass", () => {
    const skillsRootParent = join(home, ".claude");
    const skillPath = join(skillsRootParent, "skillsX", "widget-docs");

    expect(() => {
      assertManagedPath(skillPath, { home });
    }).toThrow(UnmanagedPathError);
  });
});

describe("rebuildManifest", () => {
  let home: string;
  let projectRoot: string;
  let personalSkillsDir: string;
  let projectSkillsDir: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "das-manifest-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "das-manifest-project-"));
    personalSkillsDir = join(home, ".claude", "skills");
    projectSkillsDir = join(projectRoot, ".claude", "skills");
    await mkdir(personalSkillsDir, { recursive: true });
    await mkdir(projectSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("finds skill dirs with a valid das.json and skips dirs without one", async () => {
    const goodSkillDir = join(personalSkillsDir, "widget-docs");
    await mkdir(goodSkillDir, { recursive: true });
    await writeDasJson(goodSkillDir, validDasJson("widget-docs"));

    const badSkillDir = join(personalSkillsDir, "not-a-skill");
    await mkdir(badSkillDir, { recursive: true });
    await writeFile(join(badSkillDir, "readme.txt"), "hello", "utf-8");

    const result = await rebuildManifest([personalSkillsDir], { home });

    expect(result.skills).toEqual([
      {
        name: "widget-docs",
        skillPath: goodSkillDir,
        scope: "personal",
        lastCheck: null,
        updateAvailable: false,
      },
    ]);
  });

  it("infers project scope for a project skills directory", async () => {
    const skillDir = join(projectSkillsDir, "widget-docs");
    await mkdir(skillDir, { recursive: true });
    await writeDasJson(skillDir, validDasJson("widget-docs"));

    const result = await rebuildManifest([projectSkillsDir], {
      home,
      projectRoot,
    });

    expect(result.skills).toEqual([
      {
        name: "widget-docs",
        skillPath: skillDir,
        scope: "project",
        lastCheck: null,
        updateAvailable: false,
      },
    ]);
  });

  it("combines entries across both a personal and a project skills directory", async () => {
    const personalSkillDir = join(personalSkillsDir, "alpha");
    await mkdir(personalSkillDir, { recursive: true });
    await writeDasJson(personalSkillDir, validDasJson("alpha"));

    const projectSkillDir = join(projectSkillsDir, "beta");
    await mkdir(projectSkillDir, { recursive: true });
    await writeDasJson(projectSkillDir, validDasJson("beta"));

    const result = await rebuildManifest(
      [personalSkillsDir, projectSkillsDir],
      { home, projectRoot },
    );

    expect(result.skills).toHaveLength(2);
    expect(result.skills.map((entry) => entry.name).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });
});
