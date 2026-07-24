import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { DasJson } from "../emitter/das-json.js";
import type { Manifest } from "../state/manifest.js";

/** The skill name and optional scope disambiguator accepted by `das remove`. */
export interface RemoveArgs {
  /** The registered skill's name. */
  name: string;
  /** Disambiguates when a personal and a project skill share `name`. */
  scope?: "personal" | "project";
  /** Delete the tracked `generatedFiles` even when foreign files are present alongside them. */
  force?: boolean;
}

/** The effectful functions {@link runRemoveCommand} depends on. */
export interface RunRemoveCommandDeps {
  /** Load the manifest cache. */
  loadManifest: (baseDir: string) => Promise<Manifest>;
  /** Validate and persist the manifest cache. */
  saveManifest: (baseDir: string, manifest: Manifest) => Promise<void>;
  /** Assert a skill path resolves under an allowed managed skills root. */
  assertManagedPath: (
    skillPath: string,
    options: { home: string; projectRoot?: string },
  ) => void;
  /** Read and validate a skill's das.json record. */
  readDasJson: (skillDir: string) => Promise<DasJson>;
  /** The user's home directory, used to derive the personal skills root. */
  home: string;
  /** The current project root, used to derive the project skills root. */
  projectRoot?: string;
  /** Absolute path to the directory containing manifest.json. */
  manifestBaseDir: string;
  /** Write a line to stdout. */
  stdout: (line: string) => void;
  /** Write a line to stderr. */
  stderr: (line: string) => void;
}

/** The result of a `das remove` invocation. */
export type RemoveOutcome =
  | {
      status: "removed";
      name: string;
      scope: "personal" | "project";
      filesDeleted: number;
    }
  | { status: "refused"; reason: string };

/** Thrown internally when a symlink is encountered anywhere inside a skill directory being removed. */
class SymlinkEncounteredError extends Error {
  constructor(public readonly path: string) {
    super(`Symlink encountered inside skill directory: ${path}`);
    this.name = "SymlinkEncounteredError";
  }
}

/** Thrown internally when a das.json `generatedFiles` entry would resolve outside the skill directory. */
class GeneratedPathEscapeError extends Error {
  constructor(skillDir: string, relativePath: string) {
    super(
      `Tracked file path escapes skill directory ${skillDir}: ${relativePath}`,
    );
    this.name = "GeneratedPathEscapeError";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function rootsFor(deps: RunRemoveCommandDeps): {
  home: string;
  projectRoot?: string;
} {
  return deps.projectRoot !== undefined
    ? { home: deps.home, projectRoot: deps.projectRoot }
    : { home: deps.home };
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

async function collectManagedFiles(
  skillDir: string,
  currentDir: string,
): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const stats = await lstat(fullPath);

    if (stats.isSymbolicLink()) {
      throw new SymlinkEncounteredError(fullPath);
    }

    if (stats.isDirectory()) {
      files.push(...(await collectManagedFiles(skillDir, fullPath)));
    } else if (stats.isFile()) {
      files.push(toPosixPath(relative(skillDir, fullPath)));
    }
  }

  return files;
}

function assertContainedInSkillDir(
  resolvedSkillDir: string,
  relativePath: string,
): string {
  const resolvedPath = resolve(resolvedSkillDir, relativePath);
  const isContained =
    resolvedPath === resolvedSkillDir ||
    resolvedPath.startsWith(resolvedSkillDir + sep);

  if (!isContained) {
    throw new GeneratedPathEscapeError(resolvedSkillDir, relativePath);
  }

  return resolvedPath;
}

async function removeEmptyDirsRecursively(dirPath: string): Promise<void> {
  let entries;

  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await removeEmptyDirsRecursively(join(dirPath, entry.name));
    }
  }

  const remaining = await readdir(dirPath);
  if (remaining.length === 0) {
    await rmdir(dirPath);
  }
}

function refuse(
  deps: RunRemoveCommandDeps,
  reason: string,
): { status: "refused"; reason: string } {
  deps.stderr(`das: ${reason}`);
  return { status: "refused", reason };
}

