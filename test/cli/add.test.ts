import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseGithubUrl } from "../../src/resolver/github-url.js";
import { expectedSkillPath } from "../../src/state/manifest.js";
import type { Manifest } from "../../src/state/manifest.js";
import type { DasJson } from "../../src/emitter/das-json.js";
import type { RenderContext } from "../../src/emitter/render.js";
import type { EmissionPlan } from "../../src/slicer/emit-plan.js";
import type { InjectionFinding } from "../../src/scan/injection.js";
import type { DocFile, DocNode, EmitFile } from "../../src/types.js";
import {
  InvalidSkillNameError,
  InvalidTokenBudgetError,
  runAdd,
  type AddArgs,
  type AddPrompts,
  type RunAddDeps,
} from "../../src/cli/add.js";

const FIXED_NOW_MS = Date.parse("2026-07-24T12:00:00.000Z");
const FAKE_HOME = "/home/tester";
const FAKE_PROJECT_ROOT = "/repo/project";

const docFile: DocFile = {
  relativePath: "intro.md",
  content: "# Intro\n\nHello.",
  frontmatter: {},
};

const sizedRootNode: DocNode = {
  name: "root",
  body: "",
  children: [
    { name: "Getting Started", body: "", children: [], subtreeTokens: 10 },
    { name: "API Reference", body: "", children: [], subtreeTokens: 10 },
  ],
  subtreeTokens: 20,
};

function fakePlanFor(skillMdPath = "SKILL.md"): EmissionPlan {
  return {
    files: [
      {
        relativePath: skillMdPath,
        node: sizedRootNode,
        role: "skill",
        childPaths: [],
      },
    ],
    oversized: [],
    oversizedIndexes: [],
  };
}

function lastWriteSkillCall(
  writeSkillTransactionalMock: ReturnType<typeof vi.fn>,
): [string, EmitFile[]] {
  const calls = writeSkillTransactionalMock.mock.calls as [
    string,
    EmitFile[],
  ][];
  const lastCall = calls[calls.length - 1];
  if (!lastCall) {
    throw new Error("writeSkillTransactional was never called");
  }
  return lastCall;
}

function dasJsonFromWriteCall(
  writeSkillTransactionalMock: ReturnType<typeof vi.fn>,
): DasJson {
  const [, files] = lastWriteSkillCall(writeSkillTransactionalMock);
  const dasJsonFile = files.find((file) => file.relativePath === "das.json");
  if (!dasJsonFile) {
    throw new Error("das.json was not present in the written files array");
  }
  return JSON.parse(dasJsonFile.content) as DasJson;
}

interface FakeDepsOptions {
  resolvedFiles?: DocFile[];
  resolveSourceError?: Error;
  lsRemoteResult?: string | Error;
  scanFindings?: InjectionFinding[];
  existingDasJsonByPath?: Map<string, DasJson>;
  hasSessionStartHookResult?: boolean;
  installSessionStartHookError?: Error;
  writeSkillTransactionalError?: Error;
  promptScope?: "personal" | "project";
  promptName?: string;
  promptDescription?: string;
  promptInstallHook?: boolean;
  promptConfirmScanFindings?: boolean;
  promptConfirmCollision?: boolean;
  projectRoot?: string;
}

