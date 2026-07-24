import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AddModule from "../../src/cli/add.js";
import type { AddArgs, AddOutcome } from "../../src/cli/add.js";

const { runAddMock } = vi.hoisted(() => ({ runAddMock: vi.fn() }));

vi.mock("../../src/cli/add.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AddModule>();
  return { ...actual, runAdd: runAddMock };
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
