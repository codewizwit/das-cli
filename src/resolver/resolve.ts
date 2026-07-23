import path from "node:path";
import type { DocFile, SourceRef } from "../types.js";
import { UnsupportedSourceError } from "./github-url.js";
import { lsRemote, withTempClone, type GitRunner } from "./git.js";
import { resolveLocal } from "./local.js";

/** The default total content byte cap enforced by {@link resolveSource}. */
export const defaultMaxTotalContentBytes = 100 * 1024 * 1024;
/** The default file-count cap enforced by {@link resolveSource}. */
export const defaultMaxFileCount = 5000;
const headRef = "HEAD";

/** Options controlling how {@link resolveSource} resolves and validates a source. */
export interface ResolveSourceOptions {
  /** When true, files over the 1MB size guard are included instead of skipped. */
  includeLarge: boolean;
  /** Commit sha to check out for a `github` ref instead of resolving `HEAD` via `git ls-remote`. */
  pinnedSha?: string;
  /** Git process runner used for `ls-remote` and clone operations; defaults to a hardened `execFile` runner. */
  gitRunner?: GitRunner;
  /** File-count cap enforced on the resolved fileset; defaults to {@link defaultMaxFileCount}. */
  maxFiles?: number;
  /** Total content byte cap enforced on the resolved fileset; defaults to {@link defaultMaxTotalContentBytes}. */
  maxBytes?: number;
}

/** Thrown when a resolved GitHub source exceeds the file-count or content-size cap. */
export class SourceTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceTooLargeError";
  }
}

function assertWithinCaps(
  docFiles: DocFile[],
  maxFileCount: number,
  maxTotalContentBytes: number,
): void {
  if (docFiles.length > maxFileCount) {
    throw new SourceTooLargeError(
      `Source exceeds the ${String(maxFileCount)}-file cap: found ${String(docFiles.length)} files.`,
    );
  }

  const totalContentBytes = docFiles.reduce(
    (total, docFile) => total + Buffer.byteLength(docFile.content, "utf-8"),
    0,
  );

  if (totalContentBytes > maxTotalContentBytes) {
    throw new SourceTooLargeError(
      `Source exceeds the ${String(maxTotalContentBytes)}-byte content cap: found ${String(totalContentBytes)} bytes.`,
    );
  }
}

function createSubpathEscapeError(
  subpath: string | null,
): UnsupportedSourceError {
  const error = new UnsupportedSourceError(subpath ?? "");
  error.message = `Subpath escapes the repository root: "${subpath ?? ""}"`;
  return error;
}

function resolveSubpathWithinClone(
  cloneRootPath: string,
  subpath: string | null,
): string {
  const resolvedCloneRootPath = path.resolve(cloneRootPath);
  const targetPath = path.resolve(resolvedCloneRootPath, subpath ?? "");
  const relativeToRoot = path.relative(resolvedCloneRootPath, targetPath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw createSubpathEscapeError(subpath);
  }

  return targetPath;
}

async function resolveGithubRef(
  ref: Extract<SourceRef, { type: "github" }>,
  options: ResolveSourceOptions,
): Promise<DocFile[]> {
  const sha =
    options.pinnedSha ?? (await lsRemote(ref.url, headRef, options.gitRunner));

  return withTempClone(
    ref.url,
    sha,
    (cloneDirectoryPath) => {
      const targetPath = resolveSubpathWithinClone(
        cloneDirectoryPath,
        ref.subpath,
      );
      return resolveLocal(targetPath, {
        includeLarge: options.includeLarge,
      });
    },
    options.gitRunner,
  );
}

/**
 * Resolve a source reference — a local path or a GitHub repository — into an ordered set of
 * documentation files.
 *
 * A `path` ref delegates directly to {@link resolveLocal}; `kind` is informational only, since
 * `resolveLocal` already discovers whether the path is a file, a docs folder, or a project root. A
 * `github` ref resolves its commit sha (from `options.pinnedSha` when given, otherwise `HEAD` via
 * `git ls-remote`), clones that sha into a temporary directory, and resolves the fileset from
 * `subpath` within the clone (or the clone root when `subpath` is null); the temporary directory is
 * always removed afterward. Either way, the resolved fileset is checked against the content and
 * file-count caps (`options.maxBytes`/`options.maxFiles`, defaulting to
 * {@link defaultMaxTotalContentBytes} and {@link defaultMaxFileCount}) before being returned, since
 * a local source can be just as oversized as a cloned one.
 *
 * @param ref - The source to resolve
 * @param options - Resolution options
 * @returns The ordered, processed fileset
 * @throws {@link UnsupportedSourceError} When `ref.subpath` resolves outside the cloned repository
 * @throws {@link SourceTooLargeError} When the resolved fileset exceeds the content or file-count cap
 */
export async function resolveSource(
  ref: SourceRef,
  options: ResolveSourceOptions,
): Promise<DocFile[]> {
  const docFiles =
    ref.type === "path"
      ? await resolveLocal(ref.path, { includeLarge: options.includeLarge })
      : await resolveGithubRef(ref, options);

  assertWithinCaps(
    docFiles,
    options.maxFiles ?? defaultMaxFileCount,
    options.maxBytes ?? defaultMaxTotalContentBytes,
  );

  return docFiles;
}
