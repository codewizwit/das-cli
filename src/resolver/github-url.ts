const githubHost = "github.com";
const repoSegmentPattern = /^[A-Za-z0-9_.-]+$/;

/** Thrown when a source string is not one of the supported GitHub URL forms. */
export class UnsupportedSourceError extends Error {
  constructor(input: string) {
    super(
      `Unsupported source: "${input}". Supported forms are https://github.com/<org>/<repo>[.git], https://github.com/<org>/<repo>/tree/<ref>[/<subpath>], and https://github.com/<org>/<repo>/blob/<ref>/<filepath>.`,
    );
    this.name = "UnsupportedSourceError";
  }
}

/** A GitHub source parsed into its canonical clone URL plus an optional ref and subpath. */
export interface ParsedGithubUrl {
  /** Canonical HTTPS clone URL, always ending in `.git`. */
  url: string;
  /** Branch, tag, or commit the input pinned to, or null when unspecified. */
  ref: string | null;
  /** Path within the repository the input pinned to, or null when unspecified. */
  subpath: string | null;
}

function isValidRepoSegment(segment: string): boolean {
  return (
    segment !== "." && segment !== ".." && repoSegmentPattern.test(segment)
  );
}

/**
 * Parse a GitHub source string into a canonical clone URL, optional ref, and optional subpath.
 *
 * This is the security allowlist for every remote source DAS will ever clone: only
 * `https://github.com/<org>/<repo>` and its `/tree/<ref>[/<subpath>]` and
 * `/blob/<ref>/<filepath>` variants are accepted, with the host matched exactly (case-insensitive)
 * against `github.com`. Every other scheme, host, credential, port, query string, fragment, or
 * path shape is rejected, since acceptance here is the exception and rejection is the default.
 *
 * The ref is parsed as a single path segment. A ref containing a literal `/` (for example a
 * branch name like `feature/foo`) is out of scope for v1: the segment after the ref will be
 * misread as the first component of the subpath instead of part of the ref.
 *
 * @param input - The source string to parse
 * @returns The canonical clone URL, ref, and subpath
 * @throws {@link UnsupportedSourceError} When `input` is not a supported GitHub URL form
 */
export function parseGithubUrl(input: string): ParsedGithubUrl {
  if (input.trim() === "" || input.startsWith("-")) {
    throw new UnsupportedSourceError(input);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    throw new UnsupportedSourceError(input);
  }

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.port !== "" ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== "" ||
    parsedUrl.hostname.toLowerCase() !== githubHost
  ) {
    throw new UnsupportedSourceError(input);
  }

  const pathSegments = parsedUrl.pathname
    .split("/")
    .filter((segment) => segment !== "");

  if (pathSegments.length < 2) {
    throw new UnsupportedSourceError(input);
  }

  const [
    orgSegment,
    repoSegmentRaw,
    formSegment,
    refSegment,
    ...subpathSegments
  ] = pathSegments;

  if (orgSegment === undefined || repoSegmentRaw === undefined) {
    throw new UnsupportedSourceError(input);
  }

  if (!isValidRepoSegment(orgSegment) || !isValidRepoSegment(repoSegmentRaw)) {
    throw new UnsupportedSourceError(input);
  }

  const repoName = repoSegmentRaw.endsWith(".git")
    ? repoSegmentRaw.slice(0, -4)
    : repoSegmentRaw;

  if (repoName === "") {
    throw new UnsupportedSourceError(input);
  }

  const url = `https://${githubHost}/${orgSegment}/${repoName}.git`;

  if (pathSegments.length === 2) {
    return { url, ref: null, subpath: null };
  }

  if (formSegment === "tree" && refSegment !== undefined) {
    return {
      url,
      ref: refSegment,
      subpath: subpathSegments.length > 0 ? subpathSegments.join("/") : null,
    };
  }

  if (
    formSegment === "blob" &&
    refSegment !== undefined &&
    subpathSegments.length > 0
  ) {
    return { url, ref: refSegment, subpath: subpathSegments.join("/") };
  }

  throw new UnsupportedSourceError(input);
}
