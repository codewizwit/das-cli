---
id: refresh
title: das refresh
---

# das refresh

```text
Usage: das refresh [options] [name]

Check or regenerate registered skills

Arguments:
  name        skill name to refresh

Options:
  --all       refresh every registered skill
  --hook      run the bounded SessionStart hook refresh
  --update    for a remote skill, fetch and regenerate at the tracked ref's
              current sha
  --force     regenerate a local skill even when its source hash has not changed
  -h, --help  display help for command
```

Re-slices a registered skill from its source. See [Pin-and-check refresh](/docs/concepts/refresh-and-freshness) for how local and remote sources differ.

| Flag       | Effect                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--all`    | Refresh every registered skill. Omit both `name` and `--all` only when passing `--hook`.                                                           |
| `--hook`   | Run the bounded `SessionStart` hook check: personal skills plus project skills under the current directory.                                        |
| `--update` | For a remote skill, clone and regenerate at the tracked ref's current sha. Without it, a remote check only reports whether an update is available. |
| `--force`  | Regenerate a local skill even when its source hash has not changed.                                                                                |

`das refresh --hook` is silent on the happy path; it prints one line per skill with a completed regeneration or an available upstream update.
