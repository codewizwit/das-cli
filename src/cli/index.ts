import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { readDasJson } from "../emitter/das-json.js";
import { renderSkillPlan } from "../emitter/render.js";
import { writeSkillTransactional } from "../emitter/write.js";
import { parseGithubUrl } from "../resolver/github-url.js";
import { lsRemote } from "../resolver/git.js";
import { resolveSource } from "../resolver/resolve.js";
import { scanForInjection } from "../scan/injection.js";
import {
  installSessionStartHook,
  isDasHookInstalled,
} from "../settings/hooks.js";
import { planEmission } from "../slicer/emit-plan.js";
import { sizeTree } from "../slicer/sizing.js";
import { buildTree } from "../slicer/tree.js";
import { hashFileset } from "../state/hash.js";
import {
  assertManagedPath,
  expectedSkillPath,
  loadManifest,
  saveManifest,
} from "../state/manifest.js";
import { runAdd, type AddArgs, type RunAddDeps } from "./add.js";
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
    buildTree,
    sizeTree,
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

/**
 * Build the `das` Commander program with the `add` command registered.
 *
 * This is the thin shell over {@link runAdd}: it parses flags, wires the real production
 * dependencies, and translates the returned {@link AddOutcome} (or a thrown error) into process
 * output and an exit code. All orchestration logic lives in `runAdd`.
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

  return program;
}
