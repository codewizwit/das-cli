Output demo/das-demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1280
Set Height 1000
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 40ms

Hide
Type "export DEMO=$(mktemp -d) && export HOME=$DEMO && clear"
Enter
Show

Type "# point das at a whole org handbook (26 files across onboarding, services, runbooks, security...)"
Enter
Type "das add ./demo/sample-docs --token-budget 500"
Enter
Sleep 4500ms

Enter
Sleep 1500ms

Type "acme-handbook"
Enter
Sleep 1500ms

Type "Acme engineering handbook"
Enter
Sleep 1500ms

Type "n"
Enter
Sleep 3s

Type "# das mapped it into a token-bounded skill: a table of contents plus a browsable tree"
Enter
Type "ls ~/.claude/skills/acme-handbook/resources/"
Enter
Sleep 3s

Type "# each big area drills down into an index plus one file per page"
Enter
Type "ls ~/.claude/skills/acme-handbook/resources/services/"
Enter
Sleep 3500ms

Hide
Type "rm -rf $DEMO"
Enter
Show
Sleep 1s
