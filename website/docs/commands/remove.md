---
id: remove
title: das remove
---

# das remove

```text
Usage: das remove [options] <name>

Remove a registered skill's tracked files

Arguments:
  name             skill name to remove

Options:
  --scope <scope>  disambiguate when both scopes share a name
  --force          delete tracked files even when foreign files are present
                   alongside them
  -h, --help       display help for command
```

Deletes only the files recorded in that skill's [`das.json`](/docs/concepts/das-json) and drops its manifest entry.

| Flag                          | Effect                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scope <personal\|project>` | Disambiguate when a personal and a project skill share a name.                                                                                              |
| `--force`                     | Delete tracked files even when an untracked ("foreign") file is present alongside them; only the tracked files are removed, the foreign file is left alone. |

Without `--force`, a foreign file present alongside the tracked ones refuses the whole operation. See the ownership-record invariant in [Security model](/docs/security).
