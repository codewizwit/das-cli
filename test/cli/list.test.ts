import { describe, expect, it, vi } from "vitest";
import { SLICER_VERSION, type DasJson } from "../../src/emitter/das-json.js";
import type { Manifest, ManifestEntry } from "../../src/state/manifest.js";
import { runListCommand, type RunListCommandDeps } from "../../src/cli/list.js";

const FIXED_NOW_MS = Date.parse("2026-07-24T12:00:00.000Z");

function githubDasJson(overrides: Partial<DasJson> = {}): DasJson {
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
    includeLarge: false,
    checkIntervalHours: 24,
    lastRefresh: "2026-07-24T00:00:00.000Z",
    generatedFiles: ["SKILL.md"],
    ...overrides,
  };
}

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

function skillMdWithDescription(description: string): string {
  return `---\nname: "widget-docs"\ndescription: "${description}"\n---\n\nBody.\n`;
}

function createDeps(overrides: Partial<RunListCommandDeps> = {}): {
  deps: RunListCommandDeps;
  stdoutLines: string[];
} {
  const stdoutLines: string[] = [];

  const deps: RunListCommandDeps = {
    loadManifest: vi.fn(async () =>
      Promise.resolve({
        version: 1,
        skills: [entry()],
      } satisfies Manifest),
    ),
    readDasJson: vi.fn(async () => Promise.resolve(githubDasJson())),
    readSkillMd: vi.fn(async () =>
      Promise.resolve(skillMdWithDescription("Hello world.")),
    ),
    now: () => FIXED_NOW_MS,
    manifestBaseDir: "/home/tester/.claude/das",
    stdout: (line) => stdoutLines.push(line),
    ...overrides,
  };

  return { deps, stdoutLines };
}

describe("runListCommand", () => {
  it("prints a header and a row for each manifest entry", async () => {
    const { deps, stdoutLines } = createDeps();

    await runListCommand(deps);

    expect(stdoutLines[0]).toMatch(/NAME/);
    expect(stdoutLines.some((line) => line.includes("widget-docs"))).toBe(true);
  });

  it("shows the pinned ref and short sha for a github source", async () => {
    const { deps, stdoutLines } = createDeps();

    await runListCommand(deps);

    expect(
      stdoutLines.some((line) => line.includes(`main@${"a".repeat(7)}`)),
    ).toBe(true);
  });

  it("shows 'local' for a path source", async () => {
    const { deps, stdoutLines } = createDeps({
      readDasJson: vi.fn(async () =>
        Promise.resolve(
          githubDasJson({
            source: { type: "path", path: "/docs/widget", kind: "folder" },
            trackedRef: null,
            pinnedSha: null,
          }),
        ),
      ),
    });

    await runListCommand(deps);

    expect(stdoutLines.some((line) => line.includes(" local "))).toBe(true);
  });

  it("prints the aggregate description-token total", async () => {
    const { deps, stdoutLines } = createDeps();

    await runListCommand(deps);

    expect(
      stdoutLines.some((line) =>
        /descriptions load ~\d+ tokens every session/.test(line),
      ),
    ).toBe(true);
  });

  it("skips a skill missing SKILL.md from the estimate, with a note", async () => {
    const entries = [
      entry({ name: "has-skill-md" }),
      entry({ name: "missing-skill-md" }),
    ];
    const readSkillMd = vi
      .fn()
      .mockResolvedValueOnce(skillMdWithDescription("Hello world."))
      .mockRejectedValueOnce(new Error("ENOENT"));
    const { deps, stdoutLines } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve({ version: 1, skills: entries }),
      ),
      readSkillMd,
    });

    await runListCommand(deps);

    expect(
      stdoutLines.some(
        (line) =>
          line.includes("missing-skill-md") && line.includes("SKILL.md"),
      ),
    ).toBe(true);
    expect(
      stdoutLines.some((line) => /descriptions load ~\d+ tokens/.test(line)),
    ).toBe(true);
  });

  it("marks a row unreadable when das.json cannot be read, without throwing", async () => {
    const { deps, stdoutLines } = createDeps({
      readDasJson: vi.fn(() => {
        throw new Error("das.json missing");
      }),
    });

    await expect(runListCommand(deps)).resolves.toBeUndefined();
    expect(
      stdoutLines.some((line) => line.includes("unreadable das.json")),
    ).toBe(true);
  });

  it("prints a message and returns when no skills are registered", async () => {
    const { deps, stdoutLines } = createDeps({
      loadManifest: vi.fn(async () =>
        Promise.resolve({ version: 1, skills: [] }),
      ),
    });

    await runListCommand(deps);

    expect(stdoutLines).toEqual(["das: no skills are registered"]);
  });
});
