import { basename, join, resolve } from "node:path";
import type { ParsedGithubUrl } from "../resolver/github-url.js";
import {
  InvalidDasJsonError,
  SLICER_VERSION,
  dasJsonSchema,
  type DasJson,
} from "../emitter/das-json.js";
import type { RenderContext } from "../emitter/render.js";
import type { InjectionFinding } from "../scan/injection.js";
import type { EmissionPlan } from "../slicer/emit-plan.js";
import type { HashParams } from "../state/hash.js";
import type { Manifest, ManifestEntry } from "../state/manifest.js";
import { sanitizeSlug } from "../markdown/slug.js";
import type { DocFile, DocNode, EmitFile, SourceRef } from "../types.js";

/** The default per-file token budget applied when `--token-budget` is not given. */
export const DEFAULT_TOKEN_BUDGET = 4000;
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
const DEFAULT_DESCRIPTION_MAX_LENGTH = 1024;
const markdownExtensionPattern = /\.(md|mdx|markdown)$/i;

/** Flags and the source argument accepted by `das add`. */
export interface AddArgs {
  /** The GitHub URL or local path the user passed as the source. */
  source: string;
  /** Install scope; prompted for when omitted and not `--yes`. */
  scope?: "personal" | "project";
  /** Skill name; defaults to a slugified title when omitted. */
  name?: string;
  /** Skill description; defaults to the neutral template when omitted. */
  description?: string;
  /** Whether the SessionStart hook may be offered/installed; `false` for `--no-hook`. Defaults to `true`. */
  hook?: boolean;
  /** Accept every default non-interactively; still aborts on scan findings or an unforced collision. */
  yes?: boolean;
  /** Include files over the 1MB size guard. Defaults to `false`. */
  includeLarge?: boolean;
  /** Per-file token budget. Defaults to {@link DEFAULT_TOKEN_BUDGET}. */
  tokenBudget?: number;
  /** Overwrite a name collision with a skill from a different source. */
  force?: boolean;
}

/** Interactive prompts the wizard step of `runAdd` drives; injected so tests never touch a real TTY. */
export interface AddPrompts {
  /** Prompt for install scope, given the default. */
  scope: (
    defaultScope: "personal" | "project",
  ) => Promise<"personal" | "project">;
  /** Prompt for the skill name, given the derived default. */
  name: (defaultName: string) => Promise<string>;
  /** Prompt for the skill description, given the neutral template default. */
  description: (defaultDescription: string) => Promise<string>;
  /** Prompt whether to install the SessionStart hook, given the default answer. */
  installHook: (defaultValue: boolean) => Promise<boolean>;
  /** Prompt whether to proceed given the injection scan findings. */
  confirmScanFindings: (findings: InjectionFinding[]) => Promise<boolean>;
  /** Prompt whether to overwrite an existing skill registered against a different source. */
  confirmCollision: (
    name: string,
    existingSource: DasJson["source"],
  ) => Promise<boolean>;
}

