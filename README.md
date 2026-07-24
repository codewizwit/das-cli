# das

**Documentation as a Skill.** Point `das` at a GitHub URL, a Markdown file, a docs folder, or a project root, and it slices the documentation into a token-bounded, progressive-disclosure Claude Code skill: a `SKILL.md` table of contents plus a tree of resource files, each sized to fit inside a budget. Claude loads the index, then only the sections it actually needs.

```
das add https://github.com/prisma/docs
```

That one command turns any library's documentation into a fresh, local skill Claude Code can navigate. This is the case plain grep cannot reach: a normal docs search either dumps far more text than a session's budget can hold, or misses the section that answers the question because it never had a table of contents to search from. `das` builds that table of contents, keeps each leaf inside a token budget, and keeps the whole thing current without ever silently rewriting what it built from an upstream change.

## Honest guidance on local docs

If your project already has a small `docs/` folder, you may not need `das` at all. A one-line pointer in your `CLAUDE.md` ("see `docs/` for API reference") is often enough for a docs set that already fits comfortably in context.

`das` earns its keep in three situations:

- **Remote sources.** Any GitHub repository's documentation becomes a local, versioned skill without you cloning it yourself or writing an adapter.
- **Oversized docs.** A `docs/` folder too large to load in one shot needs slicing into a navigable tree.
- **MDX-heavy sources.** Docusaurus, Starlight, and similar sites carry frontmatter, tabs, and admonitions that plain Markdown ingestion mangles; `das` understands them.

Your documentation site (Docusaurus, MkDocs, Starlight, or plain Markdown) stays the human-facing source of truth. `das` makes the same source legible to Claude Code without duplicating it by hand.

## Install

Run it once, no install, with `npx`:

```
npx @codewizwit/das-cli add https://github.com/org/repo
```

Or install the binary globally:

```
npm install -g @codewizwit/das-cli
das add https://github.com/org/repo
```

The package installs two equivalent commands, `das` and `das-cli`; use whichever you prefer. Requires Node >= 20.12.0.

**Develop:** to run `das` from a checkout of this repo instead of the published package:

```
pnpm install
pnpm build
```

This builds the `das` binary declared in `package.json` (`bin.das` -> `dist/bin/das.js`).

## Quickstart

```
das add https://github.com/org/repo
```

Running `das add` with no flags walks an interactive wizard: install scope (personal or project), skill name, description, and whether to install the `SessionStart` hook that keeps the skill fresh. Every wizard step has a corresponding flag, and `--yes` accepts every default non-interactively:

```
das add https://github.com/org/repo --yes
```

Once a skill exists, check on it:

```
das list
das refresh <name>
```

## Command reference

| Command              | Flags                                                                                                                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `das add <source>`   | `--scope <personal\|project>`, `--name <name>`, `--description <text>`, `--no-hook`, `--yes`, `--include-large`, `--token-budget <n>`, `--force` | Resolves the source, previews the generated skill (name, description, section tree, injection-scan findings), runs the wizard for anything not given as a flag, writes the skill, and registers it. `--force` overwrites a name collision with a skill from a different source.                                                                                                              |
| `das refresh [name]` | `--all`, `--hook`, `--update`, `--force`                                                                                                         | Re-slices a registered skill from its source. `--all` refreshes every registered skill; omit both `name` and `--all` only when passing `--hook`. `--update` fetches and regenerates a remote skill at its tracked ref's current commit; without it, a remote check only reports whether an update is available. `--force` regenerates a local skill even if its source hash has not changed. |
| `das refresh --hook` |                                                                                                                                                  | The bounded check the `SessionStart` hook runs: personal skills plus project skills under the current directory. Local sources re-slice on a hash change; remote sources get a `git ls-remote` check only, never a content change. Silent on the happy path; prints one line per skill with a completed regeneration or an available upstream update.                                        |
| `das list`           |                                                                                                                                                  | Lists every registered skill: name, source, scope, pinned ref/sha, last refresh, staleness, and whether an update is available, plus the aggregate token cost of loading every registered skill's description each session.                                                                                                                                                                  |
| `das remove <name>`  | `--scope <personal\|project>`, `--force`                                                                                                         | Deletes only the files recorded in that skill's `das.json` and drops its manifest entry. Refuses if an untracked ("foreign") file is present alongside the tracked ones, unless `--force` is passed, in which case only the tracked files are removed and the foreign file is left alone. `--scope` disambiguates when a personal and a project skill share a name.                          |
| `das doctor`         |                                                                                                                                                  | Rebuilds the manifest cache from what is actually on disk (scanning `.claude/skills` directories for a valid `das.json`) and reports what was added, removed, or had its path updated.                                                                                                                                                                                                       |
| `das hook install`   | `--project`, `--yes`                                                                                                                             | Installs the `SessionStart` hook (`das refresh --hook`) into personal settings by default. `--project` installs into the project's committed `.claude/settings.json` instead, which runs the hook for every collaborator who checks the project out; that path prints a warning and requires confirmation (or `--yes` to skip it).                                                           |

