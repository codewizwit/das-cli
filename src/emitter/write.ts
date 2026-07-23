import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { EmitFile } from "../types.js";
import { InvalidDasJsonError, readDasJson } from "./das-json.js";

/** Thrown when an {@link EmitFile}'s relative path would resolve outside the skill directory. */
export class PathEscapeError extends Error {
  constructor(skillDir: string, relativePath: string) {
    super(`File path escapes skill directory ${skillDir}: ${relativePath}`);
    this.name = "PathEscapeError";
  }
}

/** Thrown when an existing target directory is not a das.json-owned skill and cannot be safely replaced. */
export class UnownedTargetError extends Error {
  constructor(skillDir: string, reason: string) {
    super(`Refusing to write to unowned target ${skillDir}: ${reason}`);
    this.name = "UnownedTargetError";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function assertContained(
  resolvedSkillDir: string,
  relativePath: string,
): string {
  const resolvedPath = resolve(resolvedSkillDir, relativePath);
  const isContained =
    resolvedPath === resolvedSkillDir ||
    resolvedPath.startsWith(resolvedSkillDir + sep);

  if (!isContained) {
    throw new PathEscapeError(resolvedSkillDir, relativePath);
  }

  return resolvedPath;
}

async function assertOwnable(resolvedSkillDir: string): Promise<boolean> {
  let stats;

  try {
    stats = await lstat(resolvedSkillDir);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new UnownedTargetError(
      resolvedSkillDir,
      "skill directory is a symlink",
    );
  }

  try {
    await readDasJson(resolvedSkillDir);
  } catch (error) {
    if (error instanceof InvalidDasJsonError) {
      throw new UnownedTargetError(resolvedSkillDir, error.message);
    }
    throw error;
  }

  return true;
}

let tempDirSequence = 0;

async function createTempSiblingDir(
  parentDir: string,
  skillDirName: string,
): Promise<string> {
  for (;;) {
    const candidate = join(
      parentDir,
      `.${skillDirName}.das-tmp-${String(process.pid)}-${String(tempDirSequence)}`,
    );
    tempDirSequence += 1;

    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
}

async function swapIntoPlace(
  resolvedSkillDir: string,
  tempDir: string,
  targetExisted: boolean,
): Promise<void> {
  const parentDir = dirname(resolvedSkillDir);
  const asideDir = join(
    parentDir,
    `.${basename(resolvedSkillDir)}.das-old-${String(process.pid)}`,
  );

  if (targetExisted) {
    await rename(resolvedSkillDir, asideDir);
  }

  try {
    await rename(tempDir, resolvedSkillDir);
  } catch (swapError) {
    if (targetExisted) {
      try {
        await rename(asideDir, resolvedSkillDir);
      } catch (restoreError) {
        throw new AggregateError(
          [swapError, restoreError],
          `Failed to swap in the new skill tree for ${resolvedSkillDir} and failed to restore the previous tree from ${asideDir}; manual recovery required`,
        );
      }
    }
    throw swapError;
  }

  if (targetExisted) {
    await rm(asideDir, { recursive: true, force: true });
  }
}

/**
 * Write a complete skill directory tree, replacing any existing tree atomically.
 *
 * Every file's relative path is checked against `skillDir` before anything is written, and
 * an existing `skillDir` must already contain a valid das.json or the write is refused
 * entirely, so this can never clobber a hand-written directory. The new tree is built in a
 * temporary sibling directory on the same parent and swapped into place with directory
 * renames, so an observer only ever sees the complete old tree or the complete new one.
 *
 * @param skillDir - Absolute path to the skill directory to write
 * @param files - The complete set of files the resulting skill directory should contain
 * @throws {@link PathEscapeError} When a file's relative path resolves outside `skillDir`
 * @throws {@link UnownedTargetError} When `skillDir` exists but is a symlink or lacks a valid das.json
 */
export async function writeSkillTransactional(
  skillDir: string,
  files: EmitFile[],
): Promise<void> {
  const resolvedSkillDir = resolve(skillDir);

  const resolvedFiles = files.map((file) => ({
    file,
    resolvedPath: assertContained(resolvedSkillDir, file.relativePath),
  }));

  const targetExisted = await assertOwnable(resolvedSkillDir);

  const parentDir = dirname(resolvedSkillDir);
  await mkdir(parentDir, { recursive: true });
  const tempDir = await createTempSiblingDir(
    parentDir,
    basename(resolvedSkillDir),
  );

  try {
    for (const { file, resolvedPath } of resolvedFiles) {
      const relativeToSkillDir = relative(resolvedSkillDir, resolvedPath);
      const tempFilePath = join(tempDir, relativeToSkillDir);
      await mkdir(dirname(tempFilePath), { recursive: true });
      await writeFile(tempFilePath, file.content, "utf-8");
    }

    await swapIntoPlace(resolvedSkillDir, tempDir, targetExisted);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