/** The effectful functions {@link runAdd} depends on; production code wires the real pipeline, tests wire fakes. */
export interface RunAddDeps {
  /** Parse a source string as a GitHub URL; throws when it is not one. */
  parseGithubUrl: (input: string) => ParsedGithubUrl;
  /** Resolve a ref on a remote to its current commit sha. */
  lsRemote: (url: string, ref: string) => Promise<string>;
  /** Resolve a source ref into its documentation fileset. */
  resolveSource: (
    ref: SourceRef,
    options: { includeLarge: boolean; pinnedSha?: string },
  ) => Promise<DocFile[]>;
  /**
   * Build a normalized, collapsed, sized documentation tree from a fileset; production code wires
   * `buildSizedTree` from `src/slicer/build-sized-tree.ts`, which composes `buildTree`,
   * `collapseSingleChildChains`, and `sizeTree` in the order the collapse guarantee requires.
   */
  buildSizedTree: (files: DocFile[], rootName: string) => DocNode;
  /** Decide which nodes of a sized tree become which emitted files. */
  planEmission: (
    root: DocNode,
    options: { tokenBudget: number },
  ) => EmissionPlan;
  /** Render an emission plan's structure into full file contents. */
  renderSkillPlan: (plan: EmissionPlan, context: RenderContext) => EmitFile[];
  /** Scan rendered skill files for prompt-injection tripwire patterns. */
  scanForInjection: (files: EmitFile[]) => InjectionFinding[];
  /** Write a complete skill directory tree, replacing any existing tree atomically. */
  writeSkillTransactional: (
    skillDir: string,
    files: EmitFile[],
  ) => Promise<void>;
  /** Read and validate a skill's das.json record. */
  readDasJson: (skillDir: string) => Promise<DasJson>;
  /** Compute a deterministic digest of a fileset and its generation parameters. */
  hashFileset: (files: DocFile[], params: HashParams) => string;
  /** Load the manifest cache. */
  loadManifest: (baseDir: string) => Promise<Manifest>;
  /** Validate and persist the manifest cache. */
  saveManifest: (baseDir: string, manifest: Manifest) => Promise<void>;
  /** Derive the filesystem path a skill of the given scope and name is expected to live at. */
  expectedSkillPath: (
    scope: "personal" | "project",
    name: string,
    options: { home: string; projectRoot?: string },
  ) => string;
  /** Assert a skill path resolves under an allowed managed skills root. */
  assertManagedPath: (
    skillPath: string,
    options: { home: string; projectRoot?: string },
  ) => void;
  /** Check whether the DAS SessionStart hook is already installed in a settings file, without mutating it. */
  hasSessionStartHook: (settingsPath: string) => Promise<boolean>;
  /** Install the DAS SessionStart hook into a settings file. */
  installSessionStartHook: (
    settingsPath: string,
  ) => Promise<"installed" | "already-present">;
  /** The interactive wizard prompts, skipped entirely under `--yes`. */
  prompts: AddPrompts;
  /** The current time, in epoch milliseconds. */
  now: () => number;
  /** Write a line to stdout. */
  stdout: (line: string) => void;
  /** Write a line to stderr. */
  stderr: (line: string) => void;
  /** The user's home directory, used to derive the personal skills root. */
  home: string;
  /** The current project root, required when `scope` is `"project"`. */
  projectRoot?: string;
  /** Absolute path to the directory containing manifest.json. */
  manifestBaseDir: string;
  /** The das-cli package version, recorded in every das.json as `dasVersion`. */
  dasVersion: string;
}

/** The result of a completed or aborted `das add` run. */
export type AddOutcome =
  | {
      status: "written";
      scope: "personal" | "project";
      name: string;
      skillPath: string;
      fileCount: number;
      hookInstalled: boolean;
      /** Present when `hookInstalled` is `false` because the install itself failed, not because it was skipped. */
      hookError?: string;
    }
  | { status: "aborted"; reason: string };

const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const knownDocsFolderNames = new Set(["docs", "documentation", "doc"]);

/** Thrown when a resolved skill name (from `--name`, the wizard, or the default) is not a valid slug. */
export class InvalidSkillNameError extends Error {
  constructor(name: string, suggested: string) {
    super(
      `Invalid skill name "${name}": must match ^[a-z0-9][a-z0-9-]*$ (for example "${suggested}"). Pass --name with a valid slug instead.`,
    );
    this.name = "InvalidSkillNameError";
  }
}

/** Thrown when `--token-budget` is not a positive integer. */
export class InvalidTokenBudgetError extends Error {
  constructor(value: unknown) {
    super(
      `Invalid token budget: ${String(value)}. Must be a positive integer.`,
    );
    this.name = "InvalidTokenBudgetError";
  }
}

function assertValidSkillName(name: string): void {
  if (!skillNamePattern.test(name)) {
    throw new InvalidSkillNameError(name, sanitizeSlug(name));
  }
}

function resolveTokenBudget(rawTokenBudget: number | undefined): number {
  if (rawTokenBudget === undefined) {
    return DEFAULT_TOKEN_BUDGET;
  }

  if (!Number.isInteger(rawTokenBudget) || rawTokenBudget <= 0) {
    throw new InvalidTokenBudgetError(rawTokenBudget);
  }

  return rawTokenBudget;
}

function humanizeSegment(segment: string): string {
  return segment.replace(/[-_]+/g, " ").trim();
}

