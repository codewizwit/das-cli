import matter from "gray-matter";
import type { DasJson } from "../emitter/das-json.js";
import { estimateTokens } from "../markdown/tokens.js";
import type { Manifest, ManifestEntry } from "../state/manifest.js";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** The effectful functions {@link runListCommand} depends on. */
export interface RunListCommandDeps {
  /** Load the manifest cache. */
  loadManifest: (baseDir: string) => Promise<Manifest>;
  /** Read and validate a skill's das.json record. */
  readDasJson: (skillDir: string) => Promise<DasJson>;
  /** Read a skill's SKILL.md contents; rejects when the file is missing. */
  readSkillMd: (skillDir: string) => Promise<string>;
  /** The current time, in epoch milliseconds. */
  now: () => number;
  /** Absolute path to the directory containing manifest.json. */
  manifestBaseDir: string;
  /** Write a line to stdout. */
  stdout: (line: string) => void;
}

function shortSourceLabel(source: DasJson["source"]): string {
  if (source.type === "path") {
    return source.path;
  }

  const withoutProtocol = source.url.replace(/^https:\/\//, "");
  return source.subpath
    ? `${withoutProtocol}/${source.subpath}`
    : withoutProtocol;
}

function pinnedRefLabel(dasJson: DasJson): string {
  if (dasJson.source.type !== "github") {
    return "local";
  }

  const ref = dasJson.trackedRef ?? "HEAD";
  const shortSha = dasJson.pinnedSha
    ? dasJson.pinnedSha.slice(0, 7)
    : "unknown";
  return `${ref}@${shortSha}`;
}

function isStale(dasJson: DasJson, nowMs: number): boolean {
  const lastRefreshMs = Date.parse(dasJson.lastRefresh);
  const elapsedHours = (nowMs - lastRefreshMs) / MILLISECONDS_PER_HOUR;
  return elapsedHours >= dasJson.checkIntervalHours;
}

interface TableRow {
  name: string;
  source: string;
  scope: string;
  pinned: string;
  lastRefresh: string;
  staleness: string;
  updateAvailable: string;
}

function renderTable(rows: TableRow[], deps: RunListCommandDeps): void {
  const headers: TableRow = {
    name: "NAME",
    source: "SOURCE",
    scope: "SCOPE",
    pinned: "PINNED",
    lastRefresh: "LAST REFRESH",
    staleness: "STALENESS",
    updateAvailable: "UPDATE AVAILABLE",
  };

  const columns: (keyof TableRow)[] = [
    "name",
    "source",
    "scope",
    "pinned",
    "lastRefresh",
    "staleness",
    "updateAvailable",
  ];

  const widths = columns.map((column) =>
    Math.max(headers[column].length, ...rows.map((row) => row[column].length)),
  );

  const renderRow = (row: TableRow): string =>
    columns
      .map((column, index) => row[column].padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();

  deps.stdout(renderRow(headers));
  for (const row of rows) {
    deps.stdout(renderRow(row));
  }
}

async function buildRow(
  entry: ManifestEntry,
  deps: RunListCommandDeps,
): Promise<TableRow> {
  try {
    const dasJson = await deps.readDasJson(entry.skillPath);
    return {
      name: entry.name,
      source: shortSourceLabel(dasJson.source),
      scope: entry.scope,
      pinned: pinnedRefLabel(dasJson),
      lastRefresh: dasJson.lastRefresh,
      staleness: isStale(dasJson, deps.now()) ? "stale" : "fresh",
      updateAvailable: entry.updateAvailable ? "yes" : "no",
    };
  } catch {
    return {
      name: entry.name,
      source: "unreadable das.json",
      scope: entry.scope,
      pinned: "unknown",
      lastRefresh: "unknown",
      staleness: "unknown",
      updateAvailable: entry.updateAvailable ? "yes" : "no",
    };
  }
}

interface DescriptionEstimate {
  totalTokens: number;
  skippedNames: string[];
}

async function estimateDescriptionTokens(
  entries: ManifestEntry[],
  deps: RunListCommandDeps,
): Promise<DescriptionEstimate> {
  let totalTokens = 0;
  const skippedNames: string[] = [];

  for (const entry of entries) {
    let content: string;
    try {
      content = await deps.readSkillMd(entry.skillPath);
    } catch {
      skippedNames.push(entry.name);
      continue;
    }

    const parsed = matter(content);
    const description =
      typeof parsed.data.description === "string"
        ? parsed.data.description
        : "";
    totalTokens += estimateTokens(description);
  }

  return { totalTokens, skippedNames };
}

/**
 * Run the `das list` command core: print every registered skill and the aggregate cost of
 * loading their descriptions.
 *
 * Each row is built from the manifest entry (name, scope, the persisted `updateAvailable` flag)
 * and the skill's das.json (source, pinned ref or sha, last refresh time, and staleness derived
 * from `checkIntervalHours`); a skill whose das.json cannot be read still gets a row, marked
 * `unreadable das.json` rather than aborting the whole listing. The aggregate description-token
 * total is computed separately by reading each skill's SKILL.md frontmatter description; a skill
 * missing SKILL.md is skipped from the total with a printed note rather than failing the command.
 *
 * @param deps - The injected effectful functions this run executes through
 */
export async function runListCommand(deps: RunListCommandDeps): Promise<void> {
  const manifest = await deps.loadManifest(deps.manifestBaseDir);

  if (manifest.skills.length === 0) {
    deps.stdout("das: no skills are registered");
    return;
  }

  const rows = await Promise.all(
    manifest.skills.map((entry) => buildRow(entry, deps)),
  );
  renderTable(rows, deps);

  const { totalTokens, skippedNames } = await estimateDescriptionTokens(
    manifest.skills,
    deps,
  );

  for (const name of skippedNames) {
    deps.stdout(
      `note: ${name} is missing SKILL.md; skipped from the description-token estimate`,
    );
  }

  deps.stdout(`descriptions load ~${String(totalTokens)} tokens every session`);
}
