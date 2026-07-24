import type { EmitFile } from "../types.js";

/** Maximum number of characters kept in a finding's excerpt. */
const EXCERPT_LENGTH_LIMIT = 200;

/**
 * Well-known instruction-override phrases used to hijack an assistant reading
 * untrusted content. Matched case-insensitively as substrings.
 */
const INSTRUCTION_OVERRIDE_PHRASES: readonly string[] = [
  "ignore previous instructions",
  "ignore all previous",
  "disregard the above",
  "forget your instructions",
  "you must now",
  "new instructions:",
];

/** Fence info strings that identify a fenced block as a tool/function call directive. */
const TOOL_CALL_FENCE_INFO_STRINGS = new Set([
  "tool",
  "function",
  "tool_call",
  "json tool",
]);

const ROLE_MARKER_PATTERN = /^(system|assistant|user):/i;
const ALWAYS_KEYWORD_PATTERN = /\b(always|every time)\b/i;
const INVOKE_VERB_PATTERN = /\b(run|execute|consult|invoke)\b/i;
const TOOL_CALL_NAME_PATTERN = /"name"\s*:\s*".+"/;
const TOOL_CALL_ARGUMENTS_PATTERN = /arguments/i;
const CURL_OR_WGET_PIPE_SHELL_PATTERN = /\b(curl|wget)\b.*\|\s*(sh|bash)\b/i;
const BASE64_DECODE_PIPE_SHELL_PATTERN =
  /base64\s+(-d|--decode)\b.*\|\s*(sh|bash)\b/i;

/** A single fence-injection tripwire hit within a generated skill file. */
export interface InjectionFinding {
  /** Path of the file the pattern was found in, relative to the skill directory. */
  relativePath: string;
  /** 1-based line number of the match within the file. */
  line: number;
  /** Short human label identifying which tripwire matched. */
  pattern: string;
  /** The matched line, trimmed and capped at 200 characters. */
  excerpt: string;
}

interface FenceLine {
  lineNumber: number;
  line: string;
}

function capExcerpt(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > EXCERPT_LENGTH_LIMIT
    ? trimmed.slice(0, EXCERPT_LENGTH_LIMIT)
    : trimmed;
}

function detectLinePatterns(line: string): string[] {
  const patterns: string[] = [];
  const lowerLine = line.toLowerCase();
  const trimmedLine = line.trim();

  if (
    INSTRUCTION_OVERRIDE_PHRASES.some((phrase) => lowerLine.includes(phrase))
  ) {
    patterns.push("instruction-override");
  }

  if (ROLE_MARKER_PATTERN.test(trimmedLine)) {
    patterns.push("role-marker");
  }

  if (ALWAYS_KEYWORD_PATTERN.test(line) && INVOKE_VERB_PATTERN.test(line)) {
    patterns.push("always-invoke");
  }

  if (CURL_OR_WGET_PIPE_SHELL_PATTERN.test(line)) {
    patterns.push("curl-pipe-shell");
  }

  if (BASE64_DECODE_PIPE_SHELL_PATTERN.test(line)) {
    patterns.push("base64-decode");
  }

  return patterns;
}

function detectToolCallShapeInFence(
  relativePath: string,
  fenceLines: FenceLine[],
): InjectionFinding[] {
  const blockMentionsArguments = fenceLines.some(({ line }) =>
    TOOL_CALL_ARGUMENTS_PATTERN.test(line),
  );

  if (!blockMentionsArguments) return [];

  return fenceLines
    .filter(({ line }) => TOOL_CALL_NAME_PATTERN.test(line))
    .map(({ lineNumber, line }) => ({
      relativePath,
      line: lineNumber,
      pattern: "tool-call-fence",
      excerpt: capExcerpt(line),
    }));
}

function scanFileForInjection(file: EmitFile): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  const lines = file.content.split("\n");
  let insideFence = false;
  let fenceLines: FenceLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("```")) {
      if (!insideFence) {
        const infoString = trimmedLine.slice(3).trim().toLowerCase();
        if (TOOL_CALL_FENCE_INFO_STRINGS.has(infoString)) {
          findings.push({
            relativePath: file.relativePath,
            line: lineNumber,
            pattern: "tool-call-fence",
            excerpt: capExcerpt(trimmedLine),
          });
        }
        insideFence = true;
        fenceLines = [];
      } else {
        findings.push(
          ...detectToolCallShapeInFence(file.relativePath, fenceLines),
        );
        insideFence = false;
        fenceLines = [];
      }
    } else if (insideFence) {
      fenceLines.push({ lineNumber, line });
    }

    for (const pattern of detectLinePatterns(line)) {
      findings.push({
        relativePath: file.relativePath,
        line: lineNumber,
        pattern,
        excerpt: capExcerpt(line),
      });
    }
  }

  if (insideFence) {
    findings.push(...detectToolCallShapeInFence(file.relativePath, fenceLines));
  }

  return findings;
}

/**
 * Scan generated skill files for prompt-injection tripwire patterns.
 *
 * This is a secondary alert, not a guarantee: it flags suspicious shapes commonly
 * used to hijack an assistant reading third-party-sourced documentation (instruction
 * overrides, role markers, always-invoke imperatives, tool-call-shaped fenced blocks,
 * and download-and-execute one-liners) so `das add` and `das refresh --update` can
 * surface them to the user before install. Patterns are kept conservative to avoid
 * firing on ordinary prose.
 *
 * @param files - The generated skill files to scan
 * @returns Findings in file order, then line order within each file
 */
export function scanForInjection(files: EmitFile[]): InjectionFinding[] {
  const findings: InjectionFinding[] = [];

  for (const file of files) {
    findings.push(...scanFileForInjection(file));
  }

  return findings;
}