/**
 * Run the `das remove` command core: delete a registered skill's tracked files and drop it from
 * the manifest.
 *
 * Only the paths listed in the skill's das.json `generatedFiles` are ever deleted, never the
 * whole skill directory: a foreign file present alongside them (one not listed in
 * `generatedFiles`) refuses the whole operation unless `force` is set, and even then only the
 * tracked files are removed, leaving the foreign file and its containing directory in place.
 * `assertManagedPath` gates the target's location, but since that check is lexical only, the
 * real deletion-safety guard is here: every path inside the skill directory is `lstat`-ed before
 * anything is touched, and a symlink anywhere in the tree, including the skill directory itself,
 * refuses the operation without deleting anything. Directories left empty after their tracked
 * files are deleted, including the skill directory itself, are removed.
 *
 * @param args - The parsed `das remove` arguments and flags
 * @param deps - The injected effectful functions this run executes through
 * @returns `{ status: "removed", ... }` once the skill's tracked files and manifest entry are
 * gone, or `{ status: "refused", reason }` when a safety gate stops the run
 */
export async function runRemoveCommand(
  args: RemoveArgs,
  deps: RunRemoveCommandDeps,
): Promise<RemoveOutcome> {
  const manifest = await deps.loadManifest(deps.manifestBaseDir);
  const matches = manifest.skills.filter(
    (entry) =>
      entry.name === args.name &&
      (args.scope === undefined || entry.scope === args.scope),
  );

  if (matches.length === 0) {
    return refuse(deps, `No managed skill named "${args.name}" was found.`);
  }

  if (matches.length > 1) {
    return refuse(
      deps,
      `Multiple skills named "${args.name}" are managed (${matches
        .map((match) => match.scope)
        .join(", ")}); pass --scope to disambiguate.`,
    );
  }

  const [entry] = matches;
  if (!entry) {
    return refuse(deps, `No managed skill named "${args.name}" was found.`);
  }

  deps.assertManagedPath(entry.skillPath, rootsFor(deps));

  const resolvedSkillDir = resolve(entry.skillPath);
  let skillDirStats;

  try {
    skillDirStats = await lstat(resolvedSkillDir);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return refuse(
        deps,
        `Skill directory does not exist: ${resolvedSkillDir}`,
      );
    }
    throw error;
  }

  if (skillDirStats.isSymbolicLink()) {
    return refuse(
      deps,
      `Refusing to remove a symlinked skill directory: ${resolvedSkillDir}`,
    );
  }

  let dasJson: DasJson;
  try {
    dasJson = await deps.readDasJson(resolvedSkillDir);
  } catch {
    return refuse(
      deps,
      `Refusing to remove unmanaged target (no valid das.json): ${resolvedSkillDir}`,
    );
  }

  let managedFiles: string[];
  try {
    managedFiles = await collectManagedFiles(
      resolvedSkillDir,
      resolvedSkillDir,
    );
  } catch (error) {
    if (error instanceof SymlinkEncounteredError) {
      return refuse(
        deps,
        `Refusing to remove: symlink found inside skill directory at ${error.path}`,
      );
    }
    throw error;
  }

  const generatedSet = new Set(dasJson.generatedFiles);
  const foreignFiles = managedFiles.filter((file) => !generatedSet.has(file));

  if (foreignFiles.length > 0 && args.force !== true) {
    return refuse(
      deps,
      `Refusing to remove "${entry.name}": foreign file(s) present that are not tracked in das.json: ${foreignFiles.join(", ")}. Re-run with --force to delete only the tracked files and leave these untouched.`,
    );
  }

  let filesDeleted = 0;
  for (const relativePath of dasJson.generatedFiles) {
    const resolvedPath = assertContainedInSkillDir(
      resolvedSkillDir,
      relativePath,
    );

    try {
      await unlink(resolvedPath);
      filesDeleted += 1;
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  await removeEmptyDirsRecursively(resolvedSkillDir);

  const updatedManifest: Manifest = {
    ...manifest,
    skills: manifest.skills.filter(
      (candidate) =>
        !(candidate.name === entry.name && candidate.scope === entry.scope),
    ),
  };
  await deps.saveManifest(deps.manifestBaseDir, updatedManifest);

  deps.stdout(
    `das: removed skill "${entry.name}" (${entry.scope}); deleted ${String(filesDeleted)} file(s)`,
  );

  return {
    status: "removed",
    name: entry.name,
    scope: entry.scope,
    filesDeleted,
  };
}
