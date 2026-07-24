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
  /** Validate and persist the manifest cache. */
  saveManifest: (baseDir: string, manifest: Manifest) => Promise<void>;
  /** Absolute path to the directory containing manifest.json. */
  manifestBaseDir: string;
  /** The current working directory, used to scope project skills in hook mode. */
  currentDirectory: string;
  /** The current time, in epoch milliseconds. */
  now: () => number;
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

function manifestKey(entry: {
  name: string;
  scope: "personal" | "project";
}): string {
  return `${entry.scope}:${entry.name}`;
}

/**
 * Apply a single skill's refresh outcome to its manifest entry.
 *
 * `"update-available"` sets `updateAvailable` so `das list` reports it; `"unchanged"` and
 * `"regenerated"` both clear it, since either one is a completed check or re-pin that resolves
 * any previously pending update. `"stale"` only bumps `lastCheck`, since a source read failure
 * says nothing about whether an update is still pending. `"skipped"` (a hook-mode check whose
 * interval had not elapsed) leaves the entry untouched entirely, since no check actually ran.
 * A missing outcome (the refresh itself threw) also leaves the entry untouched.
 *
 * @param entry - The manifest entry to update
 * @param outcome - The refresh outcome for this entry, or `undefined` when refreshing it threw
 * @param nowIso - The current time as an ISO 8601 string
 * @returns The updated entry, or `entry` itself when nothing changes
 */
function applyOutcomeToEntry(
  entry: ManifestEntry,
  outcome: RefreshOutcome | undefined,
  nowIso: string,
): ManifestEntry {
  if (outcome === undefined || outcome.status === "skipped") {
    return entry;
  }

  if (outcome.status === "stale") {
    return { ...entry, lastCheck: nowIso };
  }

  return {
    ...entry,
    updateAvailable: outcome.status === "update-available",
    lastCheck: nowIso,
  };
}

async function refreshEntriesAndPersist(
  entriesToRefresh: ManifestEntry[],
  manifest: Manifest,
  mode: RefreshMode,
  deps: RunRefreshCommandDeps,
): Promise<RefreshCommandResult[]> {
  const results: RefreshCommandResult[] = [];
  const outcomeByKey = new Map<string, RefreshOutcome>();

  for (const entry of entriesToRefresh) {
    const result = await refreshEntry(entry, mode, deps);
    deps.stdout(formatResultLine(result));
    results.push(result);

    if (result.outcome !== undefined) {
      outcomeByKey.set(manifestKey(entry), result.outcome);
    }
  }

  const nowIso = new Date(deps.now()).toISOString();
  const updatedSkills = manifest.skills.map((entry) =>
    applyOutcomeToEntry(entry, outcomeByKey.get(manifestKey(entry)), nowIso),
  );

  await deps.saveManifest(deps.manifestBaseDir, {
    ...manifest,
    skills: updatedSkills,
  });

  return results;
}

const HOOK_UPDATE_AVAILABLE_LINE_PATTERN = /^das: (.+) has upstream updates;/;
const HOOK_REGENERATED_LINE_PATTERN =
  /^das: (.+) regenerated \(source changed\)$/;

/**
 * Derive per-skill manifest updates from the lines {@link runHookRefresh} returned.
 *
 * `runHookRefresh` reports only a line of text per notable outcome, not a structured per-entry
 * result, so a hook-mode `"update-available"` or `"regenerated"` is recognized here by matching
 * its line against the skill name; every other entry (checked and unchanged, skipped, or stale)
 * produces no line and is left untouched, since there is nothing in `lines` to distinguish those
 * cases from one another.
 *
 * @param entries - The manifest entries the hook refresh ran over
 * @param lines - The lines `runHookRefresh` returned
 * @param nowIso - The current time as an ISO 8601 string
 * @returns The entries, with `updateAvailable` and `lastCheck` updated where a line matched
 */
function applyHookLinesToManifest(
  entries: ManifestEntry[],
  lines: string[],
  nowIso: string,
): ManifestEntry[] {
  const updateAvailableNames = new Set<string>();
  const regeneratedNames = new Set<string>();

  for (const line of lines) {
    const updateMatch = HOOK_UPDATE_AVAILABLE_LINE_PATTERN.exec(line);
    if (updateMatch?.[1] !== undefined) {
      updateAvailableNames.add(updateMatch[1]);
    }

    const regeneratedMatch = HOOK_REGENERATED_LINE_PATTERN.exec(line);
    if (regeneratedMatch?.[1] !== undefined) {
      regeneratedNames.add(regeneratedMatch[1]);
    }
  }

  return entries.map((entry) => {
    if (updateAvailableNames.has(entry.name)) {
      return { ...entry, updateAvailable: true, lastCheck: nowIso };
    }

    if (regeneratedNames.has(entry.name)) {
      return { ...entry, updateAvailable: false, lastCheck: nowIso };
    }

    return entry;
  });
}

async function runHookMode(
  deps: RunRefreshCommandDeps,
): Promise<RefreshCommandOutcome> {
  let manifest: Manifest;
  let lines: string[];

  try {
    manifest = await deps.loadManifest(deps.manifestBaseDir);
    lines = await deps.runHookRefresh(
      manifest.skills,
      deps.currentDirectory,
      deps.refreshDeps,
    );
  } catch (error) {
    deps.stderr(
      `das: hook refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { status: "hook", lines: [] };
  }

  for (const line of lines) {
    deps.stdout(line);
  }

  try {
    const nowIso = new Date(deps.now()).toISOString();
    const updatedSkills = applyHookLinesToManifest(
      manifest.skills,
      lines,
      nowIso,
    );
    await deps.saveManifest(deps.manifestBaseDir, {
      ...manifest,
      skills: updatedSkills,
    });
  } catch (error) {
    deps.stderr(
      `das: failed to persist hook refresh results: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { status: "hook", lines };
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
    const results = await refreshEntriesAndPersist(
      manifest.skills,
      manifest,
      mode,
      deps,
    );

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

    const results = await refreshEntriesAndPersist(
      matches,
      manifest,
      mode,
      deps,
    );

    return { status: "completed", results };
  }

  const message = "das refresh requires a skill name, --all, or --hook";
  deps.stderr(`das: ${message}`);
  return { status: "usage-error", message };
}
