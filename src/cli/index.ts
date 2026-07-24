import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { confirm } from "@inquirer/prompts";
import { Command, InvalidArgumentError } from "commander";
import { readDasJson, writeDasJson } from "../emitter/das-json.js";
import { renderSkillPlan } from "../emitter/render.js";
import { writeSkillTransactional } from "../emitter/write.js";
import { refreshSkill, runHookRefresh } from "../refresh/refresh.js";
import type { RefreshDeps } from "../refresh/refresh.js";
import { parseGithubUrl } from "../resolver/github-url.js";
import { lsRemote } from "../resolver/git.js";
import { resolveSource } from "../resolver/resolve.js";
import { scanForInjection } from "../scan/injection.js";
import {
  installSessionStartHook,
  isDasHookInstalled,
} from "../settings/hooks.js";
import { buildSizedTree } from "../slicer/build-sized-tree.js";
import { planEmission } from "../slicer/emit-plan.js";
import { hashFileset } from "../state/hash.js";
import {
  assertManagedPath,
  expectedSkillPath,
  loadManifest,
  rebuildManifest,
  saveManifest,
} from "../state/manifest.js";
import { runAdd, type AddArgs, type RunAddDeps } from "./add.js";
import { runDoctorCommand, type RunDoctorCommandDeps } from "./doctor.js";
import {
  runHookInstallCommand,
  type HookInstallArgs,
  type RunHookInstallCommandDeps,
} from "./hook-cmd.js";
import { runListCommand, type RunListCommandDeps } from "./list.js";
import {
  runRefreshCommand,
  type RefreshCommandArgs,
  type RunRefreshCommandDeps,
} from "./refresh-cmd.js";
import {
  runRemoveCommand,
  type RemoveArgs,
  type RunRemoveCommandDeps,
} from "./remove.js";
import { createInteractivePrompts } from "./wizard.js";

function readPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require("../../package.json") as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Build the real, production `RunAddDeps` used to wire the actual pipeline into `das add`.
 *
 * @returns The dependency object `runAdd` executes against outside of tests
 */
export function createProductionAddDeps(): RunAddDeps {
  const home = homedir();

  return {
    parseGithubUrl,
    lsRemote,
    resolveSource: (ref, options) =>
      resolveSource(ref, {
        includeLarge: options.includeLarge,
        ...(options.pinnedSha !== undefined
          ? { pinnedSha: options.pinnedSha }
          : {}),
      }),
    buildSizedTree,
    planEmission,
    renderSkillPlan,
    scanForInjection,
    writeSkillTransactional,
    readDasJson,
    hashFileset,
    loadManifest,
    saveManifest,
    expectedSkillPath,
    assertManagedPath,
    hasSessionStartHook: isDasHookInstalled,
    installSessionStartHook,
    prompts: createInteractivePrompts(),
    now: () => Date.now(),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    home,
    projectRoot: process.cwd(),
    manifestBaseDir: join(home, ".claude", "das"),
    dasVersion: readPackageVersion(),
  };
}

/**
 * Build the real, production {@link RefreshDeps} used to wire the actual refresh engine into
 * `das refresh`.
 *
 * @returns The dependency object `refreshSkill` and `runHookRefresh` execute against
 */
export function createProductionRefreshEngineDeps(): RefreshDeps {
  return {
    resolveSource: (ref, options) =>
      resolveSource(ref, {
        includeLarge: options.includeLarge,
        ...(options.pinnedSha !== undefined
          ? { pinnedSha: options.pinnedSha }
          : {}),
      }),
    lsRemote,
    buildSizedTree,
    planEmission,
    renderSkillPlan,
    writeSkillTransactional,
    readDasJson,
    writeDasJson,
    hashFileset,
    now: () => Date.now(),
    scanChanged: (files) => {
      const findings = scanForInjection(files);
      if (findings.length > 0) {
        throw new Error(
          `Injection scan flagged ${String(findings.length)} finding(s) in updated content; aborting refresh.`,
        );
      }
    },
  };
}

/**
 * Build the real, production {@link RunRefreshCommandDeps} used to wire `das refresh`.
 *
 * @returns The dependency object `runRefreshCommand` executes against outside of tests
 */
export function createProductionRefreshDeps(): RunRefreshCommandDeps {
  const home = homedir();

  return {
    loadManifest,
    refreshSkill,
    runHookRefresh,
    refreshDeps: createProductionRefreshEngineDeps(),
    saveManifest,
    manifestBaseDir: join(home, ".claude", "das"),
    currentDirectory: process.cwd(),
    now: () => Date.now(),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  };
}

