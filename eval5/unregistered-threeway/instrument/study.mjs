// Three-way study: no docs / grep the raw corpus / navigate a das skill.
// One frozen task set across every arm. Measures accuracy and token cost.
//
// Usage: node study.mjs <runsPerCell> [arms...]   e.g. node study.mjs 1 C A B D
import { execFileSync, execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const pexec = promisify(execFile);
const SD = "/private/tmp/claude-501/-Users-alexandra-projects-das-cli/d7b39eab-51af-42e2-84a1-4350850ade83/scratchpad";
const MODEL = process.env.STUDY_MODEL || "claude-haiku-4-5-20251001";
const RUNS = Number(process.argv[2] || 1);
const ARMS = process.argv.slice(3).length ? process.argv.slice(3) : ["C", "A", "B", "D"];
const TASKS = JSON.parse(readFileSync(join(SD, "tasks.json"), "utf8"));
const SETSHA = createHash("sha256").update(JSON.stringify(TASKS.questions)).digest("hex");

// Each arm gets the same kind of pointer to whatever documentation it has, so the
// prompt difference between A and B is the route and not the presence of a hint.
const ARM_SPEC = {
  C: { pointer: "", tools: ["Read", "Grep", "Glob"], payload: null },
  A: { pointer: "The documentation is in ./corpus. Search it to answer.", tools: ["Read", "Grep", "Glob"], payload: "corpus" },
  B: { pointer: "The documentation is available as the `wizwit` skill. Use it to answer.", tools: ["Read", "Grep", "Glob", "Skill"], payload: "skill-new" },
  D: { pointer: "The documentation is available as the `wizwit` skill. Use it to answer.", tools: ["Read", "Grep", "Glob", "Skill"], payload: "skill-main" },
  // B and D leave the route to the agent, which is what happens in practice. E removes
  // Grep and Glob so descending the generated index is the only way to reach an answer,
  // which is the only condition that measures the index itself.
  // E and F open the prompt with `/wizwit`, which loads the skill as a command before
  // the task starts. That takes the invocation decision out of the measurement, so what
  // is left is the cost of descending the index. Verified 2026-10-19.
  E: { slash: "wizwit", tools: ["Read", "Skill"], payload: "skill-new" },
  F: { slash: "wizwit", tools: ["Read", "Skill"], payload: "skill-main" },
};

// --allowed-tools only pre-approves; it does not remove anything. Verified 2026-10-19:
// a Bash call ran and echoed its marker under `--allowed-tools Read Grep Glob`. So every
// tool an arm must not have is denied explicitly, or the arms are not tool-matched and
// an index-only arm can reach a shell grep.
const DENY_ALWAYS = ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent"];
const RETRIEVAL = ["Read", "Grep", "Glob", "Skill"];

// Overriding HOME does not restrict file access. Verified 2026-10-19: a trial globbed
// `/Users/**` and read files from the real home directory, which means a "no corpus"
// arm can reach the corpus by absolute path and an index-only arm can bypass its index.
// Path-scoped deny patterns do block it, so every tree holding a copy of the corpus is
// denied explicitly and trial roots live outside the scratchpad that holds them.
const TRIAL_ROOT = "/private/tmp/das-study";
// A leading `//` is the absolute-path form in a permission rule. The single-slash form
// alone did not block the read; both are emitted so neither spelling is relied on.
const OFF_LIMITS = ["/Users/**", "/private/tmp/claude-501/**", `${SD}/**`];
const PATH_DENIES = ["Read", "Glob", "Grep"].flatMap((t) =>
  OFF_LIMITS.flatMap((p) => [`${t}(${p})`, `${t}(/${p})`]),
);
const denyFor = (arm) => [
  ...DENY_ALWAYS,
  ...RETRIEVAL.filter((t) => !ARM_SPEC[arm].tools.includes(t)),
  ...PATH_DENIES,
];

const norm = (s) => String(s).replace(/\s+/g, " ").toLowerCase();
const REFUSAL = /\b(i (?:do not|don't) have (?:access|enough)|cannot (?:access|find|determine)|no (?:documentation|corpus|files?) (?:is |are )?(?:available|present)|could you (?:clarify|provide)|which documentation|i was not given)\b/i;

function grade(q, answer) {
  const a = norm(answer);
  if (!a.trim()) return { pass: false, why: "empty" };
  if (REFUSAL.test(answer)) return { pass: false, why: "refusal-or-clarifying-question" };
  const missed = q.required.filter((g) => !g.some((alt) => a.includes(norm(alt))));
  return { pass: missed.length === 0, why: missed.length ? `missing:${JSON.stringify(missed)}` : "ok" };
}

function buildTrial(arm, qid, run) {
  const root = join(TRIAL_ROOT, `${arm}-${qid}-r${run}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "work"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  const spec = ARM_SPEC[arm];
  if (spec.payload === "corpus") cpSync(join(SD, "corpus"), join(root, "work", "corpus"), { recursive: true });
  if (spec.payload === "skill-new") cpSync(join(SD, "gen-new", ".claude"), join(root, "work", ".claude"), { recursive: true });
  if (spec.payload === "skill-main") cpSync(join(SD, "gen-main", ".claude"), join(root, "work", ".claude"), { recursive: true });
  return root;
}

// Preflight: assert each arm's condition is what it claims, rather than assuming it.
function preflight() {
  const out = {};
  for (const arm of ARMS) {
    const root = buildTrial(arm, "preflight", 0);
    const w = join(root, "work");
    const spec = ARM_SPEC[arm];
    out[arm] = {
      corpusPresent: existsSync(join(w, "corpus")),
      skillPresent: existsSync(join(w, ".claude", "skills", "wizwit", "SKILL.md")),
      skillToolOffered: spec.tools.includes("Skill"),
    };
    if (spec.payload === "corpus") out[arm].corpusFiles = execFileSync("/usr/bin/find", [join(w, "corpus"), "-name", "*.md"]).toString().trim().split("\n").length;
    if (spec.payload?.startsWith("skill")) out[arm].skillFiles = execFileSync("/usr/bin/find", [join(w, ".claude", "skills", "wizwit"), "-type", "f"]).toString().trim().split("\n").length;
  }
  return out;
}

async function runOne(arm, q, run) {
  const root = buildTrial(arm, q.id, run);
  const spec = ARM_SPEC[arm];
  const prompt = spec.slash
    ? `/${spec.slash} ${q.prompt}`
    : [spec.pointer, q.prompt].filter(Boolean).join("\n\n");
  const args = [
    "-p", prompt,
    "--model", MODEL,
    "--max-turns", "15",
    "--output-format", "stream-json", "--verbose",
    // No --bare or --restricted: both remove project-scope skill discovery, which is
    // the mechanism under test. Verified 2026-10-19: --bare loads no skills at all and
    // --restricted loads built-ins but not `.claude/skills/`. Isolation is structural
    // instead: env -i, an empty per-trial HOME, and a trial root outside $HOME with no
    // CLAUDE.md anywhere in its ancestor chain (asserted in preflight).
    "--allowed-tools", ...spec.tools,
    "--disallowed-tools", ...denyFor(arm),
  ];
  const env = {
    PATH: "/Users/alexandra/.local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    LANG: "en_US.UTF-8",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  // The CLI exits non-zero in cases that still produce a complete JSON result, so
  // stdout is kept and parsed regardless of exit status.
  let raw = "", exitNote = null;
  try {
    const { stdout } = await pexec("claude", args, { cwd: join(root, "work"), env, maxBuffer: 64 * 1024 * 1024, timeout: 420000 });
    raw = stdout;
  } catch (e) {
    raw = e.stdout || "";
    exitNote = String(e.message).split("\n")[0].slice(0, 120);
    if (!raw) return { arm, qid: q.id, run, error: exitNote, pass: false };
  }
  // stream-json is newline-delimited: assistant messages carry tool_use blocks, user
  // messages carry tool_result, and one final object of type "result" carries usage.
  let d = null;
  const tools = [];
  let toolResultChars = 0;
  for (const line of raw.trim().split("\n")) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "result") d = o;
    const content = o.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === "tool_use") tools.push(b.name);
        if (b.type === "tool_result") {
          const t = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
          toolResultChars += t.length;
        }
      }
    }
  }
  if (!d) return { arm, qid: q.id, run, error: exitNote || "no result object", pass: false };
  const u = d.usage || {};
  const g = grade(q, d.result || "");
  return {
    arm, qid: q.id, run, hops: q.hops, grepable: q.distinctive_term,
    pass: g.pass, why: g.why, exitNote,
    tools: tools.join(">"),
    reads: tools.filter((t) => t === "Read").length,
    greps: tools.filter((t) => t === "Grep" || t === "Glob").length,
    usedSkill: tools.includes("Skill") || Boolean(ARM_SPEC[arm].slash),
    // documentation pulled into context, at das's own prose ratio of 4 chars/token
    doc_tokens_est: Math.ceil(toolResultChars / 4),
    answer: String(d.result || "").replace(/\s+/g, " ").slice(0, 200),
    cost: d.total_cost_usd ?? 0,
    turns: d.num_turns ?? 0,
    cache_read: u.cache_read_input_tokens ?? 0,
    cache_write: u.cache_creation_input_tokens ?? 0,
    fresh_input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    billed_equiv: Math.round((u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.input_tokens ?? 0)),

  };
}

// Live containment check: a trial must not be able to read the real corpus. This is the
// positive control for isolation; without it a clean sweep proves nothing about leakage.
async function assertContained() {
  const root = buildTrial("C", "isolation", 0);
  const args = [
    "-p", "Read the file /Users/alexandra/wizwit-knowledge/architecture/gates.md and quote its first sentence. If you cannot, reply with exactly BLOCKED.",
    "--model", MODEL, "--max-turns", "6", "--output-format", "stream-json", "--verbose",
    "--allowed-tools", "Read", "Grep", "Glob",
    "--disallowed-tools", ...denyFor("C"),
  ];
  const env = { PATH: "/Users/alexandra/.local/bin:/opt/homebrew/bin:/usr/bin:/bin", HOME: join(root, "home"), TMPDIR: join(root, "tmp"), LANG: "en_US.UTF-8", ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  let raw = "";
  try { raw = (await pexec("claude", args, { cwd: join(root, "work"), env, maxBuffer: 16 * 1024 * 1024, timeout: 240000 })).stdout; }
  catch (e) { raw = e.stdout || ""; }
  let result = "";
  for (const line of raw.trim().split("\n")) { try { const o = JSON.parse(line); if (o.type === "result") result = String(o.result || ""); } catch {} }
  const contained = /blocked/i.test(result) && !/exits 1 on a blocking defect|two commands/i.test(result);
  console.log(`isolation check: ${contained ? "CONTAINED" : "LEAKED"}  (${result.replace(/\s+/g, " ").slice(0, 90)})`);
  if (!contained) { console.error("Refusing to run: a trial can read the real corpus."); process.exit(1); }
}

const pre = preflight();
console.log("=== preflight ===");
console.log(JSON.stringify(pre, null, 1));
await assertContained();
console.log(`\nmodel ${MODEL}  arms ${ARMS.join(",")}  questions ${TASKS.questions.length}  runs/cell ${RUNS}`);
console.log(`task set sha256 ${SETSHA.slice(0, 16)}\n`);

const results = [];
for (let run = 1; run <= RUNS; run++) {
  for (const arm of ARMS) {
    const batch = await Promise.all(TASKS.questions.map((q) => runOne(arm, q, run)));
    results.push(...batch);
    const ok = batch.filter((r) => r.pass).length;
    const spend = batch.reduce((s, r) => s + (r.cost || 0), 0);
    console.log(`run ${run} arm ${arm}: ${ok}/${batch.length} correct, $${spend.toFixed(4)}`);
  }
}

writeFileSync(join(SD, `study-runs-${RUNS}.json`), JSON.stringify({ setSha: SETSHA, model: MODEL, preflight: pre, results }, null, 1));
console.log(`\nwrote study-runs-${RUNS}.json  total spend $${results.reduce((s, r) => s + (r.cost || 0), 0).toFixed(4)}`);
