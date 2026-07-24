Output demo/das-demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 1240
Set Height 800
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 40ms

Hide
Type "export DEMO=$(mktemp -d) && export HOME=$DEMO && clear"
Enter
Show

Type "das --version"
Enter
Sleep 1500ms

Type "# point das at a docs folder; it slices it into a token-bounded Claude Code skill"
Enter
Type "das add ./demo/sample-docs --yes --scope personal --no-hook"
Enter
Sleep 3500ms

Type "# the big API reference was split into an index plus one file per method"
Enter
Type "ls ~/.claude/skills/sample-docs/resources/api-reference/"
Enter
Sleep 3500ms

Type "# SKILL.md is the token-bounded table of contents Claude loads first"
Enter
Type "sed -n '6,11p' ~/.claude/skills/sample-docs/SKILL.md"
Enter
Sleep 4s

Type "das list"
Enter
Sleep 3s

Hide
Type "rm -rf $DEMO"
Enter
Show
Sleep 1s