function repoNameFromUrl(url: string): string {
  const segments = url.split("/");
  const last = segments[segments.length - 1] ?? "";
  return last.replace(/\.git$/i, "");
}

function deriveLocalKind(sourcePath: string): "file" | "folder" | "project" {
  if (markdownExtensionPattern.test(sourcePath)) {
    return "file";
  }

  return knownDocsFolderNames.has(basename(sourcePath).toLowerCase())
    ? "folder"
    : "project";
}

function deriveTitle(ref: SourceRef): string {
  if (ref.type === "github") {
    return humanizeSegment(repoNameFromUrl(ref.url));
  }

  const base = basename(ref.path);
  const nameWithoutExtension =
    ref.kind === "file" ? base.replace(/\.[^.]+$/, "") : base;
  return humanizeSegment(nameWithoutExtension);
}

function deriveSourceLabel(ref: SourceRef): string {
  if (ref.type === "path") {
    return ref.path;
  }

  return ref.subpath ? `${ref.url}/${ref.subpath}` : ref.url;
}

function buildDefaultDescription(
  title: string,
  sourceLabel: string,
  topLevelSectionNames: string[],
): string {
  const coversClause =
    topLevelSectionNames.length > 0
      ? ` Covers: ${topLevelSectionNames.join(", ")}.`
      : "";
  const full = `Reference documentation for ${title}, sliced from ${sourceLabel}.${coversClause}`;

  return full.length > DEFAULT_DESCRIPTION_MAX_LENGTH
    ? full.slice(0, DEFAULT_DESCRIPTION_MAX_LENGTH)
    : full;
}

function parseSource(
  source: string,
  deps: RunAddDeps,
): { ref: SourceRef; trackedRef: string | null } {
  try {
    const parsed = deps.parseGithubUrl(source);
    return {
      ref: { type: "github", url: parsed.url, subpath: parsed.subpath },
      trackedRef: parsed.ref,
    };
  } catch {
    const resolvedPath = resolve(source);
    return {
      ref: {
        type: "path",
        path: resolvedPath,
        kind: deriveLocalKind(resolvedPath),
      },
      trackedRef: null,
    };
  }
}

function sourcesMatch(existing: DasJson["source"], ref: SourceRef): boolean {
  if (existing.type !== ref.type) {
    return false;
  }

  if (existing.type === "github" && ref.type === "github") {
    return existing.url === ref.url && existing.subpath === ref.subpath;
  }

  if (existing.type === "path" && ref.type === "path") {
    return existing.path === ref.path && existing.kind === ref.kind;
  }

  return false;
}

function rootsFor(deps: RunAddDeps): { home: string; projectRoot?: string } {
  return deps.projectRoot !== undefined
    ? { home: deps.home, projectRoot: deps.projectRoot }
    : { home: deps.home };
}

function settingsPathFor(
  scope: "personal" | "project",
  deps: RunAddDeps,
): string {
  if (scope === "personal") {
    return join(deps.home, ".claude", "settings.json");
  }

  if (!deps.projectRoot) {
    throw new Error('runAdd requires deps.projectRoot for scope "project"');
  }

  return join(deps.projectRoot, ".claude", "settings.json");
}

function formatValidationIssues(
  issues: { path: PropertyKey[]; message: string }[],
): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function buildDasJsonEmitFile(skillDir: string, data: DasJson): EmitFile {
  const validation = dasJsonSchema.safeParse(data);

  if (!validation.success) {
    throw new InvalidDasJsonError(
      skillDir,
      formatValidationIssues(validation.error.issues),
    );
  }

  return {
    relativePath: "das.json",
    content: `${JSON.stringify(validation.data, null, 2)}\n`,
  };
}

function buildOversizedWarning(plan: EmissionPlan): string | undefined {
  const paths = [...plan.oversized, ...plan.oversizedIndexes];
  if (paths.length === 0) {
    return undefined;
  }

  return `das: warning: ${String(paths.length)} generated file(s) exceed the token budget and were emitted whole: ${paths.join(", ")}`;
}

