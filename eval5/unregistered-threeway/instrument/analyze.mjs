// Structural before/after for a das skill. No model in the loop, no API spend.
// Everything here is a property of the emitted bytes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const SD = "/private/tmp/claude-501/-Users-alexandra-projects-das-cli/d7b39eab-51af-42e2-84a1-4350850ade83/scratchpad";
const CORPUS = join(SD, "corpus");

// das's own estimator, src/markdown/tokens.ts: 4 chars/token prose, 3 inside a
// fence, Math.ceil once per segment. Replicated so these numbers are comparable
// to the "est. tokens" columns in the existing eval tables.
function estimateTokens(md) {
  if (md.length === 0) return 0;
  const lines = md.split("\n");
  let insideFence = false, total = 0, seg = [];
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (seg.length > 0) { total += Math.ceil(seg.join("\n").length / (insideFence ? 3 : 4)); seg = []; }
      total += Math.ceil(line.trim().length / 4);
      insideFence = !insideFence;
    } else seg.push(line);
  }
  if (seg.length > 0) total += Math.ceil(seg.join("\n").length / (insideFence ? 3 : 4));
  return total;
}

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

const sha = (b) => createHash("sha256").update(b).digest("hex");
const frontmatter = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fm;
};

// --- corpus
const corpusFiles = walk(CORPUS).filter((f) => f.endsWith(".md"));
const corpusByHash = new Map();
const authoredDescriptions = [];
for (const f of corpusFiles) {
  const buf = readFileSync(f);
  corpusByHash.set(sha(buf), relative(CORPUS, f));
  const d = frontmatter(buf.toString("utf8")).description;
  if (d) authoredDescriptions.push({ file: relative(CORPUS, f), description: d });
}

const report = {};
for (const v of ["main", "new"]) {
  const S = join(SD, `gen-${v}`, ".claude", "skills", "wizwit");
  const files = walk(S).filter((f) => f.endsWith(".md"));
  const skill = readFileSync(join(S, "SKILL.md"), "utf8");

  const isIndex = (f) => /(?:^|\/)(?:index|_das-index)\.md$/.test(f) || f.endsWith("SKILL.md");
  const indexes = files.filter((f) => isIndex(relative(S, f)));
  const resources = files.filter((f) => !isIndex(relative(S, f)));

  // byte fidelity, two ways. Raw never matches, because invariant 5 prepends a
  // one-line untrusted-content frame to every emitted resource. The question
  // that matters is whether the body underneath is the source bytes.
  const stripFrame = (t) => t.replace(/^> [^\n]*\n(?:\n)?/, "");
  const emittedRaw = new Set(resources.map((f) => sha(readFileSync(f))));
  const emittedBody = new Set(resources.map((f) => sha(Buffer.from(stripFrame(readFileSync(f, "utf8")), "utf8"))));
  let identicalRaw = 0, identicalBody = 0;
  for (const h of corpusByHash.keys()) if (emittedRaw.has(h)) identicalRaw++;
  for (const h of corpusByHash.keys()) if (emittedBody.has(h)) identicalBody++;

  // description provenance: authored description reproduced verbatim in some index
  const allIndexText = indexes.map((f) => readFileSync(f, "utf8")).join("\n");
  const authoredUsed = authoredDescriptions.filter((d) => allIndexText.includes(d.description)).length;

  const indexTokens = indexes.reduce((s, f) => s + estimateTokens(readFileSync(f, "utf8")), 0);
  const resourceTokens = resources.reduce((s, f) => s + estimateTokens(readFileSync(f, "utf8")), 0);

  // SKILL.md anatomy
  const fm = frontmatter(skill);
  const body = skill.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const noticeAt = body.search(/untrusted|third-party reference material|treat .* as data/i);
  const firstLinkAt = body.search(/\]\(/);

  report[v] = {
    dasVersion: JSON.parse(readFileSync(join(S, "das.json"), "utf8")).dasVersion,
    files: files.length,
    indexes: indexes.length,
    resources: resources.length,
    maxDepth: Math.max(...files.map((f) => relative(S, f).split("/").length)),
    byteIdenticalRaw: `${identicalRaw}/${corpusFiles.length}`,
    byteIdenticalBody: `${identicalBody}/${corpusFiles.length}`,
    authoredDescriptionsUsed: `${authoredUsed}/${authoredDescriptions.length}`,
    skillMdTokens: estimateTokens(skill),
    indexTokens,
    resourceTokens,
    indexShareOfSkill: ((100 * indexTokens) / (indexTokens + resourceTokens)).toFixed(1) + "%",
    skillDescription: fm.description ?? "(none)",
    noticeBeforeFirstLink: noticeAt >= 0 && firstLinkAt >= 0 ? noticeAt < firstLinkAt : null,
    skillMdMentionsHowToDescend: /read the index|descend|further index|leads to|start here|navigat/i.test(body),
  };
}

const corpusTokens = corpusFiles.reduce((s, f) => s + estimateTokens(readFileSync(f, "utf8")), 0);
console.log(JSON.stringify({ corpus: { files: corpusFiles.length, tokens: corpusTokens, withAuthoredDescription: authoredDescriptions.length }, ...report }, null, 2));
