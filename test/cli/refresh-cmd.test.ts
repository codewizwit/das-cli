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

function createDeps(overrides: Partial<RunRefreshCommandDeps> = {}): {
  deps: RunRefreshCommandDeps;
  stdoutLines: string[];
  stderrLines: string[];
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const deps: RunRefreshCommandDeps = {
    loadManifest: vi.fn(async () => Promise.resolve(manifestOf([entry()]))),
    refreshSkill: vi.fn(async (): Promise<RefreshOutcome> =>
      Promise.resolve({ status: "unchanged" }),
    ),
    runHookRefresh: vi.fn(async () => Promise.resolve([])),
    refreshDeps: fakeRefreshDeps,
    manifestBaseDir: "/home/tester/.claude/das",
    currentDirectory: "/repo/project",
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
    ...overrides,
  };

  return { deps, stdoutLines, stderrLines };
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
