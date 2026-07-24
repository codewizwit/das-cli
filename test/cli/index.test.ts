import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AddModule from "../../src/cli/add.js";
import type { AddArgs, AddOutcome } from "../../src/cli/add.js";
import type * as DoctorModule from "../../src/cli/doctor.js";
import type * as HookCmdModule from "../../src/cli/hook-cmd.js";
import type { HookInstallArgs } from "../../src/cli/hook-cmd.js";
import type * as ListModule from "../../src/cli/list.js";
import type * as RefreshCmdModule from "../../src/cli/refresh-cmd.js";
import type { RefreshCommandArgs } from "../../src/cli/refresh-cmd.js";
import type * as RemoveModule from "../../src/cli/remove.js";
import type { RemoveArgs } from "../../src/cli/remove.js";

const {
  runAddMock,
  runRefreshCommandMock,
  runListCommandMock,
  runRemoveCommandMock,
  runDoctorCommandMock,
  runHookInstallCommandMock,
} = vi.hoisted(() => ({
  runAddMock: vi.fn(),
  runRefreshCommandMock: vi.fn(),
  runListCommandMock: vi.fn(),
  runRemoveCommandMock: vi.fn(),
  runDoctorCommandMock: vi.fn(),
  runHookInstallCommandMock: vi.fn(),
}));

vi.mock("../../src/cli/add.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AddModule>();
  return { ...actual, runAdd: runAddMock };
});

vi.mock("../../src/cli/refresh-cmd.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RefreshCmdModule>();
  return { ...actual, runRefreshCommand: runRefreshCommandMock };
});

vi.mock("../../src/cli/list.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ListModule>();
  return { ...actual, runListCommand: runListCommandMock };
});

vi.mock("../../src/cli/remove.js", async (importOriginal) => {
  const actual = await importOriginal<typeof RemoveModule>();
  return { ...actual, runRemoveCommand: runRemoveCommandMock };
});

vi.mock("../../src/cli/doctor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DoctorModule>();
  return { ...actual, runDoctorCommand: runDoctorCommandMock };
});

vi.mock("../../src/cli/hook-cmd.js", async (importOriginal) => {
  const actual = await importOriginal<typeof HookCmdModule>();
  return { ...actual, runHookInstallCommand: runHookInstallCommandMock };
});

const { createProgram, parseTokenBudgetOption } =
  await import("../../src/cli/index.js");

function writtenOutcome(overrides: Partial<AddOutcome> = {}): AddOutcome {
  return {
    status: "written",
    scope: "personal",
    name: "docs",
    skillPath: "/home/tester/.claude/skills/docs",
    fileCount: 2,
    hookInstalled: true,
    ...overrides,
  } as AddOutcome;
}