function createFakeDeps(options: FakeDepsOptions = {}): {
  deps: RunAddDeps;
  spies: {
    lsRemote: ReturnType<typeof vi.fn>;
    resolveSource: ReturnType<typeof vi.fn>;
    renderSkillPlan: ReturnType<typeof vi.fn>;
    scanForInjection: ReturnType<typeof vi.fn>;
    writeSkillTransactional: ReturnType<typeof vi.fn>;
    readDasJson: ReturnType<typeof vi.fn>;
    loadManifest: ReturnType<typeof vi.fn>;
    saveManifest: ReturnType<typeof vi.fn>;
    hasSessionStartHook: ReturnType<typeof vi.fn>;
    installSessionStartHook: ReturnType<typeof vi.fn>;
    prompts: AddPrompts;
  };
} {
  const resolvedFiles = options.resolvedFiles ?? [docFile];
  const existingDasJsonByPath =
    options.existingDasJsonByPath ?? new Map<string, DasJson>();

  const lsRemote = vi.fn(async () => {
    if (options.lsRemoteResult instanceof Error) {
      throw options.lsRemoteResult;
    }
    return Promise.resolve(options.lsRemoteResult ?? "a".repeat(40));
  });

  const resolveSource = vi.fn(async () => {
    if (options.resolveSourceError) {
      throw options.resolveSourceError;
    }
    return Promise.resolve(resolvedFiles);
  });

  const buildSizedTree = vi.fn(
    (_files: DocFile[], _rootName: string) => sizedRootNode,
  );
  const planEmission = vi.fn((_root: DocNode, _opts: { tokenBudget: number }) =>
    fakePlanFor(),
  );
  const renderSkillPlan = vi.fn(
    (_plan: EmissionPlan, context: RenderContext): EmitFile[] => [
      {
        relativePath: "SKILL.md",
        content: `---\nname: "${context.skillName}"\ndescription: "${context.description}"\n---\n`,
      },
    ],
  );

  const scanForInjection = vi.fn(
    (_files: EmitFile[]) => options.scanFindings ?? [],
  );

  const writeSkillTransactional = vi.fn(async () => {
    if (options.writeSkillTransactionalError) {
      throw options.writeSkillTransactionalError;
    }
    return Promise.resolve();
  });

  const readDasJson = vi.fn((skillDir: string) => {
    const found = existingDasJsonByPath.get(skillDir);
    if (!found) {
      return Promise.reject(new Error(`no fake das.json at ${skillDir}`));
    }
    return Promise.resolve(found);
  });

  const loadManifest = vi.fn(async (): Promise<Manifest> =>
    Promise.resolve({ version: 1, skills: [] }),
  );
  const saveManifest = vi.fn(async () => Promise.resolve());

  const hasSessionStartHook = vi.fn(async () =>
    Promise.resolve(options.hasSessionStartHookResult ?? false),
  );
  const installSessionStartHook = vi.fn(async () => {
    if (options.installSessionStartHookError) {
      throw options.installSessionStartHookError;
    }
    return Promise.resolve("installed" as const);
  });

  const prompts: AddPrompts = {
    scope: vi.fn(async () =>
      Promise.resolve(options.promptScope ?? "personal"),
    ),
    name: vi.fn(async (defaultName: string) =>
      Promise.resolve(options.promptName ?? defaultName),
    ),
    description: vi.fn(async (defaultDescription: string) =>
      Promise.resolve(options.promptDescription ?? defaultDescription),
    ),
    installHook: vi.fn(async () =>
      Promise.resolve(options.promptInstallHook ?? true),
    ),
    confirmScanFindings: vi.fn(async () =>
      Promise.resolve(options.promptConfirmScanFindings ?? false),
    ),
    confirmCollision: vi.fn(async () =>
      Promise.resolve(options.promptConfirmCollision ?? false),
    ),
  };

  const deps: RunAddDeps = {
    parseGithubUrl,
    lsRemote,
    resolveSource,
    buildSizedTree,
    planEmission,
    renderSkillPlan,
    scanForInjection,
    writeSkillTransactional,
    readDasJson,
    hashFileset: (_files: DocFile[]) => `sha256:${"a".repeat(64)}`,
    loadManifest,
    saveManifest,
    expectedSkillPath,
    assertManagedPath: () => undefined,
    hasSessionStartHook,
    installSessionStartHook,
    prompts,
    now: () => FIXED_NOW_MS,
    stdout: () => undefined,
    stderr: () => undefined,
    home: FAKE_HOME,
    ...(options.projectRoot !== undefined
      ? { projectRoot: options.projectRoot }
      : {}),
    manifestBaseDir: "/home/tester/.claude/das",
    dasVersion: "1.2.3",
  };

  return {
    deps,
    spies: {
      lsRemote,
      resolveSource,
      renderSkillPlan,
      scanForInjection,
      writeSkillTransactional,
      readDasJson,
      loadManifest,
      saveManifest,
      hasSessionStartHook,
      installSessionStartHook,
      prompts,
    },
  };
}

function baseArgs(overrides: Partial<AddArgs> = {}): AddArgs {
  return {
    source: "/repo/docs",
    yes: true,
    ...overrides,
  };
}

