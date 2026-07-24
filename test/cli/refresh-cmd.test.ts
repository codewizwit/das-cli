import { describe, expect, it, vi } from "vitest";
import type { RefreshDeps, RefreshOutcome } from "../../src/refresh/refresh.js";
import type { Manifest, ManifestEntry } from "../../src/state/manifest.js";
import {
  runRefreshCommand,
  type RunRefreshCommandDeps,
} from "../../src/cli/refresh-cmd.js";

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    name: "widget-docs",
    skillPath: "/home/tester/.claude/skills/widget-docs",
    scope: "personal",
    lastCheck: null,
    updateAvailable: false,
    ...overrides,
  };
}

function manifestOf(skills: ManifestEntry[]): Manifest {
  return { version: 1, skills };
}

const fakeRefreshDeps = {} as RefreshDeps;
const FIXED_NOW_MS = Date.parse("2026-07-24T12:00:00.000Z");
const FIXED_NOW_ISO = new Date(FIXED_NOW_MS).toISOString();

function createDeps(overrides: Partial<RunRefreshCommandDeps> = {}): {
  deps: RunRefreshCommandDeps;
  stdoutLines: string[];
  stderrLines: string[];
  saveManifest: ReturnType<typeof vi.fn>;
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const saveManifest = vi.fn(async () => Promise.resolve());

  const deps: RunRefreshCommandDeps = {
    loadManifest: vi.fn(async () => Promise.resolve(manifestOf([entry()]))),
    refreshSkill: vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "unchanged" }),
    ),
    runHookRefresh: vi.fn(async () => Promise.resolve([])),
    refreshDeps: fakeRefreshDeps,
    saveManifest,
    manifestBaseDir: "/home/tester/.claude/das",
    currentDirectory: "/repo/project",
    now: () => FIXED_NOW_MS,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
    ...overrides,
  };

  return {
    deps,
    stdoutLines,
    stderrLines,
    saveManifest: deps.saveManifest as ReturnType<typeof vi.fn>,
  };
}