describe("createProgram", () => {
  beforeEach(() => {
    runAddMock.mockReset();
    runAddMock.mockResolvedValue(writtenOutcome());
    process.exitCode = undefined;
  });

  it("rejects a non-numeric --token-budget before invoking runAdd", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(
        ["add", "/repo/docs", "--yes", "--token-budget", "not-a-number"],
        { from: "user" },
      ),
    ).rejects.toThrow();

    expect(runAddMock).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative --token-budget before invoking runAdd", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(
        ["add", "/repo/docs", "--yes", "--token-budget", "0"],
        { from: "user" },
      ),
    ).rejects.toThrow();

    expect(runAddMock).not.toHaveBeenCalled();
  });

  it("wires every flag through to runAdd's AddArgs", async () => {
    const program = createProgram();

    await program.parseAsync(
      [
        "add",
        "/repo/docs",
        "--scope",
        "project",
        "--name",
        "my-skill",
        "--description",
        "Foo bar",
        "--no-hook",
        "--yes",
        "--include-large",
        "--token-budget",
        "2000",
        "--force",
      ],
      { from: "user" },
    );

    expect(runAddMock).toHaveBeenCalledTimes(1);
    const [args] = runAddMock.mock.calls[0] as [AddArgs, unknown];
    expect(args).toEqual({
      source: "/repo/docs",
      scope: "project",
      name: "my-skill",
      description: "Foo bar",
      hook: false,
      yes: true,
      includeLarge: true,
      tokenBudget: 2000,
      force: true,
    });
  });

  it("wires the minimal flag set, defaulting hook to true", async () => {
    const program = createProgram();

    await program.parseAsync(["add", "/repo/docs", "--yes"], {
      from: "user",
    });

    const [args] = runAddMock.mock.calls[0] as [AddArgs, unknown];
    expect(args).toEqual({ source: "/repo/docs", hook: true, yes: true });
  });

  it("sets a nonzero exit code when runAdd reports an aborted outcome", async () => {
    runAddMock.mockResolvedValue({
      status: "aborted",
      reason: "declined",
    } satisfies AddOutcome);
    const program = createProgram();

    await program.parseAsync(["add", "/repo/docs", "--yes"], {
      from: "user",
    });

    expect(process.exitCode).toBe(1);
  });

  it("sets a nonzero exit code when runAdd throws", async () => {
    runAddMock.mockRejectedValue(new Error("boom"));
    const program = createProgram();

    await program.parseAsync(["add", "/repo/docs", "--yes"], {
      from: "user",
    });

    expect(process.exitCode).toBe(1);
  });

  it("leaves the exit code unset on a successful written outcome", async () => {
    const program = createProgram();

    await program.parseAsync(["add", "/repo/docs", "--yes"], {
      from: "user",
    });

    expect(process.exitCode).toBeUndefined();
  });
});