/**
 * Build the real, production {@link RunListCommandDeps} used to wire `das list`.
 *
 * @returns The dependency object `runListCommand` executes against outside of tests
 */
export function createProductionListDeps(): RunListCommandDeps {
  const home = homedir();

  return {
    loadManifest,
    readDasJson,
    readSkillMd: (skillDir) => readFile(join(skillDir, "SKILL.md"), "utf-8"),
    now: () => Date.now(),
    manifestBaseDir: join(home, ".claude", "das"),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  };
}

/**
 * Build the real, production {@link RunRemoveCommandDeps} used to wire `das remove`.
 *
 * @returns The dependency object `runRemoveCommand` executes against outside of tests
 */
export function createProductionRemoveDeps(): RunRemoveCommandDeps {
  const home = homedir();

  return {
    loadManifest,
    saveManifest,
    assertManagedPath,
    readDasJson,
    home,
    projectRoot: process.cwd(),
    manifestBaseDir: join(home, ".claude", "das"),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  };
}

/**
 * Build the real, production {@link RunDoctorCommandDeps} used to wire `das doctor`.
 *
 * @returns The dependency object `runDoctorCommand` executes against outside of tests
 */
export function createProductionDoctorDeps(): RunDoctorCommandDeps {
  const home = homedir();

  return {
    loadManifest,
    rebuildManifest,
    saveManifest,
    home,
    projectRoot: process.cwd(),
    manifestBaseDir: join(home, ".claude", "das"),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  };
}

/**
 * Build the real, production {@link RunHookInstallCommandDeps} used to wire `das hook install`.
 *
 * @returns The dependency object `runHookInstallCommand` executes against outside of tests
 */
export function createProductionHookInstallDeps(): RunHookInstallCommandDeps {
  return {
    installSessionStartHook,
    confirmProjectInstall: (settingsPath) =>
      confirm({
        message: `Install the SessionStart hook into ${settingsPath}? This will run for every collaborator who checks out this project.`,
        default: false,
      }),
    home: homedir(),
    projectRoot: process.cwd(),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  };
}

interface AddCommandOptions {
  scope?: "personal" | "project";
  name?: string;
  description?: string;
  hook: boolean;
  yes?: boolean;
  includeLarge?: boolean;
  tokenBudget?: number;
  force?: boolean;
}

function toAddArgs(source: string, options: AddCommandOptions): AddArgs {
  return {
    source,
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.description !== undefined
      ? { description: options.description }
      : {}),
    hook: options.hook,
    ...(options.yes !== undefined ? { yes: options.yes } : {}),
    ...(options.includeLarge !== undefined
      ? { includeLarge: options.includeLarge }
      : {}),
    ...(options.tokenBudget !== undefined
      ? { tokenBudget: options.tokenBudget }
      : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
  };
}

/**
 * Parse and validate the `--token-budget` Commander option.
 *
 * Rejecting a malformed value here, before `runAdd` ever runs, is what keeps a typo like
 * `--token-budget not-a-number` from reaching the pipeline as `NaN`.
 *
 * @param value - The raw string Commander captured for `--token-budget`
 * @returns The parsed positive integer
 * @throws {@link InvalidArgumentError} When `value` is not a positive integer
 */
export function parseTokenBudgetOption(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new InvalidArgumentError(
      `--token-budget must be a positive integer, got "${value}".`,
    );
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed <= 0) {
    throw new InvalidArgumentError(
      `--token-budget must be a positive integer, got "${value}".`,
    );
  }

  return parsed;
}

interface RefreshCommandOptions {
  all?: boolean;
  hook?: boolean;
  update?: boolean;
  force?: boolean;
}

function toRefreshArgs(
  name: string | undefined,
  options: RefreshCommandOptions,
): RefreshCommandArgs {
  return {
    ...(name !== undefined ? { name } : {}),
    ...(options.all !== undefined ? { all: options.all } : {}),
    ...(options.hook !== undefined ? { hook: options.hook } : {}),
    ...(options.update !== undefined ? { update: options.update } : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
  };
}

interface RemoveCommandOptions {
  scope?: "personal" | "project";
  force?: boolean;
}

function toRemoveArgs(name: string, options: RemoveCommandOptions): RemoveArgs {
  return {
    name,
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
  };
}

function toHookInstallArgs(options: {
  project?: boolean;
  yes?: boolean;
}): HookInstallArgs {
  return {
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.yes !== undefined ? { yes: options.yes } : {}),
  };
}

