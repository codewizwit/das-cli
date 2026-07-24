Output demo/das-demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1240
Set Height 940
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 45ms

Hide
Type "export DEMO=$(mktemp -d) && export HOME=$DEMO && clear"
Enter
Show

Type "# das add walks you through an interactive wizard"
Enter
Type "das add ./demo/sample-docs --token-budget 900"
Enter
Sleep 3s

Enter
Sleep 1500ms

Type "widget-sdk"
Enter
Sleep 1500ms

Type "Widget SDK reference"
Enter
Sleep 1500ms

Type "n"
Enter
Sleep 3s

Type "# the big API reference was sliced into an index plus one file per method"
Enter
Type "ls ~/.claude/skills/widget-sdk/resources/api-reference/"
Enter
Sleep 3500ms

Hide
Type "rm -rf $DEMO"
Enter
Show
Sleep 1s
