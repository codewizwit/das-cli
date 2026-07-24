import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runHookInstallCommand,
  type RunHookInstallCommandDeps,
} from "../../src/cli/hook-cmd.js";

function createDeps(overrides: Partial<RunHookInstallCommandDeps> = {}): {
  deps: RunHookInstallCommandDeps;
  stdoutLines: string[];
  stderrLines: string[];
  installSessionStartHook: ReturnType<typeof vi.fn>;
  confirmProjectInstall: ReturnType<typeof vi.fn>;
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const installSessionStartHook = vi.fn(async () =>
    Promise.resolve("installed" as const),
  );
  const confirmProjectInstall = vi.fn(async () => Promise.resolve(true));

  const deps: RunHookInstallCommandDeps = {
    installSessionStartHook,
    confirmProjectInstall,
    home: "/home/tester",
    projectRoot: "/repo/project",
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
    ...overrides,
  };

  return {
    deps,
    stdoutLines,
    stderrLines,
    installSessionStartHook: deps.installSessionStartHook as ReturnType<
      typeof vi.fn
    >,
    confirmProjectInstall: deps.confirmProjectInstall as ReturnType<
      typeof vi.fn
    >,
  };
}

describe("runHookInstallCommand", () => {
  it("installs into the personal settings path without confirmation", async () => {
    const { deps, installSessionStartHook, confirmProjectInstall } =
      createDeps();

    const outcome = await runHookInstallCommand({}, deps);

    expect(installSessionStartHook).toHaveBeenCalledWith(
      join("/home/tester", ".claude", "settings.json"),
    );
    expect(confirmProjectInstall).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: "installed",
      settingsPath: join("/home/tester", ".claude", "settings.json"),
    });
  });

  it("reports already-present for the personal path", async () => {
    const { deps } = createDeps({
      installSessionStartHook: vi.fn(async () => Promise.resolve("already-present" as const)),
    });

    const outcome = await runHookInstallCommand({}, deps);

    expect(outcome.status).toBe("already-present");
  });

  it("--project without confirmation and without --yes does not install", async () => {
    const {
      deps,
      installSessionStartHook,
      confirmProjectInstall,
      stdoutLines,
    } = createDeps({ confirmProjectInstall: vi.fn(async () => Promise.resolve(false)) });

    const outcome = await runHookInstallCommand({ project: true }, deps);

    expect(confirmProjectInstall).toHaveBeenCalledTimes(1);
    expect(installSessionStartHook).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      status: "declined",
      settingsPath: join("/repo/project", ".claude", "settings.json"),
    });
    expect(
      stdoutLines.some(
        (line) => line.includes("collaborator") || line.includes("committed"),
      ),
    ).toBe(true);
  });

  it("--project with --yes installs without prompting", async () => {
    const { deps, installSessionStartHook, confirmProjectInstall } =
      createDeps();

    const outcome = await runHookInstallCommand(
      { project: true, yes: true },
      deps,
    );

    expect(confirmProjectInstall).not.toHaveBeenCalled();
    expect(installSessionStartHook).toHaveBeenCalledWith(
      join("/repo/project", ".claude", "settings.json"),
    );
    expect(outcome).toEqual({
      status: "installed",
      settingsPath: join("/repo/project", ".claude", "settings.json"),
    });
  });

  it("--project with interactive confirmation installs when confirmed", async () => {
    const { deps, installSessionStartHook } = createDeps({
      confirmProjectInstall: vi.fn(async () => Promise.resolve(true)),
    });

    const outcome = await runHookInstallCommand({ project: true }, deps);

    expect(installSessionStartHook).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("installed");
  });

  it("throws when --project is passed without a project root", async () => {
    const deps: RunHookInstallCommandDeps = {
      installSessionStartHook: vi.fn(async () =>
        Promise.resolve("installed" as const),
      ),
      confirmProjectInstall: vi.fn(async () => Promise.resolve(true)),
      home: "/home/tester",
      stdout: () => undefined,
      stderr: () => undefined,
    };

    await expect(
      runHookInstallCommand({ project: true }, deps),
    ).rejects.toThrow(/project root/);
  });
});