describe("runRefreshCommand", () => {
  it("refreshes the single matching entry by name", async () => {
    const refreshSkill = vi.fn(
      async (_entry: ManifestEntry, _mode: unknown): Promise<RefreshOutcome> =>
        Promise.resolve({ status: "regenerated" }),
    );
    const { deps, stdoutLines } = createDeps({ refreshSkill });

    const outcome = await runRefreshCommand({ name: "widget-docs" }, deps);

    expect(refreshSkill).toHaveBeenCalledTimes(1);
    const [calledEntry, calledMode] = refreshSkill.mock.calls[0] as [
      ManifestEntry,
      { kind: string },
    ];
    expect(calledEntry.name).toBe("widget-docs");
    expect(calledMode.kind).toBe("interactive");
    expect(outcome.status).toBe("completed");
    expect(stdoutLines.some((line) => line.includes("regenerated"))).toBe(true);
  });

  it("threads --update and --force into the refresh mode", async () => {
    const refreshSkill = vi.fn(
      async (_entry: ManifestEntry, _mode: unknown): Promise<RefreshOutcome> =>
        Promise.resolve({ status: "regenerated" }),
    );
    const { deps } = createDeps({ refreshSkill });

    await runRefreshCommand(
      { name: "widget-docs", update: true, force: true },
      deps,
    );

    const [, calledMode] = refreshSkill.mock.calls[0] as [
      ManifestEntry,
      { update?: boolean; force?: boolean },
    ];
    expect(calledMode.update).toBe(true);
    expect(calledMode.force).toBe(true);
  });

  it("reports not-found when no manifest entry matches the name", async () => {
    const { deps, stderrLines } = createDeps();

    const outcome = await runRefreshCommand({ name: "missing" }, deps);

    expect(outcome).toEqual({ status: "not-found", name: "missing" });
    expect(stderrLines.length).toBeGreaterThan(0);
  });

  it("--all iterates every manifest entry", async () => {
    const entries = [
      entry({ name: "one" }),
      entry({ name: "two", scope: "project" }),
    ];
    const refreshSkill = vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "unchanged" }),
    );
    const { deps, stdoutLines } = createDeps({
      loadManifest: vi.fn(async () => Promise.resolve(manifestOf(entries))),
      refreshSkill,
    });

    const outcome = await runRefreshCommand({ all: true }, deps);

    expect(refreshSkill).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("completed");
    expect(stdoutLines).toHaveLength(2);
  });

  it("--hook calls runHookRefresh and prints its lines", async () => {
    const runHookRefresh = vi.fn(async () =>
      Promise.resolve(["das: widget-docs has upstream updates"]),
    );
    const { deps, stdoutLines } = createDeps({ runHookRefresh });

    const outcome = await runRefreshCommand({ hook: true }, deps);

    expect(runHookRefresh).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      status: "hook",
      lines: ["das: widget-docs has upstream updates"],
    });
    expect(stdoutLines).toEqual(["das: widget-docs has upstream updates"]);
  });

  it("--hook never throws even when loadManifest rejects", async () => {
    const { deps } = createDeps({
      loadManifest: vi.fn(() => {
        throw new Error("disk exploded");
      }),
    });

    await expect(runRefreshCommand({ hook: true }, deps)).resolves.toEqual({
      status: "hook",
      lines: [],
    });
  });

  it("--hook never throws even when runHookRefresh rejects", async () => {
    const { deps } = createDeps({
      runHookRefresh: vi.fn(() => {
        throw new Error("hook exploded");
      }),
    });

    await expect(runRefreshCommand({ hook: true }, deps)).resolves.toEqual({
      status: "hook",
      lines: [],
    });
  });

  it("reports a usage error when no name, --all, or --hook is given", async () => {
    const { deps, stderrLines } = createDeps();

    const outcome = await runRefreshCommand({}, deps);

    expect(outcome.status).toBe("usage-error");
    expect(stderrLines.length).toBeGreaterThan(0);
  });

  it("continues past a single skill's refreshSkill error during --all", async () => {
    const entries = [entry({ name: "one" }), entry({ name: "two" })];
    const refreshSkill = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: "unchanged" });
    const { deps, stdoutLines } = createDeps({
      loadManifest: vi.fn(async () => Promise.resolve(manifestOf(entries))),
      refreshSkill,
    });

    const outcome = await runRefreshCommand({ all: true }, deps);

    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") {
      expect(outcome.results[0]?.error).toContain("boom");
      expect(outcome.results[1]?.outcome?.status).toBe("unchanged");
    }
    expect(stdoutLines.some((line) => line.includes("error - boom"))).toBe(
      true,
    );
  });
});