/**
 * Build the `das` Commander program with every subcommand registered: `add`, `refresh`, `list`,
 * `remove`, `doctor`, and `hook install`.
 *
 * Every command is a thin shell over its command-core function (`runAdd`, `runRefreshCommand`,
 * `runListCommand`, `runRemoveCommand`, `runDoctorCommand`, `runHookInstallCommand`): each action
 * parses flags, wires the real production dependencies, and translates the result (or a thrown
 * error) into process output and an exit code. All orchestration logic lives in the command-core
 * functions.
 *
 * `exitOverride()` is set so a parsing failure (for example an invalid `--token-budget`) throws a
 * `CommanderError` instead of calling `process.exit` directly, which is what lets this program be
 * driven from tests without killing the test process; a real `bin` entry point calling
 * `parseAsync` is expected to catch that error and set `process.exitCode` itself.
 *
 * @returns The configured Commander program
 */
export function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program
    .name("das")
    .description(
      "Documentation as a Skill: convert documentation into a token-bounded Claude Code skill.",
    );

  program
    .command("add")
    .argument("<source>", "GitHub URL or local path to convert")
    .description("Convert documentation into a Claude Code skill")
    .option("--scope <scope>", "install scope: personal or project")
    .option("--name <name>", "skill name")
    .option("--description <text>", "skill description")
    .option("--no-hook", "skip the SessionStart hook prompt and install")
    .option("--yes", "accept every default non-interactively")
    .option(
      "--include-large",
      "include files over the 1MB size guard instead of skipping them",
    )
    .option(
      "--token-budget <n>",
      "per-file token budget",
      parseTokenBudgetOption,
    )
    .option(
      "--force",
      "overwrite a name collision with a skill from a different source",
    )
    .action(async (source: string, options: AddCommandOptions) => {
      const deps = createProductionAddDeps();

      try {
        const outcome = await runAdd(toAddArgs(source, options), deps);

        if (outcome.status === "aborted") {
          deps.stderr(`das: ${outcome.reason}`);
          process.exitCode = 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.stderr(`das: ${message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("refresh")
    .argument("[name]", "skill name to refresh")
    .description("Check or regenerate registered skills")
    .option("--all", "refresh every registered skill")
    .option("--hook", "run the bounded SessionStart hook refresh")
    .option(
      "--update",
      "for a remote skill, fetch and regenerate at the tracked ref's current sha",
    )
    .option(
      "--force",
      "regenerate a local skill even when its source hash has not changed",
    )
    .action(
      async (name: string | undefined, options: RefreshCommandOptions) => {
        const deps = createProductionRefreshDeps();

        try {
          const outcome = await runRefreshCommand(
            toRefreshArgs(name, options),
            deps,
          );

          if (
            outcome.status === "not-found" ||
            outcome.status === "usage-error"
          ) {
            process.exitCode = 1;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          deps.stderr(`das: ${message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command("list")
    .description("List every registered skill")
    .action(async () => {
      const deps = createProductionListDeps();

      try {
        await runListCommand(deps);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.stderr(`das: ${message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("remove")
    .argument("<name>", "skill name to remove")
    .description("Remove a registered skill's tracked files")
    .option("--scope <scope>", "disambiguate when both scopes share a name")
    .option(
      "--force",
      "delete tracked files even when foreign files are present alongside them",
    )
    .action(async (name: string, options: RemoveCommandOptions) => {
      const deps = createProductionRemoveDeps();

      try {
        const outcome = await runRemoveCommand(
          toRemoveArgs(name, options),
          deps,
        );

        if (outcome.status === "refused") {
          process.exitCode = 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.stderr(`das: ${message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("doctor")
    .description("Rebuild the manifest from what is actually on disk")
    .action(async () => {
      const deps = createProductionDoctorDeps();

      try {
        await runDoctorCommand(deps);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.stderr(`das: ${message}`);
        process.exitCode = 1;
      }
    });

  const hookCommand = program
    .command("hook")
    .description("Manage the das SessionStart hook");

  hookCommand
    .command("install")
    .description("Install the das SessionStart hook")
    .option(
      "--project",
      "install into the project's committed .claude/settings.json instead of the personal one",
    )
    .option(
      "--yes",
      "skip the collaborator-impact confirmation prompt for --project",
    )
    .action(async (options: { project?: boolean; yes?: boolean }) => {
      const deps = createProductionHookInstallDeps();

      try {
        await runHookInstallCommand(toHookInstallArgs(options), deps);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.stderr(`das: ${message}`);
        process.exitCode = 1;
      }
    });

  return program;
}
