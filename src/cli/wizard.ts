import { confirm, input, select } from "@inquirer/prompts";
import type { AddPrompts } from "./add.js";

/**
 * Build the real, TTY-backed `das add` wizard prompts.
 *
 * Production wiring passes this to {@link runAdd | `runAdd`} as `deps.prompts`; tests inject their
 * own fake {@link AddPrompts} instead, so no test ever touches a real terminal.
 *
 * @returns The interactive prompt implementations for every wizard step
 */
export function createInteractivePrompts(): AddPrompts {
  return {
    scope: (defaultScope) =>
      select({
        message: "Install scope",
        default: defaultScope,
        choices: [
          { name: "Personal (~/.claude/skills)", value: "personal" as const },
          { name: "Project (.claude/skills)", value: "project" as const },
        ],
      }),
    name: (defaultName) =>
      input({ message: "Skill name", default: defaultName }),
    description: (defaultDescription) =>
      input({ message: "Description", default: defaultDescription }),
    installHook: (defaultValue) =>
      confirm({
        message: "Install the SessionStart hook to keep this skill fresh?",
        default: defaultValue,
      }),
    confirmScanFindings: async (findings) => {
      for (const finding of findings) {
        process.stdout.write(
          `  ${finding.relativePath}:${String(finding.line)} [${finding.pattern}] ${finding.excerpt}\n`,
        );
      }
      return confirm({
        message: `Injection scan flagged ${String(findings.length)} finding(s). Proceed anyway?`,
        default: false,
      });
    },
    confirmCollision: (name, existingSource) => {
      const sourceLabel =
        existingSource.type === "github"
          ? existingSource.url
          : existingSource.path;
      return confirm({
        message: `A different skill already exists at "${name}" (source: ${sourceLabel}). Overwrite it?`,
        default: false,
      });
    },
  };
}