function printPreview(
  deps: RunAddDeps,
  preview: {
    name: string;
    description: string;
    plan: EmissionPlan;
    findings: InjectionFinding[];
  },
): void {
  deps.stdout(`Skill name: ${preview.name}`);
  deps.stdout(`Description: ${preview.description}`);
  deps.stdout("Sections:");
  for (const file of preview.plan.files) {
    deps.stdout(`  ${file.relativePath}`);
  }

  if (preview.findings.length > 0) {
    deps.stdout(
      `Injection scan flagged ${String(preview.findings.length)} finding(s):`,
    );
    for (const finding of preview.findings) {
      deps.stdout(
        `  ${finding.relativePath}:${String(finding.line)} [${finding.pattern}] ${finding.excerpt}`,
      );
    }
  }
}

/**
 * Run the full `das add` pipeline: resolve a source, pin a GitHub ref, slice it into a skill,
 * scan the result for injection tripwires, walk the wizard (or take flag/`--yes` defaults),
 * gate on scan findings and name collisions, and write the skill, its das.json, and the manifest
 * entry.
 *
 * Every effectful step is delegated to `deps`, so this function performs no real I/O, network, or
 * TTY access itself: production wiring supplies the real resolver/slicer/emitter/state functions
 * and the real interactive wizard, and tests supply fakes.
 *
 * @param args - The parsed `das add` arguments and flags
 * @param deps - The injected effectful functions this run executes through
 * @returns `{ status: "written", ... }` once the skill is on disk and registered, or
 * `{ status: "aborted", reason }` when the scan gate or a name collision stops the run
 * @throws When resolving the source fails, including an empty fileset
 */