describe("runRefreshCommand manifest write-back", () => {
  function savedSkills(
    saveManifest: ReturnType<typeof vi.fn>,
  ): ManifestEntry[] {
    const call = saveManifest.mock.calls[0] as [string, Manifest] | undefined;
    if (!call) {
      throw new Error("saveManifest was never called");
    }
    return call[1].skills;
  }

  it("sets updateAvailable and bumps lastCheck on update-available", async () => {
    const refreshSkill = vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "update-available", detail: "..." }),
    );
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(manifestOf([entry({ updateAvailable: false })])),
      ),
      refreshSkill,
    });

    await runRefreshCommand({ name: "widget-docs" }, deps);

    expect(saveManifest).toHaveBeenCalledTimes(1);
    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({
      updateAvailable: true,
      lastCheck: FIXED_NOW_ISO,
    });
  });

  it("clears updateAvailable and bumps lastCheck on regenerated", async () => {
    const refreshSkill = vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "regenerated" }),
    );
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(manifestOf([entry({ updateAvailable: true })])),
      ),
      refreshSkill,
    });

    await runRefreshCommand({ name: "widget-docs" }, deps);

    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({
      updateAvailable: false,
      lastCheck: FIXED_NOW_ISO,
    });
  });

  it("clears updateAvailable and bumps lastCheck on unchanged", async () => {
    const refreshSkill = vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "unchanged" }),
    );
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(manifestOf([entry({ updateAvailable: true })])),
      ),
      refreshSkill,
    });

    await runRefreshCommand({ name: "widget-docs" }, deps);

    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({
      updateAvailable: false,
      lastCheck: FIXED_NOW_ISO,
    });
  });

  it("leaves a prior updateAvailable=true intact on skipped", async () => {
    const refreshSkill = vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "skipped" }),
    );
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(
          manifestOf([
            entry({
              updateAvailable: true,
              lastCheck: "2026-01-01T00:00:00.000Z",
            }),
          ]),
        ),
      ),
      refreshSkill,
    });

    await runRefreshCommand({ name: "widget-docs" }, deps);

    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({
      updateAvailable: true,
      lastCheck: "2026-01-01T00:00:00.000Z",
    });
  });

  it("bumps lastCheck but leaves updateAvailable as-is on stale", async () => {
    const refreshSkill = vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "stale" }),
    );
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(manifestOf([entry({ updateAvailable: true })])),
      ),
      refreshSkill,
    });

    await runRefreshCommand({ name: "widget-docs" }, deps);

    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({
      updateAvailable: true,
      lastCheck: FIXED_NOW_ISO,
    });
  });

  it("persists all --all entries in a single saveManifest call", async () => {
    const entries = [
      entry({ name: "one", updateAvailable: false }),
      entry({ name: "two", scope: "project", updateAvailable: true }),
    ];
    const refreshSkill = vi
      .fn()
      .mockResolvedValueOnce({ status: "update-available", detail: "x" })
      .mockResolvedValueOnce({ status: "regenerated" });
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () => Promise.resolve(manifestOf(entries))),
      refreshSkill,
    });

    await runRefreshCommand({ all: true }, deps);

    expect(saveManifest).toHaveBeenCalledTimes(1);
    const skills = savedSkills(saveManifest);
    expect(skills.find((s) => s.name === "one")?.updateAvailable).toBe(true);
    expect(skills.find((s) => s.name === "two")?.updateAvailable).toBe(false);
  });

  it("--hook sets updateAvailable=true for a skill mentioned in an upstream-update line", async () => {
    const runHookRefresh = vi.fn(async () =>
      Promise.resolve(["das: widget-docs has upstream updates; run '...'"]),
    );
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(manifestOf([entry({ updateAvailable: false })])),
      ),
      runHookRefresh,
    });

    await runRefreshCommand({ hook: true }, deps);

    expect(saveManifest).toHaveBeenCalledTimes(1);
    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({
      updateAvailable: true,
      lastCheck: FIXED_NOW_ISO,
    });
  });

  it("--hook clears updateAvailable for a skill mentioned in a regenerated line", async () => {
    const runHookRefresh = vi.fn(async () =>
      Promise.resolve(["das: widget-docs regenerated (source changed)"]),
    );
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(manifestOf([entry({ updateAvailable: true })])),
      ),
      runHookRefresh,
    });

    await runRefreshCommand({ hook: true }, deps);

    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({ updateAvailable: false });
  });

  it("--hook leaves entries untouched when no line mentions them", async () => {
    const runHookRefresh = vi.fn(async () => Promise.resolve([]));
    const { deps, saveManifest } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve(
          manifestOf([
            entry({
              updateAvailable: true,
              lastCheck: "2026-01-01T00:00:00.000Z",
            }),
          ]),
        ),
      ),
      runHookRefresh,
    });

    await runRefreshCommand({ hook: true }, deps);

    const [updated] = savedSkills(saveManifest);
    expect(updated).toMatchObject({
      updateAvailable: true,
      lastCheck: "2026-01-01T00:00:00.000Z",
    });
  });

  it("--hook still returns its lines when saveManifest rejects", async () => {
    const runHookRefresh = vi.fn(async () =>
      Promise.resolve(["das: widget-docs has upstream updates; run '...'"]),
    );
    const saveManifest = vi.fn(() => {
      throw new Error("disk full");
    });
    const { deps } = createDeps({ runHookRefresh, saveManifest });

    await expect(runRefreshCommand({ hook: true }, deps)).resolves.toEqual({
      status: "hook",
      lines: ["das: widget-docs has upstream updates; run '...'"],
    });
  });
});
