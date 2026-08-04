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

/** A trimmed line opening with a chat-role marker, the classic role-injection shape. */
const ROLE_MARKER_PATTERN = /^(system|assistant|user):/i;

/**
 * An always-invoke imperative aimed at the assistant requires both an always-cadence
 * word and a cue that unambiguously names the assistant's response behaviour on the
 * same line. The cue set is deliberately narrow: bare `you must` / `you should`,
 * `invoke`, `consult`, and `each request` were all removed because they saturate
 * ordinary documentation prose ("you must always return an array", "prerenders on
 * each request", "the model can invoke tools"). Only phrasing about the reply itself
 * (this skill, before responding, before answering) fires.
 */
const ALWAYS_KEYWORD_PATTERN = /\b(always|every time)\b/i;
const ASSISTANT_DIRECTED_CUE_PATTERN =
  /\b(this skill|before responding|before answering)\b/i;

/**
 * The JSON tool-call shape requires both a `"name"` key with a string value and a
 * sibling `"arguments"` key in the same fenced block, so a manifest like package.json
 * (which has a `"name"` key but no `"arguments"` key) does not fire.
 */
const TOOL_CALL_NAME_PATTERN = /"name"\s*:\s*".+"/;
const TOOL_CALL_ARGUMENTS_KEY_PATTERN = /"arguments"\s*:/;

/** A download piped into a shell, optionally elevated with `sudo`, across common shells. */
const CURL_OR_WGET_PIPE_SHELL_PATTERN =
  /\b(curl|wget)\b.*\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish)\b/i;

/**
 * A base64-decoded payload piped into a shell, optionally elevated with `sudo`,
 * across common shells.
 */
const BASE64_DECODE_PIPE_SHELL_PATTERN =
  /base64\s+(-d|--decode)\b.*\|\s*(sudo\s+)?(sh|bash|zsh|dash|ksh|fish)\b/i;

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

/**
 * Detect the tripwire patterns on a single line.
 *
 * The prose-hijack tripwires (`role-marker`, `always-invoke`) target narrative text
 * trying to steer the assistant and are suppressed inside fenced code, where a line
 * such as `user: 252020,` is a JSON/JS object key rather than a chat-role marker. The
 * code-shaped tripwires (`instruction-override`, `curl-pipe-shell`, `base64-decode`)
 * fire in every context, since a download-and-execute one-liner is exactly what lives
 * inside a fenced install block.
 *
 * @param line - The raw line to inspect
 * @param insideFence - Whether the line sits within a fenced code block
 * @returns The pattern labels that matched, in detection order
 */
function detectLinePatterns(line: string, insideFence: boolean): string[] {
  const patterns: string[] = [];
  const lowerLine = line.toLowerCase();
  const trimmedLine = line.trim();

  if (
    INSTRUCTION_OVERRIDE_PHRASES.some((phrase) => lowerLine.includes(phrase))
  ) {
    patterns.push("instruction-override");
  }

  if (!insideFence && ROLE_MARKER_PATTERN.test(trimmedLine)) {
    patterns.push("role-marker");
  }

  if (
    !insideFence &&
    ALWAYS_KEYWORD_PATTERN.test(line) &&
    ASSISTANT_DIRECTED_CUE_PATTERN.test(line)
  ) {
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
  const blockHasArgumentsKey = fenceLines.some(({ line }) =>
    TOOL_CALL_ARGUMENTS_KEY_PATTERN.test(line),
  );

  if (!blockHasArgumentsKey) return [];

  return fenceLines
    .filter(({ line }) => TOOL_CALL_NAME_PATTERN.test(line))
    .map(({ lineNumber, line }) => ({
      relativePath,
      line: lineNumber,
      pattern: "tool-call-fence",
      excerpt: capExcerpt(line),
    }));
}

/** Count the run of leading backtick characters on a trimmed line (4 for a four-backtick fence). */
function leadingBacktickRun(trimmedLine: string): number {
  let count = 0;
  while (trimmedLine[count] === "`") {
    count += 1;
  }
  return count;
}

/**
 * Whether a trimmed line closes a fence opened with openFenceLength backticks.
 *
 * Per CommonMark a fenced block is closed only by a line of backticks alone (no info
 * string) whose run is at least as long as the opener. This is what keeps a shorter
 * inner fence from prematurely closing a longer outer fence, the variable-length
 * nesting real MDX documentation uses.
 */
function closesFence(trimmedLine: string, openFenceLength: number): boolean {
  return trimmedLine.length >= openFenceLength && /^`+$/.test(trimmedLine);
}

function scanFileForInjection(file: EmitFile): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  const lines = file.content.split("\n");
  let openFenceLength = 0;
  let fenceLines: FenceLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const trimmedLine = line.trim();
    const backtickRun = trimmedLine.startsWith("```")
      ? leadingBacktickRun(trimmedLine)
      : 0;

    if (openFenceLength === 0) {
      if (backtickRun >= 3) {
        const infoString = trimmedLine.slice(backtickRun).trim().toLowerCase();
        if (TOOL_CALL_FENCE_INFO_STRINGS.has(infoString)) {
          findings.push({
            relativePath: file.relativePath,
            line: lineNumber,
            pattern: "tool-call-fence",
            excerpt: capExcerpt(trimmedLine),
          });
        }
        openFenceLength = backtickRun;
        fenceLines = [];
      }
    } else if (closesFence(trimmedLine, openFenceLength)) {
      findings.push(
        ...detectToolCallShapeInFence(file.relativePath, fenceLines),
      );
      openFenceLength = 0;
      fenceLines = [];
    } else {
      fenceLines.push({ lineNumber, line });
    }

    for (const pattern of detectLinePatterns(line, openFenceLength !== 0)) {
      findings.push({
        relativePath: file.relativePath,
        line: lineNumber,
        pattern,
        excerpt: capExcerpt(line),
      });
    }
  }

  if (openFenceLength !== 0) {
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