## How it works

```
resolve -> slice -> render -> write
```

1. **Resolve.** A GitHub URL, file, folder, or project root is normalized into an ordered set of Markdown files. Frontmatter (`title`, `sidebar_position`, `draft`) and MDX constructs (imports, tabs, admonitions, self-closing components) are parsed and normalized.
2. **Slice.** The fileset becomes a normalized heading tree, sized bottom-up. A subtree that fits the token budget is inlined as one file; a subtree that doesn't becomes an index whose table of contents links to its children, recursing. Chains of single-child nodes collapse into one level, and an oversized table of contents is chunked into grouped index files, deterministically, so the whole tree stays navigable. Every emitted file is within budget except an atomic oversized leaf or index, which is emitted whole and surfaced as a warning when `das add` finishes, rather than silently truncated.
3. **Render.** The plan becomes full file contents: `SKILL.md` with `name`/`description` frontmatter, resource files with a one-line untrusted-content frame, and linked tables of contents with one-line summaries.
4. **Write.** The complete tree is built in a temp directory and swapped into place atomically, so a crash or timeout mid-generation never leaves a half-written skill on disk.

Freshness works differently for local and remote sources. A **local** source is re-hashed on every `SessionStart`; a changed hash triggers an automatic re-slice, no confirmation needed, since nothing left your machine. A **remote** source is pinned to an exact commit sha at `das add` time; the hook only ever runs `git ls-remote` to check whether the tracked ref has moved, never a clone, and never changes content on its own. When it has moved, `das` prints one line telling you to run `das refresh <name> --update`, which clones at the new sha, shows you a changed-file summary, re-runs the injection scan, and only then regenerates and re-pins.

## Security model

Every file `das` generates carries an **untrusted-content frame**: `SKILL.md` opens with a fixed notice that the content is third-party reference material to be treated as data, never as instructions to act on, and every other generated file carries a one-line version of the same frame. This is the primary defense against a documentation source trying to hijack a session that reads it.

Alongside the frame, an **injection scan** runs at `das add` and at `das refresh --update` on changed content, flagging instruction-override phrasing, role markers (`system:`, `assistant:`), always-invoke imperatives aimed at the assistant, tool-call-shaped fenced blocks, and download-and-execute one-liners (`curl ... | sh`, `base64 -d | sh`). A finding requires explicit confirmation to proceed; `--yes` aborts instead of silently accepting it. The scan works as a secondary tripwire, surfacing suspicious shapes before install; the untrusted-content frame is what actually protects a session.

Cloning a remote source is hardened: `GIT_TERMINAL_PROMPT=0`, an empty `GIT_ASKPASS`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_LFS_SKIP_SMUDGE=1`, symlinks disabled in the clone (`core.symlinks=false`), no submodule recursion, a shallow blob-filtered clone at a pinned sha, and every argument passed as an argument vector, never through a shell. Only `https://github.com/<org>/<repo>` and its `/tree/<ref>/<subpath>` and `/blob/<ref>/<file>` forms are accepted; every other URL shape is rejected. Resolved filesets, local or remote, are capped at 5000 files and 100MB of content.

`das` never follows a symlink, anywhere: not while resolving a source, not while writing a skill, and not while deleting one. A symlinked file or folder inside a resolved source is skipped (or, if the source path itself is a symlink, rejected outright); a symlink encountered anywhere inside a skill directory being removed or overwritten refuses the whole operation rather than resolving through it.

**`das.json`, written alongside every generated skill, is the ownership record.** Its `generatedFiles` list is the only thing `das remove` and the transactional write ever delete or replace; a foreign file present alongside the tracked ones refuses the operation unless `--force` is passed, and even then only the tracked files go. Every skill path is re-derived from scope and name and asserted to resolve directly inside `~/.claude/skills/` or `<project>/.claude/skills/`, regardless of what the manifest cache claims, so a corrupted or tampered manifest entry can never point deletion somewhere it shouldn't.

The manifest cache is protected by an advisory lockfile so two `das` processes never co-write it at once. That lock works as a **lease**: a lock is only ever judged stale once its age exceeds a threshold set far larger than any real critical section, which keeps a live holder from being mistaken for an abandoned one as long as that gap holds. It is a single-machine advisory lock, sized for the manifest-writing operations it actually guards.

## Status

This is a single-maintainer build. `das add`, `refresh`, `list`, `remove`, `doctor`, and `hook install` are implemented and covered by the test suite (`pnpm test`). `pnpm build` produces the `das` binary, and it is published to npm as [`@codewizwit/das-cli`](https://www.npmjs.com/package/@codewizwit/das-cli).
