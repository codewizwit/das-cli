import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const defaultTimeoutMs = 120000;
const shaLinePattern = /^[0-9a-f]{40}(?=\s)/;

/**
 * Executes a git argument vector and reports its stdout and exit code.
 *
 * Implementations must never invoke a shell: `args` is passed straight to the process as an
 * argument vector, so callers can safely embed untrusted values (a URL, ref, or sha) without risk
 * of shell metacharacter injection.
 *
 * @param args - The git subcommand and its arguments, e.g. `["ls-remote", "--", url, ref]`
 * @param options - The environment to run git with and the timeout, in milliseconds, before killing it
 * @returns The captured stdout and process exit code
 */
export type GitRunner = (
  args: string[],
  options: { env: Record<string, string>; timeoutMs: number },
) => Promise<{ stdout: string; exitCode: number }>;

/** Thrown when a git subprocess exits nonzero or produces output that cannot be parsed. */
export class GitOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitOperationError";
  }
}

/**
 * Build the exact environment git subprocesses run with.
 *
 * Only `process.env.PATH` is passed through from the parent process; every other parent
 * environment variable (credentials, tokens, proxies a user has set for unrelated tools) is
 * deliberately left out. The four git-specific variables disable interactive credential prompts,
 * disable askpass helpers, ignore system-wide git config that could redefine protocol handlers,
 * and skip Git LFS smudge filters that would otherwise fetch additional content unprompted.
 *
 * @returns The environment to pass to every git subprocess this module spawns
 */
export function buildGitEnv(): Record<string, string> {
  const base: Record<string, string> =
    process.env.PATH === undefined ? {} : { PATH: process.env.PATH };

  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
  };
}

const defaultGitRunner: GitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { env: options.env, timeout: options.timeoutMs },
      (error, stdout) => {
        if (error === null) {
          resolve({ stdout, exitCode: 0 });
          return;
        }

        if (typeof error.code === "number") {
          resolve({ stdout, exitCode: error.code });
          return;
        }

        reject(new Error(error.message, { cause: error }));
      },
    );
  });

/**
 * Resolve a ref on a remote to its 40-character commit sha via `git ls-remote`.
 *
 * @param url - The remote repository URL
 * @param ref - The branch, tag, or ref to resolve
 * @param runner - The git process runner; defaults to a hardened `execFile`-based runner
 * @returns The resolved commit sha
 * @throws {@link GitOperationError} When git exits nonzero or its output contains no valid sha
 */
export async function lsRemote(
  url: string,
  ref: string,
  runner: GitRunner = defaultGitRunner,
): Promise<string> {
  const result = await runner(["ls-remote", "--", url, ref], {
    env: buildGitEnv(),
    timeoutMs: defaultTimeoutMs,
  });

  if (result.exitCode !== 0) {
    throw new GitOperationError(
      `git ls-remote failed for ${url}#${ref} with exit code ${String(result.exitCode)}`,
    );
  }

  const firstLine = result.stdout.split("\n")[0] ?? "";
  const match = shaLinePattern.exec(firstLine);

  if (match === null) {
    throw new GitOperationError(
      `git ls-remote returned no resolvable sha for ${url}#${ref}`,
    );
  }

  return match[0];
}

/**
 * Clone a repository at an exact commit sha into `destination`.
 *
 * A single `git clone` cannot land on an arbitrary sha: cloning fetches only the default branch's
 * tip, so this runs three git calls in sequence. First, a shallow, blob-filtered, no-submodule
 * clone with every protocol and symlink hardening flag set. Second, a depth-1 fetch of the exact
 * sha from `origin`, since the clone may have landed on a different commit. Third, a checkout of
 * that sha. Any nonzero exit aborts the sequence.
 *
 * @param url - The remote repository URL to clone
 * @param sha - The exact commit sha to check out
 * @param destination - The local directory to clone into; must not already exist
 * @param runner - The git process runner; defaults to a hardened `execFile`-based runner
 * @throws {@link GitOperationError} When any of the clone, fetch, or checkout steps exits nonzero
 */
export async function cloneAtSha(
  url: string,
  sha: string,
  destination: string,
  runner: GitRunner = defaultGitRunner,
): Promise<void> {
  const env = buildGitEnv();
  const runOptions = { env, timeoutMs: defaultTimeoutMs };

  const cloneResult = await runner(
    [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "-c",
      "protocol.ext.allow=never",
      "-c",
      "protocol.file.allow=never",
      "-c",
      "core.symlinks=false",
      "--no-recurse-submodules",
      "--",
      url,
      destination,
    ],
    runOptions,
  );

  if (cloneResult.exitCode !== 0) {
    throw new GitOperationError(
      `git clone failed for ${url} with exit code ${String(cloneResult.exitCode)}`,
    );
  }

  const fetchResult = await runner(
    ["-C", destination, "fetch", "--depth", "1", "--", "origin", sha],
    runOptions,
  );

  if (fetchResult.exitCode !== 0) {
    throw new GitOperationError(
      `git fetch failed for ${sha} in ${destination} with exit code ${String(fetchResult.exitCode)}`,
    );
  }

  const checkoutResult = await runner(
    ["-C", destination, "checkout", sha],
    runOptions,
  );

  if (checkoutResult.exitCode !== 0) {
    throw new GitOperationError(
      `git checkout failed for ${sha} in ${destination} with exit code ${String(checkoutResult.exitCode)}`,
    );
  }
}

/**
 * Clone a repository at an exact sha into a fresh temp directory, run `callback` against it, and
 * always remove the temp directory afterward.
 *
 * @param url - The remote repository URL to clone
 * @param sha - The exact commit sha to check out
 * @param callback - Invoked with the absolute path to the cloned directory
 * @param runner - The git process runner; defaults to a hardened `execFile`-based runner
 * @returns Whatever `callback` resolves to
 * @throws {@link GitOperationError} When the clone fails
 */
export async function withTempClone<T>(
  url: string,
  sha: string,
  callback: (dir: string) => Promise<T>,
  runner?: GitRunner,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), "das-git-clone-"));

  try {
    await cloneAtSha(url, sha, tempDir, runner);
    return await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
