import { describe, expect, it, vi } from "vitest";
import { SLICER_VERSION, type DasJson } from "../../src/emitter/das-json.js";
import type { RenderContext } from "../../src/emitter/render.js";
import type { EmissionPlan } from "../../src/slicer/emit-plan.js";
import type { ManifestEntry } from "../../src/state/manifest.js";
import {
  refreshSkill,
  runHookRefresh,
  type RefreshDeps,
} from "../../src/refresh/refresh.js";
import type { DocFile, DocNode, EmitFile } from "../../src/types.js";

const FIXED_NOW_MS = Date.parse("2026-07-24T12:00:00.000Z");

function localDasJson(overrides: Partial<DasJson> = {}): DasJson {
  return {
    dasVersion: "1.0.0",
    slicerVersion: SLICER_VERSION,
    name: "widget-docs",
    source: { type: "path", path: "/repo/docs", kind: "folder" },
    trackedRef: null,
    pinnedSha: null,
    sourceHash: `sha256:${"a".repeat(64)}`,
    tokenBudget: 4000,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-20T12:00:00.000Z",
    generatedFiles: ["SKILL.md"],
    ...overrides,
  };
}

function remoteDasJson(overrides: Partial<DasJson> = {}): DasJson {
  return {
    dasVersion: "1.0.0",
    slicerVersion: SLICER_VERSION,
    name: "prisma-docs",
    source: {
      type: "github",
      url: "https://github.com/acme/prisma-docs.git",
      subpath: null,
    },
    trackedRef: "main",
    pinnedSha: "a".repeat(40),
    sourceHash: `sha256:${"b".repeat(64)}`,
    tokenBudget: 4000,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-20T12:00:00.000Z",
    generatedFiles: ["SKILL.md"],
    ...overrides,
  };
}

function manifestEntryFor(dasJson: DasJson, skillPath: string): ManifestEntry {
  return {
    name: dasJson.name,
    skillPath,
    scope: "personal",
    lastCheck: null,
    updateAvailable: false,
  };
}

const docFile: DocFile = {
  relativePath: "intro.md",
  content: "# Intro\n\nHello.",
  frontmatter: {},
};

const emitFile: EmitFile = { relativePath: "SKILL.md", content: "content" };

const fakeNode: DocNode = {
  name: "root",
  body: "",
  children: [],
  subtreeTokens: 0,
};
const fakePlan: EmissionPlan = {
  files: [],
  oversized: [],
  oversizedIndexes: [],
};

interface FakeDepsOptions {
  storedFilesHash?: string;
  dasJsonByPath?: Map<string, DasJson>;
  resolvedFiles?: DocFile[];
  lsRemoteResult?: string | Error;
  resolveSourceError?: Error;
}

