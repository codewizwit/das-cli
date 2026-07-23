import type { Stats } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../markdown/frontmatter.js";
import { stripMdx } from "../markdown/mdx.js";
import type { DocFile } from "../types.js";
import { compareDocOrder, type OrderKey } from "./ordering.js";

/** Options controlling how {@link resolveLocal} processes a local source. */
export interface ResolveLocalOptions {
  /** When true, files over the 1MB size guard are included instead of skipped. */
  includeLarge: boolean;
}

/** Thrown when a local source resolves to no usable Markdown files. */
export class EmptyFilesetError extends Error {
  /** Absolute paths that were searched while resolving the source. */
  readonly searchedPaths: string[];

  constructor(searchedPaths: string[]) {
    super(
      `No usable Markdown files found. Searched: ${searchedPaths.join(", ")}`,
    );
    this.name = "EmptyFilesetError";
    this.searchedPaths = searchedPaths;
  }
}

/** Thrown when the top-level source path passed to {@link resolveLocal} is itself a symlink. */
export class SymlinkSourceError extends Error {
  /** The symlinked path that was rejected. */
  readonly sourcePath: string;

  constructor(sourcePath: string) {
    super(
      `Refusing to resolve a symlinked source path: ${sourcePath}. Pass the resolved target path instead.`,
    );
    this.name = "SymlinkSourceError";
    this.sourcePath = sourcePath;
  }
}

const maxFileSizeBytes = 1024 * 1024;
const docsFolderNames = ["docs", "documentation", "doc"];
const markdownExtensionPattern = /\.(md|mdx|markdown)$/i;
const readmeFileNamePattern = /^readme\.(md|mdx|markdown)$/i;
const changelogFileNamePattern = /^changelog\.md$/i;
const licenseFileNamePattern = /^license/i;

interface SortableFileEntry {
  kind: "file";
  orderKey: OrderKey;
  docFile: DocFile;
}

interface SortableDirectoryEntry {
  kind: "directory";
  orderKey: OrderKey;
  absolutePath: string;
}

type SortableEntry = SortableFileEntry | SortableDirectoryEntry;

function toRelativePosixPath(fromPath: string, toPath: string): string {
  return path.relative(fromPath, toPath).split(path.sep).join("/");
}

async function processMarkdownFile(
  absolutePath: string,
  relativePath: string,
  entryStat: Stats,
  options: ResolveLocalOptions,
): Promise<DocFile | null> {
  if (entryStat.size > maxFileSizeBytes && !options.includeLarge) {
    process.stderr.write(
      `das: skipping ${absolutePath} (${String(entryStat.size)} bytes exceeds the 1MB limit; use --include-large to include it)\n`,
    );
    return null;
  }

  const raw = await readFile(absolutePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);

  if (frontmatter.draft === true) {
    return null;
  }

  const content = stripMdx(body);

  if (content.trim() === "") {
    return null;
  }

  return { relativePath, content, frontmatter };
}

async function walkDirectory(
  directoryPath: string,
  docsRootPath: string,
  options: ResolveLocalOptions,
  excludedAbsolutePath?: string,
): Promise<DocFile[]> {
  const entryNames = await readdir(directoryPath);
  const sortableEntries: SortableEntry[] = [];

  for (const entryName of entryNames) {
    if (entryName.startsWith(".") || entryName === "node_modules") {
      continue;
    }

    const entryPath = path.join(directoryPath, entryName);

    if (entryPath === excludedAbsolutePath) {
      continue;
    }

    const entryLstat = await lstat(entryPath);

    if (entryLstat.isSymbolicLink()) {
      continue;
    }

    const relativePath = toRelativePosixPath(docsRootPath, entryPath);

    if (entryLstat.isDirectory()) {
      sortableEntries.push({
        kind: "directory",
        absolutePath: entryPath,
        orderKey: { fileName: entryName, relativePath },
      });
      continue;
    }

    if (
      !entryLstat.isFile() ||
      !markdownExtensionPattern.test(entryName) ||
      changelogFileNamePattern.test(entryName) ||
      licenseFileNamePattern.test(entryName)
    ) {
      continue;
    }

    const docFile = await processMarkdownFile(
      entryPath,
      relativePath,
      entryLstat,
      options,
    );

    if (docFile === null) {
      continue;
    }

    sortableEntries.push({
      kind: "file",
      docFile,
      orderKey: {
        ...(docFile.frontmatter.sidebarPosition !== undefined
          ? { sidebarPosition: docFile.frontmatter.sidebarPosition }
          : {}),
        fileName: entryName,
        relativePath,
      },
    });
  }

  sortableEntries.sort((first, second) =>
    compareDocOrder(first.orderKey, second.orderKey),
  );

  const files: DocFile[] = [];

  for (const entry of sortableEntries) {
    if (entry.kind === "file") {
      files.push(entry.docFile);
      continue;
    }

    const childFiles = await walkDirectory(
      entry.absolutePath,
      docsRootPath,
      options,
    );
    files.push(...childFiles);
  }

  return files;
}

