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
    includeLarge: false,
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
    includeLarge: false,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-20T12:00:00.000Z",
    generatedFiles: ["SKILL.md"],
    ...overrides,
  };
}

function dasJsonWrittenFor(
  writeSkillTransactionalSpy: ReturnType<typeof vi.fn>,
  skillPath: string,
): DasJson | undefined {
  const call = writeSkillTransactionalSpy.mock.calls.find(
    (call) => call[0] === skillPath,
  );
  const files = call?.[1] as EmitFile[] | undefined;
  const dasJsonFile = files?.find((file) => file.relativePath === "das.json");
  return dasJsonFile ? (JSON.parse(dasJsonFile.content) as DasJson) : undefined;
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
  hangOnSkillPath?: string;
  failWriteSkillTransactionalFor?: string;
  delay?: (ms: number) => Promise<void>;
}

function createFakeDeps(options: FakeDepsOptions = {}): {
  deps: RefreshDeps;
  spies: {
    resolveSource: ReturnType<typeof vi.fn>;
    lsRemote: ReturnType<typeof vi.fn>;
    writeSkillTransactional: ReturnType<typeof vi.fn>;
    writeDasJson: ReturnType<typeof vi.fn>;
    hashFileset: ReturnType<typeof vi.fn>;
    readDasJson: ReturnType<typeof vi.fn>;
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

  const buildSizedTree = vi.fn(() => fakeNode);
  const planEmission = vi.fn(() => fakePlan);
  const renderSkillPlan = vi.fn(
    (_plan: EmissionPlan, _context: RenderContext) => [emitFile],
  );

  const writeSkillTransactional = vi.fn((skillDir: string) => {
    if (options.failWriteSkillTransactionalFor === skillDir) {
      return Promise.reject(
        new Error(`simulated write failure for ${skillDir}`),
      );
    }
    return Promise.resolve();
  });

  const readDasJson = vi.fn((skillPath: string) => {
    if (options.hangOnSkillPath === skillPath) {
      return new Promise<DasJson>(() => {
        return undefined;
      });
    }
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
    buildSizedTree,
    planEmission,
    renderSkillPlan,
    writeSkillTransactional,
    readDasJson,
    writeDasJson,
    hashFileset,
    now,
    ...(options.delay ? { delay: options.delay } : {}),
  };

  return {
    deps,
    spies: {
      resolveSource,
      lsRemote,
      writeSkillTransactional,
      writeDasJson,
      hashFileset,
      readDasJson,
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
    const { deps, spies } = createFakeDeps({
      storedFilesHash: `sha256:${"d".repeat(64)}`,
      dasJsonByPath: new Map([[skillPath, dasJson]]),
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive" },
      deps,
    );

    expect(outcome).toEqual({ status: "regenerated" });
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    const written = dasJsonWrittenFor(spies.writeSkillTransactional, skillPath);
    expect(written?.sourceHash).toBe(`sha256:${"d".repeat(64)}`);
    expect(written?.lastRefresh).toBe(new Date(FIXED_NOW_MS).toISOString());
  });

  it("folds das.json into the single transactional write, and never calls writeDasJson, when regenerating", async () => {
    const dasJson = localDasJson();
    const skillPath = "/home/user/.claude/skills/widget-docs";
    const { deps, spies } = createFakeDeps({
      storedFilesHash: `sha256:${"d".repeat(64)}`,
      dasJsonByPath: new Map([[skillPath, dasJson]]),
    });

    await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive" },
      deps,
    );

    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    const writeCall = spies.writeSkillTransactional.mock.calls[0]!;
    expect(writeCall[0]).toBe(skillPath);
    expect(
      (writeCall[1] as EmitFile[]).some(
        (file) => file.relativePath === "das.json",
      ),
    ).toBe(true);
    expect(spies.writeDasJson).not.toHaveBeenCalled();
  });

  it("leaves nothing owned and never calls writeDasJson when the transactional write fails mid-regeneration", async () => {
    const dasJson = localDasJson();
    const skillPath = "/home/user/.claude/skills/widget-docs";
    const { deps, spies } = createFakeDeps({
      storedFilesHash: `sha256:${"d".repeat(64)}`,
      dasJsonByPath: new Map([[skillPath, dasJson]]),
      failWriteSkillTransactionalFor: skillPath,
    });

    await expect(
      refreshSkill(
        manifestEntryFor(dasJson, skillPath),
        { kind: "interactive" },
        deps,
      ),
    ).rejects.toThrow(`simulated write failure for ${skillPath}`);

    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    const writeCall = spies.writeSkillTransactional.mock.calls[0]!;
    expect(
      (writeCall[1] as EmitFile[]).some(
        (file) => file.relativePath === "das.json",
      ),
    ).toBe(true);
    expect(spies.writeDasJson).not.toHaveBeenCalled();
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

  it("resolves and hashes with includeLarge: true when das.json requests it, without spurious regeneration", async () => {
    const dasJson = localDasJson({ includeLarge: true });
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
    expect(spies.resolveSource.mock.calls[0]?.[1]).toEqual({
      includeLarge: true,
    });
    expect(spies.hashFileset.mock.calls[0]?.[1]).toEqual({
      slicerVersion: SLICER_VERSION,
      tokenBudget: dasJson.tokenBudget,
      includeLarge: true,
    });
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

  it("reports update-available with the exact command line when the sha has moved, touching nothing", async () => {
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
    expect(spies.writeDasJson).not.toHaveBeenCalled();
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
    const { deps, spies } = createFakeDeps({
      dasJsonByPath: new Map([[skillPath, dasJson]]),
      lsRemoteResult: "c".repeat(40),
      storedFilesHash: `sha256:${"f".repeat(64)}`,
    });

    const outcome = await refreshSkill(
      manifestEntryFor(dasJson, skillPath),
      { kind: "interactive", update: true },
      deps,
    );

    expect(outcome).toEqual({ status: "regenerated" });
    expect(spies.resolveSource).toHaveBeenCalledTimes(1);
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    const written = dasJsonWrittenFor(spies.writeSkillTransactional, skillPath);
    expect(written?.pinnedSha).toBe("c".repeat(40));
    expect(written?.sourceHash).toBe(`sha256:${"f".repeat(64)}`);
  });
});

describe("runHookRefresh", () => {
  function localEntryAndDasJson(
    name: string,
    lastRefresh: string,
    overrides: Partial<DasJson> = {},
  ): { entry: ManifestEntry; dasJson: DasJson; skillPath: string } {
    const skillPath = `/home/user/.claude/skills/${name}`;
    const dasJson = localDasJson({ name, lastRefresh, ...overrides });
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
    const { deps, spies } = createFakeDeps({
      dasJsonByPath,
      storedFilesHash: `sha256:${"c".repeat(64)}`,
    });

    const lines = await runHookRefresh(
      skills.map(({ entry }) => entry),
      "/home/user",
      deps,
    );

    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(3);
    const writtenSkillPaths = spies.writeSkillTransactional.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(writtenSkillPaths.sort()).toEqual(
      ["skill-b", "skill-d", "skill-a"]
        .map((name) => `/home/user/.claude/skills/${name}`)
        .sort(),
    );
    for (const call of spies.writeSkillTransactional.mock.calls) {
      const files = call[1] as EmitFile[];
      expect(files.some((file) => file.relativePath === "das.json")).toBe(true);
    }
    expect(spies.writeDasJson).not.toHaveBeenCalled();
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

  it("includes a project skill whose skillPath is under currentDirectory", async () => {
    const projectSkillPath = "/a/project/.claude/skills/project-skill";
    const projectDasJson = localDasJson({
      name: "project-skill",
      sourceHash:
        "sha256:matches0000000000000000000000000000000000000000000000000000",
    });
    const entries: ManifestEntry[] = [
      {
        ...manifestEntryFor(projectDasJson, projectSkillPath),
        scope: "project",
      },
    ];
    const { deps } = createFakeDeps({
      dasJsonByPath: new Map([[projectSkillPath, projectDasJson]]),
      storedFilesHash:
        "sha256:matches0000000000000000000000000000000000000000000000000000",
    });

    await runHookRefresh(entries, "/a/project", deps);

    expect(deps.readDasJson).toHaveBeenCalledWith(projectSkillPath);
  });

  it("does not treat a sibling directory sharing a path prefix as under currentDirectory", async () => {
    const siblingSkillPath = "/a/project-two/.claude/skills/sibling-skill";
    const siblingDasJson = localDasJson({ name: "sibling-skill" });
    const entries: ManifestEntry[] = [
      {
        ...manifestEntryFor(siblingDasJson, siblingSkillPath),
        scope: "project",
      },
    ];
    const { deps } = createFakeDeps({
      dasJsonByPath: new Map([[siblingSkillPath, siblingDasJson]]),
    });

    await runHookRefresh(entries, "/a/project", deps);

    expect(deps.readDasJson).not.toHaveBeenCalled();
  });

  it("never throws when one skill errors, and proves the working skill is still processed afterward", async () => {
    const brokenSkillPath = "/home/user/.claude/skills/broken-skill";
    const workingSkillPath = "/home/user/.claude/skills/working-skill";
    const workingDasJson = localDasJson({
      name: "working-skill",
      lastRefresh: "2026-07-01T00:00:00.000Z",
    });
    const entries: ManifestEntry[] = [
      {
        name: "broken-skill",
        skillPath: brokenSkillPath,
        scope: "personal",
        lastCheck: null,
        updateAvailable: false,
      },
      manifestEntryFor(workingDasJson, workingSkillPath),
    ];
    const { deps } = createFakeDeps({
      dasJsonByPath: new Map([[workingSkillPath, workingDasJson]]),
      storedFilesHash: `sha256:${"c".repeat(64)}`,
    });

    const lines = await runHookRefresh(entries, "/home/user", deps);

    const readDasJsonCalls = vi
      .mocked(deps.readDasJson)
      .mock.calls.map((call) => call[0]);
    expect(readDasJsonCalls).toEqual([brokenSkillPath, workingSkillPath]);
    expect(lines).toEqual(["das: working-skill regenerated (source changed)"]);
  });

  it("treats a per-skill timeout as stale and still processes the other skills", async () => {
    const hangingSkillPath = "/home/user/.claude/skills/hanging-skill";
    const workingSkillPath = "/home/user/.claude/skills/working-skill";
    const workingDasJson = localDasJson({ name: "working-skill" });
    const entries: ManifestEntry[] = [
      manifestEntryFor(
        localDasJson({ name: "hanging-skill" }),
        hangingSkillPath,
      ),
      manifestEntryFor(workingDasJson, workingSkillPath),
    ];
    const { deps } = createFakeDeps({
      dasJsonByPath: new Map([[workingSkillPath, workingDasJson]]),
      storedFilesHash: workingDasJson.sourceHash,
      hangOnSkillPath: hangingSkillPath,
      delay: () => Promise.resolve(),
    });

    const lines = await runHookRefresh(entries, "/home/user", deps, 5);

    expect(lines).toEqual([]);
    expect(deps.readDasJson).toHaveBeenCalledWith(workingSkillPath);
  });

  it("treats a mid-cap regeneration failure as stale and still regenerates the others", async () => {
    const skillX = localEntryAndDasJson("skill-x", "2026-07-01T00:00:00.000Z");
    const skillY = localEntryAndDasJson("skill-y", "2026-07-02T00:00:00.000Z");
    const skillZ = localEntryAndDasJson("skill-z", "2026-07-03T00:00:00.000Z");
    const dasJsonByPath = new Map(
      [skillX, skillY, skillZ].map(({ skillPath, dasJson }) => [
        skillPath,
        dasJson,
      ]),
    );
    const { deps, spies } = createFakeDeps({
      dasJsonByPath,
      storedFilesHash: `sha256:${"c".repeat(64)}`,
      failWriteSkillTransactionalFor: skillX.skillPath,
    });

    const lines = await runHookRefresh(
      [skillX.entry, skillY.entry, skillZ.entry],
      "/home/user",
      deps,
    );

    expect(spies.writeDasJson).not.toHaveBeenCalled();
    expect(
      dasJsonWrittenFor(spies.writeSkillTransactional, skillY.skillPath),
    ).toBeDefined();
    expect(
      dasJsonWrittenFor(spies.writeSkillTransactional, skillZ.skillPath),
    ).toBeDefined();
    expect(lines.sort()).toEqual(
      [
        "das: skill-y regenerated (source changed)",
        "das: skill-z regenerated (source changed)",
      ].sort(),
    );
  });
});
