import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/index.js";

describe("das bin entry point wiring", () => {
  it("builds a program named das", () => {
    const program = createProgram();

    expect(program.name()).toBe("das");
  });

  it("throws a zero-exit CommanderError for --help", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["node", "das", "--help"]),
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof CommanderError && error.exitCode === 0;
    });
  });

  it("throws a nonzero-exit CommanderError for an unknown command", async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(["node", "das", "totally-unknown-cmd"]),
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof CommanderError && error.exitCode !== 0;
    });
  });
});