describe("runAdd", () => {
  it("writes the skill, das.json, and manifest entry for a local source with --yes", async () => {
    const { deps, spies } = createFakeDeps();

    const outcome = await runAdd(baseArgs(), deps);

    expect(outcome.status).toBe("written");
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);

    const [skillDir] = lastWriteSkillCall(spies.writeSkillTransactional);
    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    const expectedDir = expectedSkillPath("personal", dasJsonData.name, {
      home: FAKE_HOME,
    });
    expect(skillDir).toBe(expectedDir);
    expect(dasJsonData.source).toEqual({
      type: "path",
      path: "/repo/docs",
      kind: "folder",
    });
    expect(dasJsonData.pinnedSha).toBeNull();
    expect(dasJsonData.trackedRef).toBeNull();
    expect(dasJsonData.dasVersion).toBe("1.2.3");
    expect(dasJsonData.tokenBudget).toBe(4000);
    expect(dasJsonData.checkIntervalHours).toBe(24);
    expect(dasJsonData.generatedFiles).toContain("das.json");
    expect(dasJsonData.generatedFiles).toContain("SKILL.md");

    expect(spies.saveManifest).toHaveBeenCalledTimes(1);
    const [, manifest] = spies.saveManifest.mock.calls[0] as [string, Manifest];
    expect(manifest.skills).toContainEqual(
      expect.objectContaining({
        name: dasJsonData.name,
        skillPath: skillDir,
        scope: "personal",
      }),
    );

    expect(spies.installSessionStartHook).toHaveBeenCalledTimes(1);
    if (outcome.status === "written") {
      expect(outcome.hookInstalled).toBe(true);
    }
  });

  it("aborts without writing when --yes hits injection scan findings", async () => {
    const findings: InjectionFinding[] = [
      {
        relativePath: "SKILL.md",
        line: 3,
        pattern: "instruction-override",
        excerpt: "ignore previous instructions",
      },
    ];
    const { deps, spies } = createFakeDeps({ scanFindings: findings });

    const outcome = await runAdd(baseArgs(), deps);

    expect(outcome.status).toBe("aborted");
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
    expect(spies.saveManifest).not.toHaveBeenCalled();
    expect(spies.installSessionStartHook).not.toHaveBeenCalled();
  });

  it("writes when interactive confirms past injection scan findings", async () => {
    const findings: InjectionFinding[] = [
      {
        relativePath: "SKILL.md",
        line: 3,
        pattern: "role-marker",
        excerpt: "system: do something",
      },
    ];
    const { deps, spies } = createFakeDeps({
      scanFindings: findings,
      promptConfirmScanFindings: true,
    });

    const outcome = await runAdd(baseArgs({ yes: false }), deps);

    expect(outcome.status).toBe("written");
    expect(spies.prompts.confirmScanFindings).toHaveBeenCalledWith(findings);
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    expect(spies.saveManifest).toHaveBeenCalledTimes(1);
  });

  it("does not write when interactive declines past injection scan findings", async () => {
    const findings: InjectionFinding[] = [
      {
        relativePath: "SKILL.md",
        line: 3,
        pattern: "role-marker",
        excerpt: "system: do something",
      },
    ];
    const { deps, spies } = createFakeDeps({
      scanFindings: findings,
      promptConfirmScanFindings: false,
    });

    const outcome = await runAdd(baseArgs({ yes: false }), deps);

    expect(outcome.status).toBe("aborted");
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
    expect(spies.saveManifest).not.toHaveBeenCalled();
  });

  it("defaults the description to the neutral template", async () => {
    const { deps, spies } = createFakeDeps();

    await runAdd(baseArgs(), deps);

    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    const [, context] = spies.renderSkillPlan.mock.calls[0] as unknown as [
      EmissionPlan,
      RenderContext,
    ];
    expect(context.description).toBe(
      "Reference documentation for docs, sliced from /repo/docs. Covers: Getting Started, API Reference.",
    );
    expect(dasJsonData.name).toBe("docs");
  });

  it("caps the default description at 1024 characters", async () => {
    const longSectionName = "x".repeat(2000);
    const { deps, spies } = createFakeDeps();
    deps.buildSizedTree = vi.fn((_files: DocFile[], _rootName: string) => ({
      ...sizedRootNode,
      children: [
        { name: longSectionName, body: "", children: [], subtreeTokens: 1 },
      ],
    }));

    await runAdd(baseArgs(), deps);

    const [, context] = spies.renderSkillPlan.mock.calls[0] as unknown as [
      EmissionPlan,
      RenderContext,
    ];
    expect(context.description.length).toBe(1024);
  });

  it("aborts a name collision with a different source under --yes without --force", async () => {
    const skillDir = expectedSkillPath("personal", "docs", { home: FAKE_HOME });
    const existingDasJsonByPath = new Map<string, DasJson>([
      [
        skillDir,
        {
          dasVersion: "0.9.0",
          slicerVersion: 1,
          name: "docs",
          source: { type: "path", path: "/other/place", kind: "project" },
          trackedRef: null,
          pinnedSha: null,
          sourceHash: `sha256:${"b".repeat(64)}`,
          tokenBudget: 4000,
          includeLarge: false,
          checkIntervalHours: 24,
          lastRefresh: "2026-07-20T12:00:00.000Z",
          generatedFiles: ["SKILL.md", "das.json"],
        },
      ],
    ]);
    const { deps, spies } = createFakeDeps({ existingDasJsonByPath });

    const outcome = await runAdd(baseArgs(), deps);

    expect(outcome.status).toBe("aborted");
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
  });

  it("overwrites a name collision with a different source when --force is passed", async () => {
    const skillDir = expectedSkillPath("personal", "docs", { home: FAKE_HOME });
    const existingDasJsonByPath = new Map<string, DasJson>([
      [
        skillDir,
        {
          dasVersion: "0.9.0",
          slicerVersion: 1,
          name: "docs",
          source: { type: "path", path: "/other/place", kind: "project" },
          trackedRef: null,
          pinnedSha: null,
          sourceHash: `sha256:${"b".repeat(64)}`,
          tokenBudget: 4000,
          includeLarge: false,
          checkIntervalHours: 24,
          lastRefresh: "2026-07-20T12:00:00.000Z",
          generatedFiles: ["SKILL.md", "das.json"],
        },
      ],
    ]);
    const { deps, spies } = createFakeDeps({ existingDasJsonByPath });

    const outcome = await runAdd(baseArgs({ force: true }), deps);

    expect(outcome.status).toBe("written");
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
  });

  it("does not prompt or require --force when re-adding the same source (no collision)", async () => {
    const skillDir = expectedSkillPath("personal", "docs", { home: FAKE_HOME });
    const existingDasJsonByPath = new Map<string, DasJson>([
      [
        skillDir,
        {
          dasVersion: "0.9.0",
          slicerVersion: 1,
          name: "docs",
          source: { type: "path", path: "/repo/docs", kind: "folder" },
          trackedRef: null,
          pinnedSha: null,
          sourceHash: `sha256:${"b".repeat(64)}`,
          tokenBudget: 4000,
          includeLarge: false,
          checkIntervalHours: 24,
          lastRefresh: "2026-07-20T12:00:00.000Z",
          generatedFiles: ["SKILL.md", "das.json"],
        },
      ],
    ]);
    const { deps, spies } = createFakeDeps({ existingDasJsonByPath });

    const outcome = await runAdd(baseArgs(), deps);

    expect(outcome.status).toBe("written");
    expect(spies.prompts.confirmCollision).not.toHaveBeenCalled();
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
  });

  it("pins a github source's sha via lsRemote before resolving, and records trackedRef/pinnedSha", async () => {
    const { deps, spies } = createFakeDeps({
      lsRemoteResult: "b".repeat(40),
    });

    const outcome = await runAdd(
      baseArgs({ source: "https://github.com/acme/widget-docs/tree/main" }),
      deps,
    );

    expect(outcome.status).toBe("written");
    expect(spies.lsRemote).toHaveBeenCalledWith(
      "https://github.com/acme/widget-docs.git",
      "main",
    );
    expect(spies.resolveSource).toHaveBeenCalledWith(
      {
        type: "github",
        url: "https://github.com/acme/widget-docs.git",
        subpath: null,
      },
      { includeLarge: false, pinnedSha: "b".repeat(40) },
    );

    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    expect(dasJsonData.trackedRef).toBe("main");
    expect(dasJsonData.pinnedSha).toBe("b".repeat(40));
    expect(dasJsonData.source).toEqual({
      type: "github",
      url: "https://github.com/acme/widget-docs.git",
      subpath: null,
    });
  });

  it("defaults trackedRef to HEAD for a bare github URL with no /tree/<ref>", async () => {
    const { deps, spies } = createFakeDeps();

    const outcome = await runAdd(
      baseArgs({ source: "https://github.com/acme/widget-docs" }),
      deps,
    );

    expect(outcome.status).toBe("written");
    expect(spies.lsRemote).toHaveBeenCalledWith(
      "https://github.com/acme/widget-docs.git",
      "HEAD",
    );
    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    expect(dasJsonData.trackedRef).toBe("HEAD");
  });

  it("offers the hook prompt only when no hook is already installed", async () => {
    const present = createFakeDeps({ hasSessionStartHookResult: true });
    await runAdd(baseArgs({ yes: false }), present.deps);
    expect(present.spies.prompts.installHook).not.toHaveBeenCalled();
    expect(present.spies.installSessionStartHook).not.toHaveBeenCalled();

    const absent = createFakeDeps({
      hasSessionStartHookResult: false,
      promptInstallHook: true,
    });
    const outcome = await runAdd(baseArgs({ yes: false }), absent.deps);
    expect(absent.spies.prompts.installHook).toHaveBeenCalledTimes(1);
    expect(absent.spies.installSessionStartHook).toHaveBeenCalledTimes(1);
    if (outcome.status === "written") {
      expect(outcome.hookInstalled).toBe(true);
    }
  });

  it("skips the hook prompt and install entirely when hook is explicitly disabled", async () => {
    const { deps, spies } = createFakeDeps({
      hasSessionStartHookResult: false,
    });

    await runAdd(baseArgs({ yes: false, hook: false }), deps);

    expect(spies.prompts.installHook).not.toHaveBeenCalled();
    expect(spies.hasSessionStartHook).not.toHaveBeenCalled();
    expect(spies.installSessionStartHook).not.toHaveBeenCalled();
  });

  it("reports a hook install failure as a partial success, not a failed add", async () => {
    const { deps, spies } = createFakeDeps({
      hasSessionStartHookResult: false,
      installSessionStartHookError: new Error("permission denied"),
    });

    const outcome = await runAdd(baseArgs(), deps);

    expect(outcome.status).toBe("written");
    if (outcome.status === "written") {
      expect(outcome.hookInstalled).toBe(false);
      expect(outcome.hookError).toContain("permission denied");
    }
    expect(spies.writeSkillTransactional).toHaveBeenCalledTimes(1);
    expect(spies.saveManifest).toHaveBeenCalledTimes(1);
  });

  it("propagates an empty-fileset error without creating a skill", async () => {
    const { deps, spies } = createFakeDeps({
      resolveSourceError: new Error(
        "No usable Markdown files found. Searched: /repo/docs",
      ),
    });

    await expect(runAdd(baseArgs(), deps)).rejects.toThrow(
      "No usable Markdown files found",
    );
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
    expect(spies.saveManifest).not.toHaveBeenCalled();
  });

  it("writes das.json atomically alongside the skill content, never as a separate call", async () => {
    const { deps, spies } = createFakeDeps();

    await runAdd(baseArgs(), deps);

    const [, files] = lastWriteSkillCall(spies.writeSkillTransactional);
    const relativePaths = files.map((file) => file.relativePath);
    expect(relativePaths).toContain("das.json");
    expect(relativePaths).toContain("SKILL.md");

    const dasJsonFile = files.find((file) => file.relativePath === "das.json");
    expect(dasJsonFile?.content.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(dasJsonFile?.content ?? "{}") as DasJson;
    expect(parsed.name).toBe("docs");
  });

  it("leaves nothing owned when the single transactional write fails", async () => {
    const { deps, spies } = createFakeDeps({
      writeSkillTransactionalError: new Error("disk full"),
    });

    await expect(runAdd(baseArgs(), deps)).rejects.toThrow("disk full");

    expect(spies.saveManifest).not.toHaveBeenCalled();
    expect(spies.installSessionStartHook).not.toHaveBeenCalled();
  });

  it("rejects an invalid --name before any write", async () => {
    const { deps, spies } = createFakeDeps();

    await expect(runAdd(baseArgs({ name: "Bad Name!" }), deps)).rejects.toThrow(
      InvalidSkillNameError,
    );

    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
    expect(spies.saveManifest).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric token budget before any write", async () => {
    const { deps, spies } = createFakeDeps();

    await expect(
      runAdd(baseArgs({ tokenBudget: Number.NaN }), deps),
    ).rejects.toThrow(InvalidTokenBudgetError);

    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
    expect(spies.saveManifest).not.toHaveBeenCalled();
  });

  it("rejects a token budget below the minimum before resolving the source", async () => {
    const { deps, spies } = createFakeDeps();

    await expect(runAdd(baseArgs({ tokenBudget: 200 }), deps)).rejects.toThrow(
      InvalidTokenBudgetError,
    );

    expect(spies.lsRemote).not.toHaveBeenCalled();
    expect(spies.resolveSource).not.toHaveBeenCalled();
    expect(spies.writeSkillTransactional).not.toHaveBeenCalled();
    expect(spies.saveManifest).not.toHaveBeenCalled();
  });

  it("rejects a token budget above the maximum before resolving the source", async () => {
    const { deps, spies } = createFakeDeps();

    await expect(
      runAdd(baseArgs({ tokenBudget: 200_000 }), deps),
    ).rejects.toThrow(InvalidTokenBudgetError);

    expect(spies.resolveSource).not.toHaveBeenCalled();
  });

  it("persists the resolved absolute path for a relative local source", async () => {
    const { deps, spies } = createFakeDeps();

    await runAdd(baseArgs({ source: "./docs" }), deps);

    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    expect(dasJsonData.source.type).toBe("path");
    if (dasJsonData.source.type === "path") {
      expect(dasJsonData.source.path).toBe(resolve("./docs"));
      expect(dasJsonData.source.path.startsWith("/")).toBe(true);
    }
  });

  it("uses the project skill path and settings when scope is project", async () => {
    const { deps, spies } = createFakeDeps({
      projectRoot: FAKE_PROJECT_ROOT,
    });

    const outcome = await runAdd(baseArgs({ scope: "project" }), deps);

    expect(outcome.status).toBe("written");
    const [skillDir] = lastWriteSkillCall(spies.writeSkillTransactional);
    expect(skillDir).toBe(
      expectedSkillPath("project", "docs", {
        home: FAKE_HOME,
        projectRoot: FAKE_PROJECT_ROOT,
      }),
    );
  });

  it("throws a clear error for scope project without a projectRoot", async () => {
    const { deps } = createFakeDeps();

    await expect(runAdd(baseArgs({ scope: "project" }), deps)).rejects.toThrow(
      /projectRoot/,
    );
  });

  it("prints a warning naming oversized files when the plan flags them", async () => {
    const { deps } = createFakeDeps();
    const stdout = vi.fn();
    deps.stdout = stdout;
    deps.planEmission = vi.fn(
      (_root: DocNode, _opts: { tokenBudget: number }) => ({
        ...fakePlanFor(),
        oversized: ["resources/api-reference.md"],
        oversizedIndexes: ["resources/guides/index.md"],
      }),
    );

    const outcome = await runAdd(baseArgs(), deps);

    expect(outcome.status).toBe("written");
    expect(stdout).toHaveBeenCalledWith(
      "das: warning: 2 generated file(s) exceed the token budget and were emitted whole: resources/api-reference.md, resources/guides/index.md",
    );
  });

  it("prints no oversized warning when the plan has nothing flagged", async () => {
    const { deps } = createFakeDeps();
    const stdout = vi.fn();
    deps.stdout = stdout;

    await runAdd(baseArgs(), deps);

    const warningCalls = (stdout.mock.calls as [string][]).filter(([line]) =>
      line.includes("exceed the token budget"),
    );
    expect(warningCalls).toHaveLength(0);
  });

  it("persists the union of oversized and oversizedIndexes into das.json", async () => {
    const { deps, spies } = createFakeDeps();
    deps.planEmission = vi.fn(
      (_root: DocNode, _opts: { tokenBudget: number }) => ({
        ...fakePlanFor(),
        oversized: ["resources/api-reference.md"],
        oversizedIndexes: ["resources/guides/index.md"],
      }),
    );

    await runAdd(baseArgs(), deps);

    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    expect(dasJsonData.oversized).toEqual([
      "resources/api-reference.md",
      "resources/guides/index.md",
    ]);
  });

  it("omits the oversized field from das.json when the plan has nothing flagged", async () => {
    const { deps, spies } = createFakeDeps();

    await runAdd(baseArgs(), deps);

    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    expect(dasJsonData.oversized).toBeUndefined();
  });

  it("honors explicit --scope/--name/--description flags without prompting, even without --yes", async () => {
    const { deps, spies } = createFakeDeps({
      projectRoot: FAKE_PROJECT_ROOT,
      hasSessionStartHookResult: true,
    });

    const outcome = await runAdd(
      baseArgs({
        yes: false,
        scope: "project",
        name: "custom-name",
        description: "Custom description",
      }),
      deps,
    );

    expect(outcome.status).toBe("written");
    expect(spies.prompts.scope).not.toHaveBeenCalled();
    expect(spies.prompts.name).not.toHaveBeenCalled();
    expect(spies.prompts.description).not.toHaveBeenCalled();

    const dasJsonData = dasJsonFromWriteCall(spies.writeSkillTransactional);
    expect(dasJsonData.name).toBe("custom-name");
  });
});
