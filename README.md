# session-roster

A Claude Code mod that adds a `/sessions` pane listing every open Claude Code session on your machine, so you can see what each is doing and send it a message.

- **Per session:** name, repo (from the `origin` remote, else the folder name), `busy`/`idle` status with how long ago it changed, and a progress bar (completed/total from the session's task list, or a moving "working" bar when it has none). The bar shows overall progress: solid `█` for finished tasks, `▓` for an estimate of how far the in-progress task is (its elapsed time against the average length of the tasks already finished, 5 min until there are two), and a `~%`. Long waits on tests or background jobs therefore keep the bar creeping forward instead of sitting still.
- **Agent estimates:** the mod adds a short instruction to each session's system prompt asking its agent to keep `~/.claude/session-roster/<sessionId>.json` (`{"pct", "eta_min", "note"}`) up to date for longer work, judged from the complexity of what remains. While a session is busy, the bar shows that estimate (`~60% ~12m left note`); after 20 minutes without an update it is marked `stale`. It takes effect in sessions started after the mod loads.
- **Message a session:** select a row (keys `1`-`9`), type in the box, press Enter. The message arrives in the target as a peer-session message, prefixed with who sent it, so two sessions in one repo can coordinate. A **Sent** log shows each message and the target's live status.
- **Jump to its tmux window:** with a session selected, press `g` (sessions started inside tmux only).
- **Colors** follow your theme.

## Install

At the prompt of a terminal session:

```
/plugin install session-roster --marketplace orkineric/claude-session-roster
```

From a shell:

```
claude plugin install session-roster --marketplace orkineric/claude-session-roster
```

Answer `y` to add the marketplace, then pick a scope. Then run `/sessions`.

## Notes

- Reads `~/.claude/sessions/*.json`, `~/.claude/tasks/` and `~/.claude/session-roster/`; it changes nothing there.
- The liveness check uses `/proc`, so on macOS every session file is listed, including ones that have exited.
- The pane needs a terminal at least 110 columns wide to dock; `/sessions` reopens it.
- Early-access mod API: it may need updating as Claude Code changes.

MIT licensed.
