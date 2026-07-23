# das-cli lessons

## Race-free stale-lock breaking was under-budgeted in the plan

**Pattern:** The advisory lockfile (Task 5.2) was specced as a single bite-sized task ("O_EXCL create, break stale, LockBusy sentinel"), but making the stale-BREAK step safe against concurrent processes surfaced three distinct double-acquisition races in successive review rounds:

1. Mid-write empty-file window (two-step open-then-write let a competitor break a lock being written).
2. Blind `rm` in the stale-break (two callers both delete + reacquire the same stale lock).
3. Unconditional `rename` restore in the verify-rollback (clobbers a fresh caller's lock during the absence window).

Each passed a green unit suite and was only caught by review agents running real multi-process race probes.

**Root cause:** Perfectly race-free stale-lock breaking is impossible with POSIX rename/unlink primitives — there is no atomic compare-and-swap on a file. Any "detect stale, then remove, then recreate" sequence has a window.

**Prevention rules:**

- When a plan task involves a concurrency primitive (locks, atomic swaps, shared mutable files), flag it in brainstorming as a likely multi-round task and budget accordingly; do not size it as one bite-sized task.
- For lock utilities specifically: state the operating envelope up front (stale threshold >> critical-section duration so a live holder is never judged stale), design the break as an atomic rename-claim, and require that no path ever overwrites a lock it did not create. Accept and document the inherent residual rather than chasing an impossible perfect guarantee.
- Require real-concurrency stress tests (N callers × many trials, real fs) in the task's test list from the start — a green single-threaded suite proves nothing about a lock.

**Process note:** the controller briefly drifted into hand-implementing the fix across several edits (wrong role — the controller coordinates and reviews). Correct move when a subagent-driven task gets stuck: reset to the last good commit and re-dispatch a fresh agent with a sharper spec, keeping the independent review gate intact.
