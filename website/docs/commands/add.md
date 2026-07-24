---
id: add
title: das add
---

# das add

```text
Usage: das add [options] <source>

Convert documentation into a Claude Code skill

Arguments:
  source                GitHub URL or local path to convert

Options:
  --scope <scope>       install scope: personal or project
  --name <name>         skill name
  --description <text>  skill description
  --no-hook             skip the SessionStart hook prompt and install
  --yes                 accept every default non-interactively
  --include-large       include files over the 1MB size guard instead of
                        skipping them
  --token-budget <n>    per-file token budget
  --force               overwrite a name collision with a skill from a different
                        source
  -h, --help            display help for command
```

Resolves the source, previews the generated skill (name, description, section tree, injection-scan findings), runs the interactive wizard for anything not given as a flag, writes the skill, and registers it.

| Flag                          | Effect                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scope <personal\|project>` | Install into `~/.claude/skills` or `<project>/.claude/skills`.                                                                                             |
| `--name <name>`               | Skill name; otherwise asked in the wizard.                                                                                                                 |
| `--description <text>`        | `SKILL.md` frontmatter description; otherwise asked in the wizard.                                                                                         |
| `--no-hook`                   | Skip the `SessionStart` hook prompt and install.                                                                                                           |
| `--yes`                       | Accept every default non-interactively. Also aborts instead of silently proceeding if the [injection scan](/docs/security#injection-scan) finds something. |
| `--include-large`             | Include files over the 1MB size guard instead of skipping them.                                                                                            |
| `--token-budget <n>`          | Per-file token budget; see [Progressive disclosure](/docs/concepts/progressive-disclosure).                                                                |
| `--force`                     | Overwrite a name collision with a skill from a different source.                                                                                           |

See [Add a remote library's docs](/docs/guides/add-a-remote-library) and [Add a local docs folder](/docs/guides/add-local-docs) for worked examples.
