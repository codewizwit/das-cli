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
  runAdd,
  type AddArgs,
  type AddPrompts,
  type RunAddDeps,
} from "../../src/cli/add.js";

const FIXED_NOW_MS = Date.parse("2026-07-24T12:00:00.000Z");
const FAKE_HOME = "/home/tester";

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

interface FakeDepsOptions {
  resolvedFiles?: DocFile[];
  resolveSourceError?: Error;
  lsRemoteResult?: string | Error;
  scanFindings?: InjectionFinding[];
  existingDasJsonByPath?: Map<string, DasJson>;
  hasSessionStartHookResult?: boolean;
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
    writeDasJson: ReturnType<typeof vi.fn>;
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

  const buildTree = vi.fn((_files: DocFile[], _rootName: string) => ({
    ...sizedRootNode,
    subtreeTokens: 0,
  }));
  const sizeTree = vi.fn((_node: DocNode) => sizedRootNode);
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

  const writeSkillTransactional = vi.fn(async () => Promise.resolve());
  const writeDasJson = vi.fn(async () => Promise.resolve());

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
  const installSessionStartHook = vi.fn(async () =>
    Promise.resolve("installed" as const),
  );

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
    buildTree,
    sizeTree,
    planEmission,
    renderSkillPlan,
    scanForInjection,
    writeSkillTransactional,
    writeDasJson,
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
      writeDasJson,
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
    expect(spies.writeDasJson).toHaveBeenCalledTimes(1);

    const [skillDir, dasJsonData] = spies.writeDasJson.mock.calls[0] as [
      string,
      DasJson,
    ];
    const expectedDir = expectedSkillPath("personal", dasJsonData.name, {
      home: FAKE_HOME,
    });
    expect(skillDir).toBe(expectedDir);
    expect(dasJsonData.source).toEqual({
      type: "path",
      path: "/repo/docs",
      kind: "project",
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
    expect(spies.writeDasJson).not.toHaveBeenCalled();
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

    const [, dasJsonData] = spies.writeDasJson.mock.calls[0] as unknown as [
      string,
      DasJson,
    ];
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
    deps.sizeTree = vi.fn((_node: DocNode) => ({
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

    const [, dasJsonData] = spies.writeDasJson.mock.calls[0] as unknown as [
      string,
      DasJson,
    ];
    expect(dasJsonData.trackedRef).toBe("main");
    expect(dasJsonData.pinnedSha).toBe("b".repeat(40));
    expect(dasJsonData.source).toEqual({
      type: "github",
      url: "https://github.com/acme/widget-docs.git",
      subpath: null,
    });
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
});
