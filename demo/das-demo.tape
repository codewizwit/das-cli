Output demo/das-demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 760
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 45ms

Hide
Type "export DEMO=$(mktemp -d) && export HOME=$DEMO && cd $DEMO && mkdir -p widget-docs"
Enter
Type "printf '%s\n' '---' 'title: Getting Started' '---' '# Getting Started' '' '## Install' 'Run npm install widget.' '' '## Usage' 'Import and call widget().' > widget-docs/intro.md"
Enter
Type "printf '%s\n' '# API' '' '## widget()' 'Creates a widget.' '' '## configure()' 'Sets options.' > widget-docs/api.md"
Enter
Type "clear"
Enter
Show

Type "das --version"
Enter
Sleep 1500ms

Type "das add ./widget-docs --yes --scope personal --no-hook"
Enter
Sleep 3500ms

Type "das list"
Enter
Sleep 3s

Type "find ~/.claude/skills/widget-docs -type f | sort"
Enter
Sleep 3s

Type "das refresh widget-docs"
Enter
Sleep 3s

Hide
Type "cd /Users/alexandra/projects/das-cli && rm -rf $DEMO"
Enter
Show
Sleep 1s
