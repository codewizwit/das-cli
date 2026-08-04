# das-cli lessons

## Race-free stale-lock breaking was under-budgeted in the plan

**Pattern:** The advisory lockfile (Task 5.2) was specced as a single bite-sized task ("O_EXCL create, break stale, LockBusy sentinel"), but making the stale-BREAK step safe against concurrent processes surfaced three distinct double-acquisition races in successive review rounds:

1. Mid-write empty-file window (two-step open-then-write let a competitor break a lock being written).
2. Blind `rm` in the stale-break (two callers both delete + reacquire the same stale lock).
3. Unconditional `rename` restore in the verify-rollback (clobbers a fresh caller's lock during the absence window).

Each passed a green unit suite and was only caught by review agents running real multi-process race probes.

**Root cause:** Perfectly race-free stale-lock breaking is impossible with POSIX rename/unlink primitives — there is no atomic compare-and-swap on a file. Any "detect stale, then remove, then recreate" sequence has a window.

**Prevention rules:**

- When a plan task involves a concurrency primitive (locks, atomic swaps, shared mutable files), flag it in brainstorming as a likely multi-round task and budget accordingly; do not size it as one bite-sized task.
- For lock utilities specifically: state the operating envelope up front (stale threshold >> critical-section duration so a live holder is never judged stale), design the break as an atomic rename-claim, and require that no path ever overwrites a lock it did not create. Accept and document the inherent residual rather than chasing an impossible perfect guarantee.
- Require real-concurrency stress tests (N callers × many trials, real fs) in the task's test list from the start — a green single-threaded suite proves nothing about a lock.

**Process note:** the controller briefly drifted into hand-implementing the fix across several edits (wrong role — the controller coordinates and reviews). Correct move when a subagent-driven task gets stuck: reset to the last good commit and re-dispatch a fresh agent with a sharper spec, keeping the independent review gate intact.

## A unit-tested, approved function was never wired into the pipeline

**Pattern:** `collapseSingleChildChains` (Task 3.1) had its own passing unit tests and was approved in review, but nothing ever called it from the production `buildTree → sizeTree → planEmission` path. The defect (duplicate headings and doubled directory segments for the common frontmatter-title==H1 case) survived every phase until the Task 9.1 end-to-end suite ran the real assembled pipeline. Separately, `saveManifest` never created its own base directory — a ship-blocking ENOENT on any fresh machine — masked because `manifest.test.ts` handed it an already-created temp dir.

**Root cause:** Per-module unit tests with fakes verify each unit in isolation. They cannot catch (a) a real function that no one calls, or (b) an environmental precondition a fake papered over. "Every unit tested and approved" is not "the assembled system works."

**Prevention rules:**

- Schedule an end-to-end task that runs the REAL wired pipeline (not fakes) against a realistic fixture, and schedule it to actually find bugs — treat a green e2e run that asserts nothing new as a smell.
- For any pure helper that must be invoked by a pipeline, add an integration assertion that the pipeline's OUTPUT reflects the helper's effect, not just a unit test of the helper alone. A DRY shared step (e.g. `buildSizedTree`) that both call sites use is better than two inline sequences that can each forget a step.
- Point at least one test at a first-run-on-a-clean-machine scenario (no pre-existing dirs/config) — directory-creation and other environmental preconditions hide when every fixture pre-creates its scaffolding.

## A heuristic scanner passed synthetic tests but false-fired on 100% of real docs

**Pattern:** The injection scanner (`src/scan/injection.ts`) had a green, thoughtful unit suite with hand-written true-positive and true-negative cases, yet dogfooding `das add --yes` against seven real public docs repos (Prisma, VS Code, Next.js, Node, React, Kubernetes) aborted on all seven — every failure a false positive. Two rules were miscalibrated: prose tripwires (`role-marker`, `always-invoke`) scanned inside fenced code, so `user: 252020,` in a JS sample read as a chat-role marker; and the `always-invoke` cue accepted bare `you must`/`you should`, which saturate ordinary documentation prose ("you must always return an array").

**Root cause:** A precision/recall heuristic's real behavior is a property of the corpus it runs against, not of a handful of author-chosen examples. The synthetic tests encoded what the author imagined an attack and a benign line look like; they could not reveal that the benign class (code samples with `user:` keys, "you should always" advice) dominates real docs and overwhelmingly matches. Passing unit tests measured internal consistency, not field precision.

**Prevention rules:**

- For any heuristic that classifies untrusted real-world input (scanners, detectors, filters), validate against a real corpus before shipping — run it over several representative real inputs and measure the false-positive rate, don't just assert on synthetic fixtures. Treat "0 false positives across N real repos" as an acceptance criterion, and keep a couple of those real strings as regression tests.
- When a safety heuristic's false-positive rate is high, that is itself a safety bug: a tripwire that fires on every input trains the user to bypass it, so it protects nothing. Precision is a security property, not a nicety.
- Keep the real defense (here the untrusted-content frame) distinct from the tripwire, so tuning the tripwire's precision never weakens the guarantee.
