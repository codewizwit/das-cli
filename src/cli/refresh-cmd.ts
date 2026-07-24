import type {
  RefreshDeps,
  RefreshMode,
  RefreshOutcome,
} from "../refresh/refresh.js";
import type { Manifest, ManifestEntry } from "../state/manifest.js";

/** Flags and the optional skill name accepted by `das refresh`. */
export interface RefreshCommandArgs {
  /** Refresh only the skill with this name; omit with `all` or `hook` instead. */
  name?: string;
  /** Refresh every registered skill. */
  all?: boolean;
  /** Run the bounded, hook-mode refresh instead of an interactive one. */
  hook?: boolean;
  /** For a remote skill, fetch and regenerate at the tracked ref's current sha. */
  update?: boolean;
  /** Regenerate a local skill even when its source hash has not changed. */
  force?: boolean;
}

/** The effectful functions {@link runRefreshCommand} depends on. */
export interface RunRefreshCommandDeps {
  /** Load the manifest cache. */
  loadManifest: (baseDir: string) => Promise<Manifest>;
  /** Refresh a single skill; production wiring is {@link refreshSkill} from `src/refresh/refresh.ts`. */
  refreshSkill: (
    entry: ManifestEntry,
    mode: RefreshMode,
    deps: RefreshDeps,
  ) => Promise<RefreshOutcome>;
  /** Run the bounded hook-mode refresh; production wiring is {@link runHookRefresh}. */
  runHookRefresh: (
    entries: ManifestEntry[],
    currentDirectory: string,
    deps: RefreshDeps,
  ) => Promise<string[]>;
  /** The real refresh engine dependencies, passed through to `refreshSkill` and `runHookRefresh`. */
  refreshDeps: RefreshDeps;
  /** Absolute path to the directory containing manifest.json. */
  manifestBaseDir: string;
  /** The current working directory, used to scope project skills in hook mode. */
  currentDirectory: string;
  /** Write a line to stdout. */
  stdout: (line: string) => void;
  /** Write a line to stderr. */
  stderr: (line: string) => void;
}

/** One skill's outcome from an interactive (`[name]` or `--all`) refresh run. */
export interface RefreshCommandResult {
  /** The skill's name. */
  name: string;
  /** The skill's registered scope. */
  scope: "personal" | "project";
  /** The refresh outcome, or `undefined` when the refresh itself threw. */
  outcome?: RefreshOutcome;
  /** The error message, present only when refreshing this skill threw. */
  error?: string;
}

/** The result of a completed `das refresh` invocation. */
export type RefreshCommandOutcome =
  | { status: "hook"; lines: string[] }
  | { status: "completed"; results: RefreshCommandResult[] }
  | { status: "not-found"; name: string }
  | { status: "usage-error"; message: string };

function formatResultLine(result: RefreshCommandResult): string {
  if (result.error !== undefined) {
    return `das: ${result.name} (${result.scope}): error - ${result.error}`;
  }

  const detailSuffix =
    result.outcome?.detail !== undefined ? ` - ${result.outcome.detail}` : "";
  return `das: ${result.name} (${result.scope}): ${result.outcome?.status ?? "unknown"}${detailSuffix}`;
}

async function refreshEntry(
  entry: ManifestEntry,
  mode: RefreshMode,
  deps: RunRefreshCommandDeps,
): Promise<RefreshCommandResult> {
  try {
    const outcome = await deps.refreshSkill(entry, mode, deps.refreshDeps);
    return { name: entry.name, scope: entry.scope, outcome };
  } catch (error) {
    return {
      name: entry.name,
      scope: entry.scope,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runHookMode(
  deps: RunRefreshCommandDeps,
): Promise<RefreshCommandOutcome> {
  try {
    const manifest = await deps.loadManifest(deps.manifestBaseDir);
    const lines = await deps.runHookRefresh(
      manifest.skills,
      deps.currentDirectory,
      deps.refreshDeps,
    );

    for (const line of lines) {
      deps.stdout(line);
    }

    return { status: "hook", lines };
  } catch (error) {
    deps.stderr(
      `das: hook refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { status: "hook", lines: [] };
  }
}

/**
 * Run the `das refresh` command core: check or regenerate registered skills.
 *
 * `args.hook` runs the bounded, hook-mode refresh over every manifest entry relevant to the
 * current directory and prints whatever lines it returns; this path never throws, since it is
 * meant to run unattended from a `SessionStart` hook. `args.all` refreshes every registered
 * skill interactively; `args.name` refreshes only the matching entries. Every effectful step is
 * delegated to `deps`, so this function performs no real I/O itself.
 *
 * @param args - The parsed `das refresh` arguments and flags
 * @param deps - The injected effectful functions this run executes through
 * @returns The outcome of the refresh invocation
 */
export async function runRefreshCommand(
  args: RefreshCommandArgs,
  deps: RunRefreshCommandDeps,
): Promise<RefreshCommandOutcome> {
  if (args.hook === true) {
    return runHookMode(deps);
  }

  const mode: RefreshMode = {
    kind: "interactive",
    update: args.update ?? false,
    force: args.force ?? false,
  };

  if (args.all === true) {
    const manifest = await deps.loadManifest(deps.manifestBaseDir);
    const results: RefreshCommandResult[] = [];

    for (const entry of manifest.skills) {
      const result = await refreshEntry(entry, mode, deps);
      deps.stdout(formatResultLine(result));
      results.push(result);
    }

    return { status: "completed", results };
  }

  if (args.name !== undefined) {
    const manifest = await deps.loadManifest(deps.manifestBaseDir);
    const matches = manifest.skills.filter((entry) => entry.name === args.name);

    if (matches.length === 0) {
      const message = `No managed skill named "${args.name}" was found.`;
      deps.stderr(`das: ${message}`);
      return { status: "not-found", name: args.name };
    }

    const results: RefreshCommandResult[] = [];
    for (const entry of matches) {
      const result = await refreshEntry(entry, mode, deps);
      deps.stdout(formatResultLine(result));
      results.push(result);
    }

    return { status: "completed", results };
  }

  const message = "das refresh requires a skill name, --all, or --hook";
  deps.stderr(`das: ${message}`);
  return { status: "usage-error", message };
}