function createFakeDeps(options: FakeDepsOptions = {}): {
  deps: RefreshDeps;
  spies: {
    resolveSource: ReturnType<typeof vi.fn>;
    lsRemote: ReturnType<typeof vi.fn>;
    writeSkillTransactional: ReturnType<typeof vi.fn>;
    writeDasJson: ReturnType<typeof vi.fn>;
    hashFileset: ReturnType<typeof vi.fn>;
  };
  writtenDasJson: Map<string, DasJson>;
} {
  const dasJsonByPath = options.dasJsonByPath ?? new Map<string, DasJson>();
  const writtenDasJson = new Map<string, DasJson>();
  const resolvedFiles = options.resolvedFiles ?? [docFile];

  const resolveSource = vi.fn(async () => {
    if (options.resolveSourceError) {
      throw options.resolveSourceError;
    }
    return Promise.resolve(resolvedFiles);
  });

  const lsRemote = vi.fn(async () => {
    if (options.lsRemoteResult instanceof Error) {
      throw options.lsRemoteResult;
    }
    return Promise.resolve(options.lsRemoteResult ?? "a".repeat(40));
  });

  const buildTree = vi.fn(() => fakeNode);
  const sizeTree = vi.fn(() => fakeNode);
  const planEmission = vi.fn(() => fakePlan);
  const renderSkillPlan = vi.fn(
    (_plan: EmissionPlan, _context: RenderContext) => [emitFile],
  );
  const writeSkillTransactional = vi.fn(async () => Promise.resolve());

  const readDasJson = vi.fn((skillPath: string) => {
    const found = dasJsonByPath.get(skillPath);
    if (!found) {
      throw new Error(`no fake das.json for ${skillPath}`);
    }
    return Promise.resolve(found);
  });

  const writeDasJson = vi.fn((skillPath: string, data: DasJson) => {
    writtenDasJson.set(skillPath, data);
    return Promise.resolve();
  });

  const hashFileset = vi.fn(
    () => options.storedFilesHash ?? "sha256:unchanged",
  );

  const now = () => FIXED_NOW_MS;

  const deps: RefreshDeps = {
    resolveSource,
    lsRemote,
    buildTree,
    sizeTree,
    planEmission,
    renderSkillPlan,
    writeSkillTransactional,
    readDasJson,
    writeDasJson,
    hashFileset,
    now,
  };

  return {
    deps,
    spies: {
      resolveSource,
      lsRemote,
      writeSkillTransactional,
      writeDasJson,
      hashFileset,
    },
    writtenDasJson,
  };
}

