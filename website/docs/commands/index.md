---
id: index
title: Command reference
slug: /commands
---

# Command reference

```
das --help
```

```text
Usage: das [options] [command]

Documentation as Skills: convert documentation into a token-bounded Claude Code
skill.

Options:
  -v, --version             output the version number
  -h, --help                display help for command

Commands:
  add [options] <source>    Convert documentation into a Claude Code skill
  refresh [options] [name]  Check or regenerate registered skills
  list                      List every registered skill
  remove [options] <name>   Remove a registered skill's tracked files
  doctor                    Rebuild the manifest from what is actually on disk
  hook                      Manage the das SessionStart hook
  help [command]            display help for command
```

Every command below is generated from and verified against `src/cli/index.ts` in the repo, so the flags here never drift from what the binary actually accepts.

| Command                                           | What it does                                       |
| ------------------------------------------------- | -------------------------------------------------- |
| [`das add <source>`](/docs/commands/add)          | Convert documentation into a Claude Code skill     |
| [`das refresh [name]`](/docs/commands/refresh)    | Check or regenerate registered skills              |
| [`das list`](/docs/commands/list)                 | List every registered skill                        |
| [`das remove <name>`](/docs/commands/remove)      | Remove a registered skill's tracked files          |
| [`das doctor`](/docs/commands/doctor)             | Rebuild the manifest from what is actually on disk |
| [`das hook install`](/docs/commands/hook-install) | Install the `SessionStart` hook                    |
