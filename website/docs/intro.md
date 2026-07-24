---
id: intro
title: Getting started
sidebar_position: 1
slug: /intro
---

# Getting started

```bash
das add https://github.com/org/repo
```

That one command turns a GitHub repository's documentation into a local, progressive-disclosure Claude Code skill: a `SKILL.md` table of contents plus a tree of resource files, each sized to fit inside a token budget. See [Progressive disclosure](/docs/concepts/progressive-disclosure) for what the generated tree looks like.

## Install

Run it once with `npx`, no install:

```bash
npx @codewizwit/das-cli add https://github.com/org/repo
```

Or install the binary globally:

```bash
npm install -g @codewizwit/das-cli
das add https://github.com/org/repo
```

The package installs two equivalent commands, `das` and `das-cli`; use whichever you prefer. Requires Node >= 20.12.0.

## Quickstart

Running `das add` with no flags walks an interactive wizard: install scope (personal or project), skill name, description, and whether to install the `SessionStart` hook that keeps the skill fresh (see [The SessionStart hook](/docs/concepts/refresh-and-freshness)). Every wizard step has a corresponding flag; `--yes` accepts every default non-interactively:

```bash
das add https://github.com/org/repo --yes
```

Once a skill exists, check on it:

```bash
das list
das refresh <name>
```

Full flags for every command live in the [command reference](/docs/commands).

## Local docs, not just GitHub

`das add` also accepts a local Markdown file, a docs folder, or a project root:

```bash
das add ./docs
```

See [Add a local docs folder](/docs/guides/add-local-docs) for when this is worth doing over a plain `CLAUDE.md` pointer.
