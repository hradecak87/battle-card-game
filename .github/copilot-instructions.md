# Project Instructions — Battle Card Game V2

## Progress tracking

`docs/superpowers/PROGRESS.md` is the authoritative snapshot of the current
application/implementation state (what's done, what's in progress, exact next
steps, key decisions/conventions).

- **Always read `docs/superpowers/PROGRESS.md` first** when resuming work on
  this project, especially after a context compaction or in a new session.
- **Always update `docs/superpowers/PROGRESS.md`** whenever you complete a
  step, change approach, or make a decision worth remembering — keep it
  current, not just as a one-time snapshot. Update it proactively before
  wrapping up a turn if meaningful progress was made, not only when asked.

## Other references

- Specs live in `docs/superpowers/specs/`.
- Implementation plans live in `docs/superpowers/plans/`.

## Known environment gotcha: `npm run dev` / `npm run build` hangs forever

If `npm run dev` or `npm run build` gets stuck at `✓ Starting...` (or after
the Next.js banner) with no further output and near-zero CPU usage on the
node process — **do not just wait longer or blame the environment.** This
has a known, confirmed cause: a **stale/orphaned `next dev` (or `next build`)
process from an earlier session is still running** and holding a file lock
on `.next/` or the dev port, blocking the new process from progressing (the
same root cause was previously diagnosed and fixed in the separate LevelUp
project — see its session history for "EPERM ... .next/trace").

**Fix, in order:**
1. List all node processes with their full command lines:
   `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Select-Object ProcessId, CreationDate, CommandLine`
2. Identify any process whose `CommandLine` references this project's path
   and `next dev` / `next build` / `start-server.js`, especially ones with an
   old `CreationDate` (from a previous, already-"finished" turn or a
   `detach: true` server you forgot was still running).
3. Kill all of them: `Stop-Process -Id <id1>,<id2>,... -Force`
4. Delete `.next/` (`Remove-Item -Recurse -Force .next`) to clear any
   half-written state, then start a single fresh `npm run dev`/`npm run
   build`.
5. Only after confirming exactly one relevant node process is running should
   you retry and wait for `✓ Ready in Xs`.

Avoid leaving multiple detached dev servers running across turns — prefer
reusing one long-lived `mode="async", detach: true` dev server for the whole
session instead of starting a new one each time.
