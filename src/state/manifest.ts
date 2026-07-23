import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { InvalidDasJsonError, readDasJson } from "../emitter/das-json.js";
import { withLock } from "./lock.js";

const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;

const CURRENT_MANIFEST_VERSION = 1;

const manifestEntrySchema = z
  .object({
    name: z.string().min(1).max(64).regex(skillNamePattern),
    skillPath: z.string().min(1),
    scope: z.enum(["personal", "project"]),
    lastCheck: z.union([z.string(), z.null()]),
    updateAvailable: z.boolean(),
  })
  .strict();

/**
 * Zod schema for the on-disk manifest.
 *
 * `.strict()` is applied at both the manifest and entry level so an unknown key is rejected
 * rather than silently stripped: the manifest is a rebuildable cache, and a tampered or
 * unexpectedly shaped entry must fail validation and trigger a rebuild instead of being trusted.
 */
export const manifestSchema = z
  .object({
    version: z.number().int().positive(),
    skills: z.array(manifestEntrySchema),
  })
  .strict();

/** A single skill's discovery pointer and volatile refresh state tracked by the manifest. */
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/**
 * The rebuildable manifest cache of discovered skills.
 *
 * The manifest is never the source of truth for a skill's identity — that lives in the
 * skill's own das.json — so every field here is either a discovery pointer (`skillPath`,
 * `scope`) or volatile state (`lastCheck`, `updateAvailable`) that {@link rebuildManifest} can
 * always regenerate from disk.
 */
export type Manifest = z.infer<typeof manifestSchema>;

/** Thrown when a manifest fails schema validation before being written. */
export class InvalidManifestError extends Error {
  constructor(reason: string) {
    super(`Invalid manifest: ${reason}`);
    this.name = "InvalidManifestError";
  }
}