describe("createProgram refresh", () => {
  beforeEach(() => {
    runRefreshCommandMock.mockReset();
    runRefreshCommandMock.mockResolvedValue({
      status: "completed",
      results: [],
    });
    process.exitCode = undefined;
  });

  it("wires a skill name and flags through to runRefreshCommand", async () => {
    const program = createProgram();

    await program.parseAsync(
      ["refresh", "widget-docs", "--update", "--force"],
      { from: "user" },
    );

    expect(runRefreshCommandMock).toHaveBeenCalledTimes(1);
    const [args] = runRefreshCommandMock.mock.calls[0] as [
      RefreshCommandArgs,
      unknown,
    ];
    expect(args).toEqual({ name: "widget-docs", update: true, force: true });
  });

  it("wires --all and --hook", async () => {
    const program = createProgram();

    await program.parseAsync(["refresh", "--all"], { from: "user" });
    const [allArgs] = runRefreshCommandMock.mock.calls[0] as [
      RefreshCommandArgs,
      unknown,
    ];
    expect(allArgs).toEqual({ all: true });

    await program.parseAsync(["refresh", "--hook"], { from: "user" });
    const [hookArgs] = runRefreshCommandMock.mock.calls[1] as [
      RefreshCommandArgs,
      unknown,
    ];
    expect(hookArgs).toEqual({ hook: true });
  });

  it("sets a nonzero exit code on a not-found outcome", async () => {
    runRefreshCommandMock.mockResolvedValue({
      status: "not-found",
      name: "missing",
    });
    const program = createProgram();

    await program.parseAsync(["refresh", "missing"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });
});

describe("createProgram list", () => {
  beforeEach(() => {
    runListCommandMock.mockReset();
    runListCommandMock.mockResolvedValue(undefined);
    process.exitCode = undefined;
  });

  it("invokes runListCommand", async () => {
    const program = createProgram();

    await program.parseAsync(["list"], { from: "user" });

    expect(runListCommandMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("sets a nonzero exit code when runListCommand rejects (e.g. loadManifest failing)", async () => {
    runListCommandMock.mockRejectedValue(new Error("disk exploded"));
    const program = createProgram();

    await program.parseAsync(["list"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });
});

describe("createProgram remove", () => {
  beforeEach(() => {
    runRemoveCommandMock.mockReset();
    runRemoveCommandMock.mockResolvedValue({
      status: "removed",
      name: "widget-docs",
      scope: "personal",
      filesDeleted: 2,
    });
    process.exitCode = undefined;
  });

  it("wires the name, --scope, and --force to runRemoveCommand", async () => {
    const program = createProgram();

    await program.parseAsync(
      ["remove", "widget-docs", "--scope", "project", "--force"],
      { from: "user" },
    );

    expect(runRemoveCommandMock).toHaveBeenCalledTimes(1);
    const [args] = runRemoveCommandMock.mock.calls[0] as [RemoveArgs, unknown];
    expect(args).toEqual({
      name: "widget-docs",
      scope: "project",
      force: true,
    });
  });

  it("sets a nonzero exit code on a refused outcome", async () => {
    runRemoveCommandMock.mockResolvedValue({
      status: "refused",
      reason: "nope",
    });
    const program = createProgram();

    await program.parseAsync(["remove", "widget-docs"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });
});

describe("createProgram doctor", () => {
  beforeEach(() => {
    runDoctorCommandMock.mockReset();
    runDoctorCommandMock.mockResolvedValue({
      added: [],
      removed: [],
      updated: [],
    });
    process.exitCode = undefined;
  });

  it("invokes runDoctorCommand", async () => {
    const program = createProgram();

    await program.parseAsync(["doctor"], { from: "user" });

    expect(runDoctorCommandMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it("sets a nonzero exit code when runDoctorCommand rejects (e.g. rebuildManifest failing)", async () => {
    runDoctorCommandMock.mockRejectedValue(new Error("scan failed"));
    const program = createProgram();

    await program.parseAsync(["doctor"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });
});

describe("createProgram hook install", () => {
  beforeEach(() => {
    runHookInstallCommandMock.mockReset();
    runHookInstallCommandMock.mockResolvedValue({
      status: "installed",
      settingsPath: "/home/tester/.claude/settings.json",
    });
    process.exitCode = undefined;
  });

  it("wires --project and --yes through to runHookInstallCommand", async () => {
    const program = createProgram();

    await program.parseAsync(["hook", "install", "--project", "--yes"], {
      from: "user",
    });

    expect(runHookInstallCommandMock).toHaveBeenCalledTimes(1);
    const [args] = runHookInstallCommandMock.mock.calls[0] as [
      HookInstallArgs,
      unknown,
    ];
    expect(args).toEqual({ project: true, yes: true });
  });

  it("leaves the exit code unset on a declined outcome; declining is not a failure", async () => {
    runHookInstallCommandMock.mockResolvedValue({
      status: "declined",
      settingsPath: "/repo/project/.claude/settings.json",
    });
    const program = createProgram();

    await program.parseAsync(["hook", "install", "--project"], {
      from: "user",
    });

    expect(process.exitCode).toBeUndefined();
  });

  it("leaves the exit code unset on an already-present outcome", async () => {
    runHookInstallCommandMock.mockResolvedValue({
      status: "already-present",
      settingsPath: "/home/tester/.claude/settings.json",
    });
    const program = createProgram();

    await program.parseAsync(["hook", "install"], { from: "user" });

    expect(process.exitCode).toBeUndefined();
  });

  it("sets a nonzero exit code when runHookInstallCommand throws", async () => {
    runHookInstallCommandMock.mockRejectedValue(new Error("boom"));
    const program = createProgram();

    await program.parseAsync(["hook", "install"], { from: "user" });

    expect(process.exitCode).toBe(1);
  });
});

describe("parseTokenBudgetOption", () => {
  it("parses a positive integer string", () => {
    expect(parseTokenBudgetOption("4000")).toBe(4000);
  });

  it("throws for non-numeric input", () => {
    expect(() => parseTokenBudgetOption("not-a-number")).toThrow();
  });

  it("throws for zero or negative input", () => {
    expect(() => parseTokenBudgetOption("0")).toThrow();
    expect(() => parseTokenBudgetOption("-5")).toThrow();
  });
});
