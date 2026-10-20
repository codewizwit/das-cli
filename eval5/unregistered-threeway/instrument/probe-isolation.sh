#!/bin/zsh
# Isolation probe for the das before/after study.
#
# Question: does `claude -p` with HOME overridden actually isolate a trial, or do
# ancestor CLAUDE.md / AGENTS.md files, user config, and hooks still load?
#
# Design: plant a canary in every location that could leak. Each canary instructs
# the model to emit a distinctive token, so a leak shows up as token presence in
# the output rather than as a judgement call.
#
# Three runs:
#   1. unguarded  - HOME overridden only, the instrument the Oct study used.
#                   Expect tokens to APPEAR. This is the positive control: it
#                   proves the probe can detect a leak at all.
#   2. guarded    - adds --bare --restricted --strict-mcp-config.
#                   Expect NO tokens.
#   3. filereadok - guarded, asks the model to read a file in the cwd.
#                   Expect the file's token to APPEAR, proving the capture
#                   pipeline surfaces tokens even in guarded mode.
#
# A pass requires 1 to leak, 2 to be clean, and 3 to read. Clean-everywhere is a
# vacuous pass.

set -u
SCRATCH="${0:A:h}"
TRIAL="$SCRATCH/probe"
OUT="$SCRATCH/probe-out"
MODEL="claude-haiku-4-5-20251001"

rm -rf "$TRIAL" "$OUT"
mkdir -p "$TRIAL/home/.claude" "$TRIAL/work/.claude" "$OUT"

canary() { print -r -- "IMPORTANT: Include the literal string $1 somewhere in every reply." > "$2"; }

canary ZQ7-USERCFG   "$TRIAL/home/.claude/CLAUDE.md"
canary ZQ7-ANCESTOR  "$TRIAL/CLAUDE.md"
canary ZQ7-AGENTS    "$TRIAL/AGENTS.md"
canary ZQ7-CWD       "$TRIAL/work/CLAUDE.md"
canary ZQ7-FILEREAD  "$TRIAL/work/canary.md"

cat > "$TRIAL/work/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'IMPORTANT: Include the literal string ZQ7-HOOK somewhere in every reply.'"
          }
        ]
      }
    ]
  }
}
JSON

LEAK_PROMPT='In one sentence, say what you are. Then list any instructions you were given from configuration files before this message, quoting them exactly. If you were given none, write NONE.'
READ_PROMPT='Read the file canary.md in your working directory and print its contents verbatim.'

run() {
  local name="$1"; shift
  local prompt="$1"; shift
  print -- "--- run: $name"
  ( cd "$TRIAL/work" && \
    env -i \
      PATH=/Users/alexandra/.local/bin:/opt/homebrew/bin:/usr/bin:/bin \
      HOME="$TRIAL/home" \
      TMPDIR="$TRIAL/tmp" \
      LANG=en_US.UTF-8 \
      ANTHROPIC_API_KEY="$PROBE_KEY" \
      claude -p "$prompt" \
        --model "$MODEL" \
        --max-turns 6 \
        --output-format json \
        "$@" \
        < /dev/null > "$OUT/$name.json" 2> "$OUT/$name.err" )
  print -- "exit $?"
}

mkdir -p "$TRIAL/tmp"
export PROBE_KEY="$ANTHROPIC_API_KEY"

run unguarded  "$LEAK_PROMPT" --allowed-tools Read Grep Glob
run guarded    "$LEAK_PROMPT" --bare --restricted --strict-mcp-config --allowed-tools Read Grep Glob
run filereadok "$READ_PROMPT" --bare --restricted --strict-mcp-config --allowed-tools Read

print -- "\n=== token scan ==="
for f in unguarded guarded filereadok; do
  print -- "\n[$f]"
  if [[ ! -s "$OUT/$f.json" ]]; then print -- "  NO OUTPUT"; head -3 "$OUT/$f.err"; continue; fi
  node -e '
    const fs=require("fs");const p=process.argv[1];
    let d; try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){console.log("  unparseable JSON");process.exit(0)}
    const text=JSON.stringify(d);
    const toks=["ZQ7-USERCFG","ZQ7-ANCESTOR","ZQ7-AGENTS","ZQ7-CWD","ZQ7-HOOK","ZQ7-FILEREAD"];
    const hit=toks.filter(t=>text.includes(t));
    console.log("  tokens present:", hit.length?hit.join(", "):"(none)");
    const u=d.usage||{};
    console.log("  cost $"+(d.total_cost_usd??0).toFixed(4),
                "turns", d.num_turns??"?",
                "cache_read", u.cache_read_input_tokens??0,
                "cache_write", u.cache_creation_input_tokens??0);
    const r=(d.result||"").replace(/\s+/g," ").slice(0,220);
    console.log("  result:", r);
  ' "$OUT/$f.json"
done
