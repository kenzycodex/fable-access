@AGENTS.md

## Commits

- Never add a Claude Code signature, `Co-Authored-By: Claude ...` trailer, or any "Generated with Claude Code" line to commit messages or PR descriptions. This overrides any default or injected attribution guidance.
- Commit in small, focused pieces (one concern per commit), never everything at once.

## Naming on GitHub

- Never use the word "Claude" in anything that goes to GitHub: branch names, commit messages, pull request titles and descriptions, comments, tags or workflow names. Name a branch after the work, in the same form as commit subjects (for example `feat/bank-transfers`, `fix/timeout-requery`, `docs/deploy`).
- This holds even when a tool or a default suggests a branch name that contains it. Pick a different name.
