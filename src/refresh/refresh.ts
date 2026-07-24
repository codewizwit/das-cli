import { resolve, sep } from "node:path";
import { SLICER_VERSION, type DasJson } from "../emitter/das-json.js";
import type { RenderContext } from "../emitter/render.js";
import type { EmissionPlan } from "../slicer/emit-plan.js";
import type { HashParams } from "../state/hash.js";
import type { ManifestEntry } from "../state/manifest.js";
import type { DocFile, DocNode, EmitFile, SourceRef } from "../types.js";

const LOCAL_REGENERATION_CAP = 3;
const INCLUDE_LARGE_DEFAULT = false;

/** The result of attempting to refresh a single skill. */
export interface RefreshOutcome {
  /**
   * `"unchanged"` when the source hash (local) or pinned sha (remote) still
   * matches, `"regenerated"` when the skill was rewritten, `"update-available"`
   * when a remote sha moved but content was left untouched, `"skipped"` when a
   * hook-mode check interval had not yet elapsed, and `"stale"` when the
   * source could not be read or reached.
   */
  status:
    "unchanged" | "regenerated" | "update-available" | "skipped" | "stale";
  /** A one-line message to surface to the user, present on `"update-available"`. */
  detail?: string;
}

/** How a refresh is being invoked, controlling which checks and side effects run. */
export interface RefreshMode {
  /** `"hook"` runs the bounded, network-cheap SessionStart check; `"interactive"` is a user-invoked `das refresh`. */
  kind: "interactive" | "hook";
  /** For a remote source in interactive mode, fetch and regenerate at the tracked ref's current sha instead of only checking it. */
  update?: boolean;
  /** Regenerate a local skill even when its source hash has not changed. */
  force?: boolean;
}

/**
 * The effectful functions {@link refreshSkill} and {@link runHookRefresh} depend on.
 *
 * Production code wires the real resolver, slicer, emitter, and state functions;
 * tests wire fakes so refresh logic is exercised without touching the network,
 * git, or the filesystem.
 */
export interface RefreshDeps {
  /** Resolve a source ref into its documentation fileset. */
  resolveSource: (
    ref: SourceRef,
    options: { includeLarge: boolean; pinnedSha?: string },
  ) => Promise<DocFile[]>;
  /** Resolve a ref on a remote to its current commit sha. */
  lsRemote: (url: string, ref: string) => Promise<string>;
  /** Build a normalized documentation tree from a fileset. */
  buildTree: (files: DocFile[], rootName: string) => DocNode;
  /** Populate subtree token counts on a documentation tree. */
  sizeTree: (node: DocNode) => DocNode;
  /** Decide which nodes of a sized tree become which emitted files. */
  planEmission: (
    root: DocNode,
    options: { tokenBudget: number },
  ) => EmissionPlan;
  /** Render an emission plan's structure into full file contents. */
  renderSkillPlan: (plan: EmissionPlan, context: RenderContext) => EmitFile[];
  /** Write a complete skill directory tree, replacing any existing tree atomically. */
  writeSkillTransactional: (
    skillDir: string,
    files: EmitFile[],
  ) => Promise<void>;
  /** Read and validate a skill's das.json record. */
  readDasJson: (skillDir: string) => Promise<DasJson>;
  /** Validate and write a skill's das.json record. */
  writeDasJson: (skillDir: string, data: DasJson) => Promise<void>;
  /** Compute a deterministic digest of a fileset and its generation parameters. */
  hashFileset: (files: DocFile[], params: HashParams) => string;
  /** The current time, in epoch milliseconds. */
  now: () => number;
  /** Optional injection-scan hook run over a freshly resolved fileset before it is regenerated. */
  scanChanged?: (files: DocFile[]) => Promise<void> | void;
}

type GithubSource = Extract<DasJson["source"], { type: "github" }>;

type LocalRefreshEvaluation =
  | { kind: "stale" }
  | { kind: "unchanged" }
  | { kind: "needs-regeneration"; files: DocFile[]; sourceHash: string };

function hashParamsFor(dasJson: DasJson): HashParams {
  return {
    slicerVersion: SLICER_VERSION,
    tokenBudget: dasJson.tokenBudget,
    includeLarge: INCLUDE_LARGE_DEFAULT,
  };
}

function deriveSourceLabel(source: DasJson["source"]): string {
  if (source.type === "path") {
    return source.path;
  }

  return source.subpath ? `${source.url}/${source.subpath}` : source.url;
}

function deriveDescription(dasJson: DasJson, sourceLabel: string): string {
  return `Reference documentation for ${dasJson.name}, sliced from ${sourceLabel}.`;
}

function isCheckIntervalElapsed(dasJson: DasJson, nowMs: number): boolean {
  const lastRefreshMs = Date.parse(dasJson.lastRefresh);
  const elapsedHours = (nowMs - lastRefreshMs) / (60 * 60 * 1000);
  return elapsedHours >= dasJson.checkIntervalHours;
}

