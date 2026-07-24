# Build notes: das-cli documentation site (issue #42)

## Pages

Scaffolded with `create-docusaurus@latest ... classic --typescript`, then stripped of the default blog, tutorial docs, and homepage feature grid, and rebuilt to the structure the issue specifies.

- **Getting started** (`docs/intro.md`, slug `/docs/intro`): install, quickstart, the two-command note (`das`/`das-cli`), Node requirement, a pointer to local docs.
- **Concepts** (`docs/concepts/`): four focused pages, each skimmable in under a minute and cross-linked rather than repeating each other.
  - `progressive-disclosure.md`: leads with a real generated skill tree and `SKILL.md` table of contents (captured from an actual `das add` run, see below), then explains the inline-vs-index decision and links to the architecture diagram for the full decision tree.
  - `refresh-and-freshness.md`: leads with the pin-and-check sequence diagram reused verbatim from `docs/architecture.md`, then the SessionStart hook.
  - `das-json.md`: leads with a real captured `das.json`, explains the ownership-record invariant.
  - `remote-vs-local.md`: remote-first positioning and the honest "you may not need this" guidance, written fresh rather than copied from the README.
- **Command reference** (`docs/commands/`): an index page plus one page per command (`add`, `refresh`, `list`, `remove`, `doctor`, `hook-install`), each leading with the command's real `--help` output. See verification below.
- **Guides** (`docs/guides/`): add a remote library, add a local docs folder, the hook workflow, committed team skills. Each leads with a runnable command block and links to the concept/command pages that back it, rather than re-explaining them.
- **Security model** (`docs/security.md`): leads with the real untrusted-content frame captured from a generated `SKILL.md`, then the injection scan, git clone hardening, symlink refusal, and the lock lease, written fresh from `CLAUDE.md`'s invariants rather than copy-pasted from the README.
- **Architecture** (`docs/architecture.md`): the resolve/slice/render/write pipeline flowchart and the skill-tree emission flowchart, reused verbatim from `docs/architecture.md` in the repo (per the issue's DRY instruction for this page specifically). The refresh sequence diagram lives once, on the refresh concept page, and is linked from here instead of repeated.
- **Homepage** (`src/pages/index.tsx`): visual-first hero, a real annotated command plus the real generated tree, no marketing copy, buttons straight to Getting started and Command reference.

No page duplicates another's facts; every cross-reference is a link, and the command reference is the single source for flags.

## Command reference verification against `src/cli/index.ts`

Every command page's `--help` block was captured by running the actual built binary, not hand-typed:

```
pnpm build
node dist/bin/das.js --help
node dist/bin/das.js add --help
node dist/bin/das.js refresh --help
node dist/bin/das.js list --help
node dist/bin/das.js remove --help
node dist/bin/das.js doctor --help
node dist/bin/das.js hook install --help
```

The flag tables underneath each block were checked line-by-line against the `.option(...)` calls in `src/cli/index.ts` for that command. Nothing in the command pages is a hand-copied flag that could drift; if a flag changes in the code, re-running the commands above and diffing against the docs is the whole verification step.

## Dogfood check

Ran `das add` against this site's own `website/docs` folder (via a script that wires the same production dependencies `src/cli/index.ts` uses, with an isolated scratch home directory so the real machine's `~/.claude` state was never touched). Result: a clean 8-file skill (`SKILL.md` index + 6 `resources/*.md` + `das.json`).

One real finding worth noting: the injection scan flagged 3 patterns in `docs/security.md`, because that page documents the scan's own trigger phrases (`curl ... | sh`, "always-invoke imperatives"). This is an expected false positive from writing about the scanner, not a bug; confirming past it (the same path an interactive `das add` takes) produces the skill normally. The equivalent check against the real repo, once this branch is merged, is:

```
das add https://github.com/codewizwit/das-cli/tree/main/website/docs
```

## Deploy setup

`.github/workflows/docs.yml`: two jobs, `build` (checkout, Node 20, `npm ci` + `npm run build` in `website/`, `actions/configure-pages`, `actions/upload-pages-artifact`) and `deploy` (`actions/deploy-pages`, `github-pages` environment). Triggers only on `push` to `main`, path-filtered to `website/**`, `docs/**`, `README.md`; nothing runs on a PR. `permissions: { pages: write, id-token: write }` at the workflow level, `contents: read` otherwise.

`docusaurus.config.ts`: `url: https://codewizwit.github.io`, `baseUrl: /das-cli/`, `organizationName: codewizwit`, `projectName: das-cli`, `onBrokenLinks: throw` (and the markdown-hooks equivalent), `@docusaurus/theme-mermaid` registered via `themes` and `markdown.mermaid: true`.

## Ambiguous decisions taken without blocking

- **Theme color**: the issue didn't specify branding, so the site keeps Docusaurus's classic layout with a plain indigo accent (`#3452e1` light / `#7f97ec` dark) instead of the stock Docusaurus green, and drops the default dinosaur logo/social-card assets. A clean, minimal default consistent with a developer tool; swap `src/css/custom.css` if a real brand palette shows up later.
- **Docs route**: kept the default `/docs/...` base path rather than mounting docs at site root, so the homepage (`src/pages/index.tsx`) and the docs sidebar don't fight over the `/` route.
- **`docs/architecture.md`'s own diagrams and `docs/architecture.md`/`README.md`/`CLAUDE.md` in the repo are left untouched**, per the constraint; the site only reads from them.