export async function runAdd(
  args: AddArgs,
  deps: RunAddDeps,
): Promise<AddOutcome> {
  const yes = args.yes ?? false;
  const includeLarge = args.includeLarge ?? false;
  const tokenBudget = resolveTokenBudget(args.tokenBudget);
  const hookFlag = args.hook ?? true;
  const force = args.force ?? false;

  const { ref: sourceRef, trackedRef } = parseSource(args.source, deps);

  let pinnedSha: string | null = null;
  if (sourceRef.type === "github") {
    pinnedSha = await deps.lsRemote(sourceRef.url, trackedRef ?? "HEAD");
  }

  const docFiles = await deps.resolveSource(sourceRef, {
    includeLarge,
    ...(pinnedSha !== null ? { pinnedSha } : {}),
  });

  const title = deriveTitle(sourceRef);
  const sourceLabel = deriveSourceLabel(sourceRef);

  const sizedRoot = deps.buildSizedTree(docFiles, title);
  const plan = deps.planEmission(sizedRoot, { tokenBudget });

  const defaultName = sanitizeSlug(title);
  const topLevelSectionNames = sizedRoot.children.map((child) => child.name);
  const defaultDescription = buildDefaultDescription(
    title,
    sourceLabel,
    topLevelSectionNames,
  );

  const nameForPreview = args.name ?? defaultName;
  const descriptionForPreview = args.description ?? defaultDescription;

  const previewFiles = deps.renderSkillPlan(plan, {
    skillName: nameForPreview,
    description: descriptionForPreview,
    sourceLabel,
  });

  const findings = deps.scanForInjection(previewFiles);

  printPreview(deps, {
    name: nameForPreview,
    description: descriptionForPreview,
    plan,
    findings,
  });

  const scope: "personal" | "project" =
    args.scope ?? (yes ? "personal" : await deps.prompts.scope("personal"));

  const name =
    args.name ?? (yes ? defaultName : await deps.prompts.name(defaultName));
  assertValidSkillName(name);

  const description =
    args.description ??
    (yes
      ? defaultDescription
      : await deps.prompts.description(defaultDescription));

  let installHook = false;
  if (hookFlag) {
    const hookAlreadyPresent = await deps.hasSessionStartHook(
      settingsPathFor(scope, deps),
    );
    if (!hookAlreadyPresent) {
      installHook = yes ? true : await deps.prompts.installHook(true);
    }
  }

  if (findings.length > 0) {
    if (yes) {
      return {
        status: "aborted",
        reason:
          "Injection scan flagged content in the generated skill; aborting because --yes was passed. Re-run interactively to review and confirm.",
      };
    }

    const confirmed = await deps.prompts.confirmScanFindings(findings);
    if (!confirmed) {
      return {
        status: "aborted",
        reason: "Declined to proceed after injection scan findings.",
      };
    }
  }

  const skillDir = deps.expectedSkillPath(scope, name, rootsFor(deps));

  let existingDasJson: DasJson | undefined;
  try {
    existingDasJson = await deps.readDasJson(skillDir);
  } catch {
    existingDasJson = undefined;
  }

  if (existingDasJson && !sourcesMatch(existingDasJson.source, sourceRef)) {
    if (!force) {
      if (yes) {
        return {
          status: "aborted",
          reason: `A different skill already exists at "${name}" (${scope}); re-run with --force to overwrite.`,
        };
      }

      const confirmed = await deps.prompts.confirmCollision(
        name,
        existingDasJson.source,
      );
      if (!confirmed) {
        return {
          status: "aborted",
          reason:
            "Declined to overwrite an existing skill from a different source.",
        };
      }
    }
  }

  deps.assertManagedPath(skillDir, rootsFor(deps));

  const finalRenderedFiles =
    name === nameForPreview && description === descriptionForPreview
      ? previewFiles
      : deps.renderSkillPlan(plan, {
          skillName: name,
          description,
          sourceLabel,
        });

  const sourceHash = deps.hashFileset(docFiles, {
    slicerVersion: SLICER_VERSION,
    tokenBudget,
    includeLarge,
  });

  const dasJsonData: DasJson = {
    dasVersion: deps.dasVersion,
    slicerVersion: SLICER_VERSION,
    name,
    source: sourceRef,
    trackedRef: sourceRef.type === "github" ? (trackedRef ?? "HEAD") : null,
    pinnedSha: sourceRef.type === "github" ? pinnedSha : null,
    sourceHash,
    tokenBudget,
    includeLarge,
    checkIntervalHours: DEFAULT_CHECK_INTERVAL_HOURS,
    lastRefresh: new Date(deps.now()).toISOString(),
    generatedFiles: [
      ...finalRenderedFiles.map((file) => file.relativePath),
      "das.json",
    ],
  };

  const dasJsonEmitFile = buildDasJsonEmitFile(skillDir, dasJsonData);

  await deps.writeSkillTransactional(skillDir, [
    ...finalRenderedFiles,
    dasJsonEmitFile,
  ]);

  const manifest = await deps.loadManifest(deps.manifestBaseDir);
  const newEntry: ManifestEntry = {
    name,
    skillPath: skillDir,
    scope,
    lastCheck: new Date(deps.now()).toISOString(),
    updateAvailable: false,
  };
  const existingIndex = manifest.skills.findIndex(
    (entry) => entry.name === name && entry.scope === scope,
  );
  if (existingIndex === -1) {
    manifest.skills.push(newEntry);
  } else {
    manifest.skills[existingIndex] = newEntry;
  }
  await deps.saveManifest(deps.manifestBaseDir, manifest);

  let hookInstalled = false;
  let hookError: string | undefined;
  if (installHook) {
    try {
      const result = await deps.installSessionStartHook(
        settingsPathFor(scope, deps),
      );
      hookInstalled = result === "installed";
    } catch (error) {
      hookError = error instanceof Error ? error.message : String(error);
    }
  }

  deps.stdout(
    `das: created skill "${name}" at ${skillDir} (${String(dasJsonData.generatedFiles.length)} files)`,
  );
  const oversizedWarning = buildOversizedWarning(plan);
  if (oversizedWarning !== undefined) {
    deps.stdout(oversizedWarning);
  }
  if (hookError !== undefined) {
    deps.stdout(`das: could not install the SessionStart hook: ${hookError}`);
  } else {
    deps.stdout(
      hookInstalled
        ? "das: installed the SessionStart hook"
        : "das: SessionStart hook not installed",
    );
  }

  return {
    status: "written",
    scope,
    name,
    skillPath: skillDir,
    fileCount: dasJsonData.generatedFiles.length,
    hookInstalled,
    ...(hookError !== undefined ? { hookError } : {}),
  };
}