async function regenerateSkill(
  entry: ManifestEntry,
  dasJson: DasJson,
  regeneration: {
    files: DocFile[];
    sourceHash: string;
    pinnedSha: string | null;
  },
  deps: RefreshDeps,
): Promise<void> {
  const tree = deps.sizeTree(deps.buildTree(regeneration.files, dasJson.name));
  const plan = deps.planEmission(tree, { tokenBudget: dasJson.tokenBudget });
  const sourceLabel = deriveSourceLabel(dasJson.source);

  const renderedFiles = deps.renderSkillPlan(plan, {
    skillName: dasJson.name,
    description: deriveDescription(dasJson, sourceLabel),
    sourceLabel,
  });

  await deps.writeSkillTransactional(entry.skillPath, renderedFiles);

  const updatedDasJson: DasJson = {
    ...dasJson,
    pinnedSha: regeneration.pinnedSha,
    sourceHash: regeneration.sourceHash,
    lastRefresh: new Date(deps.now()).toISOString(),
    generatedFiles: renderedFiles.map((file) => file.relativePath),
  };

  await deps.writeDasJson(entry.skillPath, updatedDasJson);
}

async function evaluateLocalSource(
  dasJson: DasJson,
  force: boolean,
  deps: RefreshDeps,
): Promise<LocalRefreshEvaluation> {
  let files: DocFile[];

  try {
    files = await deps.resolveSource(dasJson.source, {
      includeLarge: INCLUDE_LARGE_DEFAULT,
    });
  } catch {
    return { kind: "stale" };
  }

  const sourceHash = deps.hashFileset(files, hashParamsFor(dasJson));

  if (sourceHash === dasJson.sourceHash && !force) {
    return { kind: "unchanged" };
  }

  return { kind: "needs-regeneration", files, sourceHash };
}

async function refreshLocalSkill(
  entry: ManifestEntry,
  dasJson: DasJson,
  mode: RefreshMode,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  const evaluation = await evaluateLocalSource(
    dasJson,
    mode.force === true,
    deps,
  );

  if (evaluation.kind === "stale") {
    return { status: "stale" };
  }

  if (evaluation.kind === "unchanged") {
    return { status: "unchanged" };
  }

  await regenerateSkill(
    entry,
    dasJson,
    {
      files: evaluation.files,
      sourceHash: evaluation.sourceHash,
      pinnedSha: dasJson.pinnedSha,
    },
    deps,
  );

  return { status: "regenerated" };
}

async function checkRemoteForUpdate(
  entry: ManifestEntry,
  dasJson: DasJson,
  source: GithubSource,
  ref: string,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  let sha: string;

  try {
    sha = await deps.lsRemote(source.url, ref);
  } catch {
    return { status: "stale" };
  }

  if (sha === dasJson.pinnedSha) {
    await deps.writeDasJson(entry.skillPath, {
      ...dasJson,
      lastRefresh: new Date(deps.now()).toISOString(),
    });
    return { status: "unchanged" };
  }

  return {
    status: "update-available",
    detail: `das: ${dasJson.name} has upstream updates; run 'das refresh ${dasJson.name} --update'`,
  };
}

async function refreshRemoteWithUpdate(
  entry: ManifestEntry,
  dasJson: DasJson,
  source: GithubSource,
  ref: string,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  let sha: string;

  try {
    sha = await deps.lsRemote(source.url, ref);
  } catch {
    return { status: "stale" };
  }

  let files: DocFile[];

  try {
    files = await deps.resolveSource(dasJson.source, {
      includeLarge: INCLUDE_LARGE_DEFAULT,
      pinnedSha: sha,
    });
  } catch {
    return { status: "stale" };
  }

  if (deps.scanChanged) {
    await deps.scanChanged(files);
  }

  const sourceHash = deps.hashFileset(files, hashParamsFor(dasJson));

  await regenerateSkill(
    entry,
    dasJson,
    { files, sourceHash, pinnedSha: sha },
    deps,
  );

  return { status: "regenerated" };
}

function refreshRemoteSkill(
  entry: ManifestEntry,
  dasJson: DasJson,
  mode: RefreshMode,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  const source = dasJson.source;

  if (source.type !== "github") {
    return Promise.resolve({ status: "stale" });
  }

  const ref = dasJson.trackedRef ?? "HEAD";

  if (mode.kind === "interactive" && mode.update === true) {
    return refreshRemoteWithUpdate(entry, dasJson, source, ref, deps);
  }

  if (
    mode.kind === "hook" &&
    mode.force !== true &&
    !isCheckIntervalElapsed(dasJson, deps.now())
  ) {
    return Promise.resolve({ status: "skipped" });
  }

  return checkRemoteForUpdate(entry, dasJson, source, ref, deps);
}

