---
id: committed-team-skills
title: Committed team skills
---

# Committed team skills

```bash
das add https://github.com/org/internal-docs --scope project --name internal-docs --yes
git add .claude/skills/internal-docs .claude/settings.json
git commit -m "docs: add internal-docs skill"
```

`--scope project` writes the skill into `<project>/.claude/skills`, which is a normal directory you commit like any other project file. Every teammate who checks the project out gets the same skill immediately, with no `das add` of their own required.

Pair this with a project-scoped hook (`das hook install --project`, see [The hook workflow](/docs/guides/hook-workflow)) so the whole team's skills stay current the same way, not just yours. `das list` and `das doctor` work the same on a committed project skill as on a personal one; see [`das.json`](/docs/concepts/das-json) for what gets committed alongside `SKILL.md`.
