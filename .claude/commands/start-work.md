---
description: Start a new piece of work — feature branch off latest main + draft PR
---

Start work on: $ARGUMENTS

This repo has NO GitHub issues — never use `gh issue develop`. Do exactly:

1. `git checkout main && git pull --ff-only`
2. `git checkout -b <type>/<slug>` where `<type>` is feat|fix|chore|docs and
   `<slug>` is a short kebab-case description of $ARGUMENTS.
3. If there is nothing to commit yet, seed the branch:
   `git commit --allow-empty -m "chore: start <slug>"` and push.
4. Open a draft PR immediately:
   `gh pr create --draft --base main --title "<type>: <short title>" --body "<one-paragraph intent>"`
5. Report the branch name and PR URL, then begin the work itself.
