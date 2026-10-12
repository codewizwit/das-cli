import type { Stats } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../markdown/frontmatter.js";
import {
  isCategoryFileName,
  parseCategoryMeta,
} from "../markdown/category.js";
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

/**
 * Read a folder's category metadata file into the fileset.
 *
 * Returned as a {@link DocFile} so it flows with the source files the slicer
 * already receives and so the source hash covers it. `content` is the raw
 * text rather than a parsed form, because parsing belongs to the slicer.
 */
async function readCategoryFile(
  absolutePath: string,
  relativePath: string,
  entryStat: Stats,
  options: ResolveLocalOptions,
): Promise<DocFile | null> {
  if (entryStat.size > maxFileSizeBytes && !options.includeLarge) {
    return null;
  }

  const raw = await readFile(absolutePath, "utf-8");
  return { relativePath, raw, content: raw, frontmatter: {} };
}

/**
 * The authored sidebar position a folder declares for itself, if any.
 *
 * Read during the walk because a directory's order key is built there, before
 * the slicer sees anything.
 */
async function readCategoryPosition(
  directoryPath: string,
): Promise<number | undefined> {
  let entryNames: string[];
  try {
    entryNames = await readdir(directoryPath);
  } catch {
    return undefined;
  }

  const categoryFileName = entryNames.find((entryName) =>
    isCategoryFileName(entryName),
  );
  if (categoryFileName === undefined) {
    return undefined;
  }

  try {
    const raw = await readFile(
      path.join(directoryPath, categoryFileName),
      "utf-8",
    );
    return parseCategoryMeta(raw, categoryFileName).position;
  } catch {
    return undefined;
  }
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

  return { relativePath, raw, content, frontmatter };
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
      // Docusaurus orders categories by `position` in the folder's category
      // file. Without this a folder sorts by name, so das's index would
      // contradict the sidebar the authors see.
      const position = await readCategoryPosition(entryPath);
      sortableEntries.push({
        kind: "directory",
        absolutePath: entryPath,
        orderKey: {
          ...(position !== undefined ? { sidebarPosition: position } : {}),
          fileName: entryName,
          relativePath,
        },
      });
      continue;
    }

    if (!entryLstat.isFile()) {
      continue;
    }

    // A folder's category metadata travels with the fileset: the slicer reads
    // it for the folder's label and description, and the source hash covers
    // it so editing one triggers a re-slice. It is never emitted.
    if (isCategoryFileName(entryName)) {
      const categoryFile = await readCategoryFile(
        entryPath,
        relativePath,
        entryLstat,
        options,
      );
      if (categoryFile !== null) {
        sortableEntries.push({
          kind: "file",
          docFile: categoryFile,
          orderKey: { fileName: entryName, relativePath },
        });
      }
      continue;
    }

    if (
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