/** Thrown when a path is outside every `.claude/skills` directory this process is allowed to manage. */
export class UnmanagedPathError extends Error {
  constructor(skillPath: string) {
    super(
      `Refusing to manage path outside a .claude/skills directory: ${skillPath}`,
    );
    this.name = "UnmanagedPathError";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function emptyManifest(): Manifest {
  return { version: CURRENT_MANIFEST_VERSION, skills: [] };
}

function manifestPathFor(baseDir: string): string {
  return join(baseDir, "manifest.json");
}

async function backupCorruptManifest(
  baseDir: string,
  raw: string,
  reason: string,
): Promise<void> {
  const backupPath = `${manifestPathFor(baseDir)}.bak`;
  await writeFile(backupPath, raw, "utf-8");
  process.stderr.write(
    `das: manifest.json is ${reason}; backed up to ${backupPath} and rebuilding an empty manifest\n`,
  );
}

/**
 * Load the manifest cache from `<baseDir>/manifest.json`.
 *
 * A missing file is a fresh install, not an error, and yields an empty manifest. A file that is
 * unparseable JSON or fails schema validation is backed up to `manifest.json.bak` (overwriting any
 * prior backup) and an empty manifest is returned instead of throwing, since a corrupt cache must
 * never break the tool — {@link rebuildManifest} can always regenerate it from the skills on disk.
 *
 * @param baseDir - Absolute path to the directory containing manifest.json
 * @returns The validated manifest, or an empty manifest if the file is missing or corrupt
 */
export async function loadManifest(baseDir: string): Promise<Manifest> {
  const manifestPath = manifestPathFor(baseDir);
  let raw: string;

  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return emptyManifest();
    }
    throw error;
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch {
    await backupCorruptManifest(baseDir, raw, "not valid JSON");
    return emptyManifest();
  }

  const result = manifestSchema.safeParse(parsedJson);

  if (!result.success) {
    await backupCorruptManifest(
      baseDir,
      raw,
      `invalid: ${formatZodError(result.error)}`,
    );
    return emptyManifest();
  }

  return result.data;
}

let tempFileSequence = 0;

/**
 * Validate and atomically persist the manifest to `<baseDir>/manifest.json`.
 *
 * The write happens under an advisory lock on `manifest.json.lock` (default staleness threshold)
 * so concurrent das processes never interleave writes, and via a temp-file-plus-rename in the
 * same directory so a reader never observes a partially written file. If the lock is already held
 * by a live process, this returns without writing anything: the manifest is a cache, so it is safe
 * for the write to be skipped and retried on the caller's next cycle rather than blocking or
 * corrupting the file.
 *
 * @param baseDir - Absolute path to the directory to write manifest.json into
 * @param manifest - The manifest to validate and persist
 * @throws {@link InvalidManifestError} When `manifest` fails schema validation
 */
export async function saveManifest(
  baseDir: string,
  manifest: Manifest,
): Promise<void> {
  const result = manifestSchema.safeParse(manifest);

  if (!result.success) {
    throw new InvalidManifestError(formatZodError(result.error));
  }

  const manifestPath = manifestPathFor(baseDir);
  const lockPath = `${manifestPath}.lock`;
  const validatedManifest = result.data;

  await withLock(lockPath, async () => {
    const tempPath = join(
      baseDir,
      `.manifest.json.das-tmp-${String(process.pid)}-${String(tempFileSequence)}`,
    );
    tempFileSequence += 1;

    await writeFile(
      tempPath,
      `${JSON.stringify(validatedManifest, null, 2)}\n`,
      "utf-8",
    );
    await rename(tempPath, manifestPath);
  });
}

/**
 * Derive the filesystem path a skill of the given scope and name is expected to live at.
 *
 * @param scope - Whether the skill is installed for the user (`personal`) or the project
 * @param name - The skill's name
 * @param options - Roots to derive the path from
 * @returns The expected absolute skill directory path
 * @throws {@link Error} When `scope` is `"project"` and `options.projectRoot` is not provided
 */
export function expectedSkillPath(
  scope: "personal" | "project",
  name: string,
  options: { home: string; projectRoot?: string },
): string {
  if (scope === "personal") {
    return join(options.home, ".claude", "skills", name);
  }

  if (!options.projectRoot) {
    throw new Error(
      'expectedSkillPath requires options.projectRoot for scope "project"',
    );
  }

  return join(options.projectRoot, ".claude", "skills", name);
}

function managedSkillsRoots(options: {
  home: string;
  projectRoot?: string;
}): string[] {
  const roots = [join(resolve(options.home), ".claude", "skills")];

  if (options.projectRoot) {
    roots.push(join(resolve(options.projectRoot), ".claude", "skills"));
  }

  return roots;
}

/**
 * Assert that `skillPath` resolves to a direct child of a `.claude/skills` directory under an
 * allowed root, never trusting a manifest entry's stored path.
 *
 * The manifest drives deletion, so a skill's path is re-derived and verified here rather than
 * trusted as-is: `skillPath` is resolved to its canonical form (collapsing any `..` segments),
 * and its parent directory is compared for exact equality against the home and, if given, the
 * project `.claude/skills` root. Equality, rather than a prefix check, is what keeps a
 * similarly-named sibling directory (e.g. `skills-evil`) from passing as managed.
 *
 * @param skillPath - The path to verify, typically a manifest entry's `skillPath`
 * @param options - Roots the path is allowed to be managed under
 * @throws {@link UnmanagedPathError} When `skillPath`'s parent is not an allowed `.claude/skills` root
 */
export function assertManagedPath(
  skillPath: string,
  options: { home: string; projectRoot?: string },
): void {
  const resolvedPath = resolve(skillPath);
  const parentDir = dirname(resolvedPath);
  const isManaged = managedSkillsRoots(options).some(
    (root) => parentDir === root,
  );

  if (!isManaged) {
    throw new UnmanagedPathError(resolvedPath);
  }
}

function scopeForSkillsDir(
  skillsDir: string,
  options: { home: string; projectRoot?: string },
): "personal" | "project" {
  const resolvedSkillsDir = resolve(skillsDir);
  const personalRoot = join(resolve(options.home), ".claude", "skills");

  if (resolvedSkillsDir === personalRoot) {
    return "personal";
  }

  if (options.projectRoot) {
    const projectSkillsRoot = join(
      resolve(options.projectRoot),
      ".claude",
      "skills",
    );

    if (resolvedSkillsDir === projectSkillsRoot) {
      return "project";
    }
  }

  throw new Error(`Cannot infer scope for skills directory: ${skillsDir}`);
}

async function immediateSubdirectories(dirPath: string): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dirPath, entry.name));
}

/**
 * Rebuild the manifest from scratch by scanning `.claude/skills` directories for skills with a
 * valid das.json, the source of truth for a skill's identity.
 *
 * Each directory in `skillsDirs` is scanned one level deep; a subdirectory without a valid
 * das.json is skipped rather than treated as an error, since a skills directory may contain
 * unrelated files or in-progress writes. This is the operation `das doctor` runs to recover from
 * a missing or corrupt manifest cache.
 *
 * @param skillsDirs - Absolute paths to `.claude/skills` directories to scan
 * @param options - Roots used to infer each directory's scope
 * @returns A freshly built manifest with `lastCheck: null` and `updateAvailable: false` on every entry
 * @throws {@link Error} When a directory in `skillsDirs` does not match the home or project skills root
 */
export async function rebuildManifest(
  skillsDirs: string[],
  options: { home: string; projectRoot?: string },
): Promise<Manifest> {
  const skills: ManifestEntry[] = [];

  for (const skillsDir of skillsDirs) {
    const scope = scopeForSkillsDir(skillsDir, options);
    const candidateDirs = await immediateSubdirectories(skillsDir);

    for (const candidateDir of candidateDirs) {
      let dasJson;

      try {
        dasJson = await readDasJson(candidateDir);
      } catch (error) {
        if (error instanceof InvalidDasJsonError) {
          continue;
        }
        throw error;
      }

      skills.push({
        name: dasJson.name,
        skillPath: candidateDir,
        scope,
        lastCheck: null,
        updateAvailable: false,
      });
    }
  }

  return { version: CURRENT_MANIFEST_VERSION, skills };
}