async function tryWalkDocsFolder(
  candidatePath: string,
  options: ResolveLocalOptions,
): Promise<DocFile[] | null> {
  let candidateLstat: Stats;

  try {
    candidateLstat = await lstat(candidatePath);
  } catch {
    return null;
  }

  if (!candidateLstat.isDirectory()) {
    return null;
  }

  return walkDirectory(candidatePath, candidatePath, options);
}

async function findReadme(
  resolvedSourcePath: string,
  options: ResolveLocalOptions,
): Promise<{ docFile: DocFile; absolutePath: string } | null> {
  const entryNames = await readdir(resolvedSourcePath);
  const readmeName = entryNames.find((entryName) =>
    readmeFileNamePattern.test(entryName),
  );

  if (readmeName === undefined) {
    return null;
  }

  const absolutePath = path.join(resolvedSourcePath, readmeName);
  const entryLstat = await lstat(absolutePath);

  if (!entryLstat.isFile()) {
    return null;
  }

  const docFile = await processMarkdownFile(
    absolutePath,
    readmeName,
    entryLstat,
    options,
  );

  if (docFile === null) {
    return null;
  }

  return { docFile, absolutePath };
}

async function resolveSingleFile(
  resolvedSourcePath: string,
  entryStat: Stats,
  options: ResolveLocalOptions,
): Promise<DocFile[]> {
  const relativePath = path.basename(resolvedSourcePath);
  const docFile = await processMarkdownFile(
    resolvedSourcePath,
    relativePath,
    entryStat,
    options,
  );

  if (docFile === null) {
    throw new EmptyFilesetError([resolvedSourcePath]);
  }

  return [docFile];
}

async function resolveDirectory(
  resolvedSourcePath: string,
  options: ResolveLocalOptions,
): Promise<DocFile[]> {
  const readme = await findReadme(resolvedSourcePath, options);
  const searchedPaths: string[] = [];
  let docsFiles: DocFile[] = [];

  for (const folderName of docsFolderNames) {
    const candidatePath = path.join(resolvedSourcePath, folderName);
    searchedPaths.push(candidatePath);

    const candidateFiles = await tryWalkDocsFolder(candidatePath, options);

    if (candidateFiles !== null && candidateFiles.length > 0) {
      docsFiles = candidateFiles;
      break;
    }
  }

  if (docsFiles.length === 0) {
    searchedPaths.push(resolvedSourcePath);
    docsFiles = await walkDirectory(
      resolvedSourcePath,
      resolvedSourcePath,
      options,
      readme?.absolutePath,
    );
  }

  const result = readme !== null ? [readme.docFile, ...docsFiles] : docsFiles;

  if (result.length === 0) {
    throw new EmptyFilesetError(searchedPaths);
  }

  return result;
}

/**
 * Resolve a local file, folder, or project root into an ordered set of documentation files.
 *
 * A single Markdown file resolves to itself. A directory is treated as a project root: a
 * `docs/`, `documentation/`, or `doc/` subfolder is preferred over root-level Markdown when it
 * exists and contains usable Markdown, and the top-level README is always included first when
 * present. Symlinked files and directories are never followed, and `node_modules`, hidden
 * entries, `CHANGELOG.md`, and `LICENSE*` files are excluded. This rule applies to `sourcePath`
 * itself as well as to every entry discovered while walking: a symlinked top-level file or
 * directory is rejected rather than followed, since callers (including manifest-driven refresh)
 * must not be able to point resolution at a path outside the intended source.
 *
 * @param sourcePath - Path to a Markdown file, docs folder, or project root
 * @param options - Resolution options
 * @returns The ordered, processed fileset
 * @throws {@link SymlinkSourceError} when `sourcePath` itself is a symlink
 * @throws {@link EmptyFilesetError} when no usable Markdown files remain after resolution
 */
export async function resolveLocal(
  sourcePath: string,
  options: ResolveLocalOptions,
): Promise<DocFile[]> {
  const resolvedSourcePath = path.resolve(sourcePath);
  const sourceLstat = await lstat(resolvedSourcePath);

  if (sourceLstat.isSymbolicLink()) {
    throw new SymlinkSourceError(resolvedSourcePath);
  }

  if (sourceLstat.isFile()) {
    return resolveSingleFile(resolvedSourcePath, sourceLstat, options);
  }

  return resolveDirectory(resolvedSourcePath, options);
}