describe("refreshSkill — local source", () => {
  it("reports unchanged and writes nothing when the hash matches", async () => {
    const dasJson = localDasJson();
    const skillPath = "/home/user/.claude/skills/widget-docs";
    const { deps, spies } = createFakeDeps({
      storedFilesHash: dasJson.sourceHash,
      dasJsonByPath: new Map([[skillPath, dasJson]]),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive" },
      deps,
    );

    expect(outcome).toEqual({ status: "unchanged" });
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
    expect(spies.writeDasJson).not.toHaveBeenCalled();
  });

  it("regenerates and writes an updated das.json when the hash differs", async () => {
    const dasJson = localDasJson();
    const skillPath = "/home/user/.claude/skills/widget-docs";
    const { deps, spies, writtenDasJson } = createFakeDeps({
      storedFilesHash:
        "sha256:different0000000000000000000000000000000000000000000000000000",
      dasJsonByPath: new Map([[skillPath, dasJson]]),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive" },
      deps,
    );

    expect(outcome).toEqual({ status: "regenerated" });
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    const written = writtenDasJson.get(skillPath);
    expect(written?.sourceHash).toBe(
      "sha256:different0000000000000000000000000000000000000000000000000000",
    );
    expect(written?.lastRefresh).toBe(new Date(FIXED_NOW_MS).toISOString());
  });

  it("regenerates when force is set even though the hash matches", async () => {
    const dasJson = localDasJson();
    const skillPath = "/home/user/.claude/skills/widget-docs";
    const { deps, spies } = createFakeDeps({
      storedFilesHash: dasJson.sourceHash,
      dasJsonByPath: new Map([[skillPath, dasJson]]),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive", force: true },
      deps,
    );

    expect(outcome).toEqual({ status: "regenerated" });
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
  });

  it("reports stale and writes nothing when the source cannot be resolved", async () => {
    const dasJson = localDasJson();
    const skillPath = "/home/user/.claude/skills/widget-docs";
    const { deps, spies } = createFakeDeps({
      dasJsonByPath: new Map([[skillPath, dasJson]]),
      resolveSourceError: new Error("ENOENT: no such file or directory"),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive" },
      deps,
    );

    expect(outcome).toEqual({ status: "stale" });
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
  });
});

describe("refreshSkill — remote source, hook mode", () => {
  it("skips without calling lsRemote when still within the check interval", async () => {
    const dasJson = remoteDasJson({
      lastRefresh: new Date(FIXED_NOW_MS - 60 * 60 * 1000).toISOString(),
      checkIntervalHours: 24,
    });
    const skillPath = "/home/user/.claude/skills/prisma-docs";
    const { deps, spies } = createFakeDeps({
      dasJsonByPath: new Map([[skillPath, dasJson]]),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "hook" },
      deps,
    );

    expect(outcome).toEqual({ status: "skipped" });
    expect(spies.lsRemote).not.toHaveBeenCalled();
  });

  it("checks ls-remote once past the interval and reports unchanged when the sha matches", async () => {
    const dasJson = remoteDasJson({
      lastRefresh: new Date(FIXED_NOW_MS - 48 * 60 * 60 * 1000).toISOString(),
      checkIntervalHours: 24,
      pinnedSha: "a".repeat(40),
    });
    const skillPath = "/home/user/.claude/skills/prisma-docs";
    const { deps, spies, writtenDasJson } = createFakeDeps({
      dasJsonByPath: new Map([[skillPath, dasJson]]),
      lsRemoteResult: "a".repeat(40),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "hook" },
      deps,
    );

    expect(outcome).toEqual({ status: "unchanged" });
    expect(spies.lsRemote).toHaveBeenCalledTimes(1);
    expect(spies.resolveSource).not.toHaveBeenCalled();
    expect(writtenDasJson.get(skillPath)?.lastRefresh).toBe(
      new Date(FIXED_NOW_MS).toISOString(),
    );
  });

  it("reports update-available with the exact command line when the sha has moved", async () => {
    const dasJson = remoteDasJson({
      lastRefresh: new Date(FIXED_NOW_MS - 48 * 60 * 60 * 1000).toISOString(),
      checkIntervalHours: 24,
      pinnedSha: "a".repeat(40),
    });
    const skillPath = "/home/user/.claude/skills/prisma-docs";
    const { deps, spies } = createFakeDeps({
      dasJsonByPath: new Map([[skillPath, dasJson]]),
      lsRemoteResult: "c".repeat(40),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "hook" },
      deps,
    );

    expect(outcome).toEqual({
      status: "update-available",
      detail:
        "das: prisma-docs has upstream updates; run 'das refresh prisma-docs --update'",
    });
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
  });

  it("reports stale when ls-remote fails", async () => {
    const dasJson = remoteDasJson({
      lastRefresh: new Date(FIXED_NOW_MS - 48 * 60 * 60 * 1000).toISOString(),
      checkIntervalHours: 24,
    });
    const skillPath = "/home/user/.claude/skills/prisma-docs";
    const { deps } = createFakeDeps({
      dasJsonByPath: new Map([[skillPath, dasJson]]),
      lsRemoteResult: new Error("network unreachable"),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "hook" },
      deps,
    );

    expect(outcome).toEqual({ status: "stale" });
  });
});

describe("refreshSkill — remote source, interactive --update", () => {
  it("resolves at the new sha, regenerates, and re-pins das.json", async () => {
    const dasJson = remoteDasJson({ pinnedSha: "a".repeat(40) });
    const skillPath = "/home/user/.claude/skills/prisma-docs";
    const { deps, spies, writtenDasJson } = createFakeDeps({
      dasJsonByPath: new Map([[skillPath, dasJson]]),
      lsRemoteResult: "c".repeat(40),
      storedFilesHash:
        "sha256:freshcontent00000000000000000000000000000000000000000000000",
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive", update: true },
      deps,
    );

    expect(outcome).toEqual({ status: "regenerated" });
    expect(spies.resolveSource).toHaveBeenCalledTimes(1);
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    const written = writtenDasJson.get(skillPath);
    expect(written?.pinnedSha).toBe("c".repeat(40));
    expect(written?.sourceHash).toBe(
      "sha256:freshcontent00000000000000000000000000000000000000000000000",
    );
  });
});

describe("runHookRefresh", () => {
  function localEntryAndDasJson(
    name: string,
    lastRefresh: string,
  ): { entry: ManifestEntry; dasJson: DasJson; skillPath: string } {
    const skillPath = `/home/user/.claude/skills/${name}`;
    const dasJson = localDasJson({ name, lastRefresh });
    return { entry: manifestEntryFor(dasJson, skillPath), dasJson, skillPath };
  }

  it("caps local regenerations at 3 per run, oldest lastRefresh first", async () => {
    const skills = [
      localEntryAndDasJson("skill-a", "2026-07-15T00:00:00.000Z"),
      localEntryAndDasJson("skill-b", "2026-07-10T00:00:00.000Z"),
      localEntryAndDasJson("skill-c", "2026-07-20T00:00:00.000Z"),
      localEntryAndDasJson("skill-d", "2026-07-05T00:00:00.000Z"),
      localEntryAndDasJson("skill-e", "2026-07-18T00:00:00.000Z"),
    ];
    const dasJsonByPath = new Map(
      skills.map(({ skillPath, dasJson }) => [skillPath, dasJson]),
    );
    const { deps, spies, writtenDasJson } = createFakeDeps({
      dasJsonByPath,
      storedFilesHash:
        "sha256:new-content-hash-0000000000000000000000000000000000000000",
    });

    const lines = await runHookRefresh(
      skills.map(({ entry }) => entry),
      "/home/user",
      deps,
    );

    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(3);
    expect([...writtenDasJson.keys()].sort()).toEqual(
      ["skill-b", "skill-d", "skill-a"]
        .map((name) => `/home/user/.claude/skills/${name}`)
        .sort(),
    );
    expect(lines).toHaveLength(3);
  });

  it("includes personal skills regardless of currentDirectory and excludes out-of-tree project skills", async () => {
    const personalSkillPath = "/home/user/.claude/skills/personal-skill";
    const projectSkillPath = "/elsewhere/project/.claude/skills/project-skill";
    const personalDasJson = localDasJson({
      name: "personal-skill",
      sourceHash:
        "sha256:matches0000000000000000000000000000000000000000000000000000",
    });
    const projectDasJson = localDasJson({
      name: "project-skill",
      sourceHash:
        "sha256:matches0000000000000000000000000000000000000000000000000000",
    });
    const entries: ManifestEntry[] = [
      manifestEntryFor(personalDasJson, personalSkillPath),
      {
        ...manifestEntryFor(projectDasJson, projectSkillPath),
        scope: "project",
      },
    ];
    const { deps, spies } = createFakeDeps({
      dasJsonByPath: new Map([
        [personalSkillPath, personalDasJson],
        [projectSkillPath, projectDasJson],
      ]),
      storedFilesHash:
        "sha256:matches0000000000000000000000000000000000000000000000000000",
    });

    await runHookRefresh(entries, "/home/user/project", deps);

    expect(spies.hashFileset).toHaveBeenCalledTimes(1);
    expect(deps.readDasJson).toHaveBeenCalledTimes(1);
    expect(deps.readDasJson).toHaveBeenCalledWith(personalSkillPath);
  });

  it("never throws when one skill errors, and still processes the others", async () => {
    const brokenSkillPath = "/home/user/.claude/skills/broken-skill";
    const workingDasJson = localDasJson({
      name: "working-skill",
      sourceHash:
        "sha256:matches0000000000000000000000000000000000000000000000000000",
    });
    const workingSkillPath = "/home/user/.claude/skills/working-skill";
    const entries: ManifestEntry[] = [
      manifestEntryFor(workingDasJson, workingSkillPath),
      {
        name: "broken-skill",
        skillPath: brokenSkillPath,
        scope: "personal",
        lastCheck: null,
        updateAvailable: false,
      },
    ];
    const { deps } = createFakeDeps({
      dasJsonByPath: new Map([[workingSkillPath, workingDasJson]]),
      storedFilesHash:
        "sha256:matches0000000000000000000000000000000000000000000000000000",
    });

    await expect(
      runHookRefresh(entries, "/home/user", deps),
    ).resolves.toBeInstanceOf(Array);
  });
});
