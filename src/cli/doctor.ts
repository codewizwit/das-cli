import { join } from "node:path";
import type { Manifest, ManifestEntry } from "../state/manifest.js";

/** The effectful functions {@link runDoctorCommand} depends on. */
export interface RunDoctorCommandDeps {
  /** Load the manifest cache. */
  loadManifest: (baseDir: string) => Promise<Manifest>;
  /** Rebuild the manifest from scratch by scanning `.claude/skills` directories. */
  rebuildManifest: (
    skillsDirs: string[],
    options: { home: string; projectRoot?: string },
  ) => Promise<Manifest>;
  /** Validate and persist the manifest cache. */
  saveManifest: (baseDir: string, manifest: Manifest) => Promise<void>;
  /** The user's home directory, used to derive the personal skills root. */
  home: string;
  /** The current project root; when set, the project skills root is scanned too. */
  projectRoot?: string;
  /** Absolute path to the directory containing manifest.json. */
  manifestBaseDir: string;
  /** Write a line to stdout. */
  stdout: (line: string) => void;
  /** Write a line to stderr. */
  stderr: (line: string) => void;
}

/** A minimal identity for a manifest entry, used to report what `das doctor` changed. */
export interface DoctorEntryRef {
  /** The skill's name. */
  name: string;
  /** The skill's scope. */
  scope: "personal" | "project";
}

/** What changed between the previous manifest and the freshly rebuilt one. */
export interface DoctorReport {
  /** Skills present on disk but missing from the previous manifest. */
  added: DoctorEntryRef[];
  /** Skills present in the previous manifest but no longer found on disk. */
  removed: DoctorEntryRef[];
  /** Skills present in both, whose `skillPath` changed. */
  updated: DoctorEntryRef[];
}

function entryKey(entry: DoctorEntryRef): string {
  return `${entry.scope}:${entry.name}`;
}

function toRef(entry: ManifestEntry): DoctorEntryRef {
  return { name: entry.name, scope: entry.scope };
}

function reportLines(deps: RunDoctorCommandDeps, report: DoctorReport): void {
  if (
    report.added.length === 0 &&
    report.removed.length === 0 &&
    report.updated.length === 0
  ) {
    deps.stdout("das: manifest is already up to date");
    return;
  }

  if (report.added.length > 0) {
    deps.stdout(
      `das: added ${String(report.added.length)} skill(s): ${report.added
        .map((entry) => `${entry.name} (${entry.scope})`)
        .join(", ")}`,
    );
  }

  if (report.removed.length > 0) {
    deps.stdout(
      `das: removed ${String(report.removed.length)} skill(s): ${report.removed
        .map((entry) => `${entry.name} (${entry.scope})`)
        .join(", ")}`,
    );
  }

  if (report.updated.length > 0) {
    deps.stdout(
      `das: updated ${String(report.updated.length)} skill(s): ${report.updated
        .map((entry) => `${entry.name} (${entry.scope})`)
        .join(", ")}`,
    );
  }
}

/**
 * Run the `das doctor` command core: rebuild the manifest from what is actually on disk.
 *
 * Scans the personal `.claude/skills` directory, and the project one when `deps.projectRoot` is
 * set, for skill directories with a valid das.json, then diffs the result against the previous
 * manifest by name and scope to report which skills were added, removed, or had their path
 * updated. The rebuilt manifest, not the previous one, is what gets persisted.
 *
 * @param deps - The injected effectful functions this run executes through
 * @returns What changed between the previous manifest and the rebuilt one
 */
export async function runDoctorCommand(
  deps: RunDoctorCommandDeps,
): Promise<DoctorReport> {
  const previousManifest = await deps.loadManifest(deps.manifestBaseDir);

  const skillsDirs = [join(deps.home, ".claude", "skills")];
  if (deps.projectRoot !== undefined) {
    skillsDirs.push(join(deps.projectRoot, ".claude", "skills"));
  }

  const roots =
    deps.projectRoot !== undefined
      ? { home: deps.home, projectRoot: deps.projectRoot }
      : { home: deps.home };

  const rebuiltManifest = await deps.rebuildManifest(skillsDirs, roots);

  const previousByKey = new Map(
    previousManifest.skills.map((entry) => [entryKey(toRef(entry)), entry]),
  );
  const rebuiltByKey = new Map(
    rebuiltManifest.skills.map((entry) => [entryKey(toRef(entry)), entry]),
  );

  const added = rebuiltManifest.skills
    .filter((entry) => !previousByKey.has(entryKey(toRef(entry))))
    .map(toRef);

  const removed = previousManifest.skills
    .filter((entry) => !rebuiltByKey.has(entryKey(toRef(entry))))
    .map(toRef);

  const updated = rebuiltManifest.skills
    .filter((entry) => {
      const previous = previousByKey.get(entryKey(toRef(entry)));
      return previous !== undefined && previous.skillPath !== entry.skillPath;
    })
    .map(toRef);

  await deps.saveManifest(deps.manifestBaseDir, rebuiltManifest);

  const report: DoctorReport = { added, removed, updated };
  reportLines(deps, report);

  return report;
}