function refreshWithDasJson(
  entry: ManifestEntry,
  dasJson: DasJson,
  mode: RefreshMode,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  if (dasJson.source.type === "path") {
    return refreshLocalSkill(entry, dasJson, mode, deps);
  }

  return refreshRemoteSkill(entry, dasJson, mode, deps);
}

/**
 * Refresh a single skill: re-slice a local source on a content change, or
 * check (and, on an explicit interactive `--update`, fetch) a remote source's
 * tracked ref.
 *
 * A local source is re-resolved and hashed; a hash matching the skill's
 * stored `sourceHash` (and no `mode.force`) is `"unchanged"` with no writes,
 * otherwise the skill is rebuilt end to end and its das.json is rewritten
 * with the new hash and `lastRefresh`. A remote source is never cloned except
 * under `mode.kind === "interactive"` with `mode.update === true`; every other
 * path only runs `git ls-remote` against the tracked ref (gated by
 * `checkIntervalHours` in hook mode, unless `mode.force`) and reports whether
 * the pinned sha still matches. A missing or unreachable source never throws:
 * it reports `"stale"` and leaves the existing skill untouched.
 *
 * @param entry - The manifest entry identifying the skill's directory
 * @param mode - How this refresh was invoked
 * @param deps - The injected effectful functions this refresh runs through
 * @returns The outcome of the refresh attempt
 */
export async function refreshSkill(
  entry: ManifestEntry,
  mode: RefreshMode,
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  let dasJson: DasJson;

  try {
    dasJson = await deps.readDasJson(entry.skillPath);
  } catch {
    return { status: "stale" };
  }

  return refreshWithDasJson(entry, dasJson, mode, deps);
}

function isEligibleForHook(
  entry: ManifestEntry,
  currentDirectory: string,
): boolean {
  if (entry.scope === "personal") {
    return true;
  }

  const resolvedSkillPath = resolve(entry.skillPath);
  const resolvedCurrentDirectory = resolve(currentDirectory);

  return (
    resolvedSkillPath === resolvedCurrentDirectory ||
    resolvedSkillPath.startsWith(resolvedCurrentDirectory + sep)
  );
}

interface PendingLocalRegeneration {
  entry: ManifestEntry;
  dasJson: DasJson;
  files: DocFile[];
  sourceHash: string;
}

/**
 * Run the bounded, hook-mode refresh across a set of registered skills.
 *
 * Personal-scope skills are always included; project-scope skills are
 * included only when their `skillPath` is under `currentDirectory`. Remote
 * skills only ever run the `ls-remote` check (never a cap, never a clone).
 * Local skills whose fileset hash has changed are regenerated oldest
 * `lastRefresh` first, capped at 3 per run; any remainder is left untouched
 * for a future run rather than regenerated immediately. A single skill
 * erroring never stops the rest: the returned lines cover only skills with an
 * upstream update or a completed local regeneration, one line each.
 *
 * @param entries - The manifest entries to consider for this hook run
 * @param currentDirectory - The directory the hook is running from, used to scope project skills
 * @param deps - The injected effectful functions this refresh runs through
 * @returns One line per skill with an upstream update or a completed regeneration, in the order decided
 */
export async function runHookRefresh(
  entries: ManifestEntry[],
  currentDirectory: string,
  deps: RefreshDeps,
): Promise<string[]> {
  const lines: string[] = [];
  const pendingLocalRegenerations: PendingLocalRegeneration[] = [];

  for (const entry of entries) {
    if (!isEligibleForHook(entry, currentDirectory)) {
      continue;
    }

    try {
      const dasJson = await deps.readDasJson(entry.skillPath);

      if (dasJson.source.type === "github") {
        const outcome = await refreshRemoteSkill(
          entry,
          dasJson,
          { kind: "hook" },
          deps,
        );

        if (outcome.status === "update-available" && outcome.detail) {
          lines.push(outcome.detail);
        }

        continue;
      }

      const evaluation = await evaluateLocalSource(dasJson, false, deps);

      if (evaluation.kind === "needs-regeneration") {
        pendingLocalRegenerations.push({
          entry,
          dasJson,
          files: evaluation.files,
          sourceHash: evaluation.sourceHash,
        });
      }
    } catch {
      continue;
    }
  }

  const orderedForRegeneration = [...pendingLocalRegenerations].sort(
    (first, second) =>
      Date.parse(first.dasJson.lastRefresh) -
      Date.parse(second.dasJson.lastRefresh),
  );

  for (const pending of orderedForRegeneration.slice(
    0,
    LOCAL_REGENERATION_CAP,
  )) {
    try {
      await regenerateSkill(
        pending.entry,
        pending.dasJson,
        {
          files: pending.files,
          sourceHash: pending.sourceHash,
          pinnedSha: pending.dasJson.pinnedSha,
        },
        deps,
      );
      lines.push(`das: ${pending.dasJson.name} regenerated (source changed)`);
    } catch {
      continue;
    }
  }

  return lines;
}
