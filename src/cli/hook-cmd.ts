import { join } from "node:path";

/** Flags accepted by `das hook install`. */
export interface HookInstallArgs {
  /** Install into the project's committed `.claude/settings.json` instead of the personal one. */
  project?: boolean;
  /** Skip the collaborator-impact confirmation prompt for `--project`. */
  yes?: boolean;
}

/** The effectful functions {@link runHookInstallCommand} depends on. */
export interface RunHookInstallCommandDeps {
  /** Install the DAS SessionStart hook into a settings file. */
  installSessionStartHook: (
    settingsPath: string,
  ) => Promise<"installed" | "already-present">;
  /** Prompt for confirmation before installing into a project's committed settings file. */
  confirmProjectInstall: (settingsPath: string) => Promise<boolean>;
  /** The user's home directory, used to derive the personal settings path. */
  home: string;
  /** The current project root, required for `--project`. */
  projectRoot?: string;
  /** Write a line to stdout. */
  stdout: (line: string) => void;
  /** Write a line to stderr. */
  stderr: (line: string) => void;
}

/** The result of a `das hook install` invocation. */
export type HookInstallOutcome =
  | { status: "installed"; settingsPath: string }
  | { status: "already-present"; settingsPath: string }
  | { status: "declined"; settingsPath: string };

function reportInstallResult(
  result: "installed" | "already-present",
  settingsPath: string,
  deps: RunHookInstallCommandDeps,
): HookInstallOutcome {
  deps.stdout(
    result === "installed"
      ? `das: installed the SessionStart hook at ${settingsPath}`
      : `das: the SessionStart hook is already present at ${settingsPath}`,
  );
  return { status: result, settingsPath };
}

/**
 * Run the `das hook install` command core.
 *
 * Installing into the personal settings file is unconditional, since only the current user is
 * affected. Installing into a project's committed `.claude/settings.json` runs
 * `das refresh --hook` for every collaborator who checks it out, so that path always prints a
 * warning first and requires explicit confirmation, either interactively via
 * `deps.confirmProjectInstall` or non-interactively via `--yes`; declining installs nothing.
 *
 * @param args - The parsed `das hook install` arguments and flags
 * @param deps - The injected effectful functions this run executes through
 * @returns The outcome of the install attempt
 * @throws {@link Error} When `--project` is passed without `deps.projectRoot` set
 */
export async function runHookInstallCommand(
  args: HookInstallArgs,
  deps: RunHookInstallCommandDeps,
): Promise<HookInstallOutcome> {
  if (args.project !== true) {
    const settingsPath = join(deps.home, ".claude", "settings.json");
    const result = await deps.installSessionStartHook(settingsPath);
    return reportInstallResult(result, settingsPath, deps);
  }

  if (!deps.projectRoot) {
    throw new Error(
      "das hook install --project requires a project root to install into",
    );
  }

  const settingsPath = join(deps.projectRoot, ".claude", "settings.json");

  deps.stdout(
    "das: installing the SessionStart hook into a project's committed .claude/settings.json runs " +
      "'das refresh --hook' for every collaborator who checks out this project. Only proceed if that " +
      "is what your team wants.",
  );

  const confirmed =
    args.yes === true ? true : await deps.confirmProjectInstall(settingsPath);

  if (!confirmed) {
    deps.stdout("das: hook not installed (declined)");
    return { status: "declined", settingsPath };
  }

  const result = await deps.installSessionStartHook(settingsPath);
  return reportInstallResult(result, settingsPath, deps);
}
