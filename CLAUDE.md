# das-cli: guidance for Claude Code sessions in this repo

`das` (Documentation as a Skill) converts a GitHub URL, Markdown file, docs folder, or project root into a token-bounded, progressive-disclosure Claude Code skill. Read `README.md` for the user-facing command reference and `docs/architecture.md` for the pipeline and diagrams before making structural changes.

## Sources of truth

- **Design spec:** `docs/superpowers/specs/2026-07-22-das-design.md`. Every budget, hardening flag, and validation rule is copied from it. On a conflict between the spec and the code, treat the code as the built behavior and flag the divergence rather than silently trusting either one.
- **Implementation plan:** `docs/superpowers/plans/2026-07-22-das-cli.md`. Phase-by-phase task breakdown, file structure, and the branch-per-phase history.
- **`tasks/lessons.md`:** hard-won lessons from this build, each with a prevention rule. Read it before touching locking, manifest rebuilding, or anything wired across module boundaries; both recorded lessons came from exactly those areas.

## Architecture: pure core, effectful shell

Parsing, tree building, sizing, emission planning, slug and ordering logic, and the injection scan are pure functions over in-memory values: `buildTree`, `sizeTree`, `planEmission`, `sanitizeSlug`, `compareDocOrder`, `scanForInjection`, and friends. They take data in, return data out, and touch no filesystem, network, clock, or TTY. Test these directly with fixtures; no dependency injection needed.

Filesystem, git, locking, the system clock, and interactive prompts are effects, and every function that needs one takes it as an injected dependency rather than importing it directly. `src/refresh/refresh.ts`'s `RefreshDeps`, `src/cli/add.ts`'s `RunAddDeps`, and the equivalent `RunXCommandDeps` interfaces in every other `src/cli/*.ts` file are the shape of this: an interface listing every effectful function a piece of logic needs, a pure `runX(args, deps)` core that never imports a concrete implementation, and a `createProductionXDeps()` factory in `src/cli/index.ts` that wires the real filesystem/git/clock functions for the actual `das` binary.

Each Commander command in `src/cli/index.ts` is a thin shell: parse flags into an `Args` object, call `createProductionXDeps()`, call the `runX` core, translate the outcome (or a thrown error) into stdout/stderr output and an exit code. All decision logic lives in the `runX` core; the Commander action handler only translates its result. When adding or changing a command, put new behavior in the core and keep the Commander wiring a translation layer only.

Tests for a `runX` core inject fakes for every `Deps` function; nothing under `test/cli/` touches a real filesystem, git process, or clock. Exercising the real, wired pipeline end to end belongs in the integration suite (Phase 9), separate from per-command unit tests.

## Workflow this repo was built with

- **Strict TDD.** Write the failing test, watch it fail, implement the minimal code to pass, watch it pass, commit. Never delete or weaken a failing test to make it pass; fix the code under test.
- **One task per branch/phase.** The plan defines phase branches (`chore/scaffold`, `feat/markdown-core`, `feat/resolver`, `feat/slicer`, `feat/emitter`, `feat/state`, `feat/refresh`, `feat/scan`, `feat/cli`, `feat/integration`), each with its own tasks, its own commits, and its own PR referencing the GitHub issues it closes.
- **Independent review.** Each phase's work was reviewed by an agent that did not write it before merging, specifically to catch the class of bug a same-agent self-review misses (see `tasks/lessons.md`: an approved, unit-tested function that nothing ever called; an environmental precondition a test fixture papered over).
- **Conventional commits**, every commit body ending with the `Co-Authored-By` trailer this build has used throughout. Match that convention on any new commit in this repo.

## Load-bearing safety invariants

These are the properties later code must not accidentally break. Each one has tests defending it; do not "simplify" past them.

1. **`das.json`'s `generatedFiles` list is the ownership record and the only thing deletion or overwrite ever touches.** `das remove` (`src/cli/remove.ts`) and the transactional write (`src/emitter/write.ts`) operate only on paths listed there. A foreign file present alongside tracked ones refuses the whole `remove` unless `--force` is passed, and even then only the tracked files go. Never widen a delete or overwrite to "everything in the skill directory."

2. **Never delete or write outside a re-derived, verified skill path.** `assertManagedPath` (`src/state/manifest.ts`) checks that a skill path's _parent directory_ exactly equals an allowed `.claude/skills` root, which is what keeps a similarly named sibling like `skills-evil` from passing as managed (a prefix check would let it through). That check is **lexical only** (`path.resolve` plus a string comparison, with no `lstat`), so on its own it leaves a symlinked skill directory unguarded. The actual last line of defense against a symlink is the explicit `lstat` refusal in `writeSkillTransactional` (`assertOwnable`) and in `runRemoveCommand`/`collectManagedFiles`. If you touch either of the lexical-check call sites, keep the paired `lstat` refusal alongside it: the lexical check alone never covers that case.

3. **The advisory lock (`src/state/lock.ts`) behaves as a lease.** `withLock` judges a lockfile stale once `now() - timestamp >= staleMs`, and a live holder must never be judged stale. This only holds if `staleMs` is set far larger than any realistic critical section (the default is 10 minutes; manifest writes take milliseconds). **Never pass a small `staleMs`** to make a test run faster or a check feel more responsive: shrinking it is exactly the change that turns a live holder into a "stale" one mid-operation, silently reintroducing the double-acquisition race `tasks/lessons.md` documents. If a test needs to exercise stale-lock breaking, fake the clock (`options.now`) to control staleness instead.

4. **The `SessionStart` hook never mutates remote content.** `refreshRemoteSkill` in hook mode only ever calls `git ls-remote`; the only path that clones and regenerates a remote skill is `mode.kind === "interactive" && mode.update === true`, reached solely through an explicit `das refresh <name> --update`. If you touch `src/refresh/refresh.ts`, keep this branch structure: a hook-mode remote check must remain read-only no matter what else changes around it.

5. **Every generated file carries the untrusted-content frame.** `src/emitter/render.ts` opens `SKILL.md` with a fixed notice and every other generated file with a one-line version of the same frame, framing the sliced documentation as third-party data, never as instructions. This frame is the primary defense against a hostile documentation source; the injection scan (`src/scan/injection.ts`) is a secondary tripwire. If you add a new emitted file type, it needs the frame too.

## Before changing generation output

Snapshot and hash-based tests assume deterministic output: the same input fileset and parameters must produce the same bytes. If a change to the slicer or emitter is intentional and changes generated output, expect and update the affected fixtures, and remember that `sourceHash` (`src/state/hash.ts`) also covers `slicerVersion`, so a deliberate behavior change to slicing should bump `SLICER_VERSION` in `src/emitter/das-json.ts` rather than silently reusing the old version number.
