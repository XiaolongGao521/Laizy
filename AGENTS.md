# AGENTS.md

This file provides guidance to AI coding agents working in the Laizy repository.

## Required workflow
- Make a git commit for every user request that changes code, config, docs, or prompts in this repository.
- Push immediately after every commit. Do not leave local-only commits behind.
- For multi-step features or changes spanning multiple files/systems, use the Ralph loop workflow from the workspace root.
- `ralph-loop.sh` is the canonical continuous implementation runner and is intended to work for any repo, not just its default target.
- If the default repo/plan is wrong for the task, override it explicitly instead of avoiding the loop.
- For this repository, prefer one of these entry points:
  - `npm run ralph:plan` to produce or refresh the implementation plan.
  - `npm run ralph:build` to execute the plan milestone-by-milestone.
  - or invoke the workspace-root script directly with explicit repo/plan overrides when running against a different repo, for example:
    - `/root/.openclaw/workspace/ralph-loop.sh --repo /root/.openclaw/workspace/Laizy --mode planning`
    - `/root/.openclaw/workspace/ralph-loop.sh --repo /root/.openclaw/workspace/Laizy --mode build --plan /root/.openclaw/workspace/Laizy/IMPLEMENTATION_PLAN.md`
- The loop should keep going until all unchecked (`[ ]`) checkpoints in the implementation plan are completed, unless a hard blocker or explicit stop instruction interrupts it.
- Do not stop after a single small checkpoint if the plan still has unchecked milestones remaining.
- Whenever `ralph-loop.sh` is started or resumed for this repo, also ensure the Ralph watchdog cron job for the current session/chat is created or enabled.
- For multi-step Ralph-style implementation work in this repo, use a three-worker conveyor with stable labels:
  - `laizy-implementer` — actively executes the next milestone(s), updates the repo, commits, and pushes.
  - `laizy-watchdog` — inspects implementer progress on cadence, stays quiet when healthy, and decides when recovery is needed.
  - `laizy-recovery` — handles safe in-repo conveyor repair/restart work when the implementer stalls, exits unexpectedly, or needs a safe continuation handoff.
- Re-enable or create the 5-minute watchdog cron whenever this conveyor is active, even if the watchdog had been paused earlier.
- The watchdog cron should nudge the main session every 5 minutes so it can ask `laizy-watchdog` to inspect `laizy-implementer`; if stalled, delegate safe repair/continuation to `laizy-recovery` and resume the implementation loop.
- If the current Discord/OpenClaw surface does not allow thread-bound persistent worker sessions, keep the implementer running as a normal subagent run, let the main-session 5-minute cron emulate the watchdog cadence, and spawn the recovery worker on demand when a stall is detected.
- The watchdog should report milestone landings, self-heal safe in-repo conveyor failures via repair workers, and keep the loop moving.
- When `IMPLEMENTATION_PLAN.md` has no unchecked (`[ ]`) tasks left, run the relevant build/validation checkpoint, record the checkpoint in the plan, commit, push, and disable the Ralph watchdog cron job.

## Common commands
- Build / smoke verification: `npm run build`
- Print next milestone: `node src/index.mjs next --plan IMPLEMENTATION_PLAN.md`
- Initialize run state: `node src/index.mjs init-run --goal \"...\" --plan IMPLEMENTATION_PLAN.md --out state/runs/<run-id>.json`
- Transition milestone state: `node src/index.mjs transition --snapshot state/runs/<run-id>.json --milestone <id> --status implementing|verifying|completed|blocked`
- Rebuild snapshot from event log: `node src/index.mjs snapshot --snapshot state/runs/<run-id>.json`
- Ralph planning loop: `npm run ralph:plan`
- Ralph build loop: `npm run ralph:build`
- Ralph completion tip: if `IMPLEMENTATION_PLAN.md` has no unchecked (`[ ]`) tasks left, run `npm run build`, record the checkpoint in the plan, and stop.

## Project purpose

Laizy generalizes the SillyAvatar Ralph-loop into a reusable autonomous software delivery engine. The repository should optimize for:

- deterministic milestone-by-milestone progress
- explicit run state and event logs
- watchdog-driven self-healing
- compatibility-safe implementation slices
- strong verification before declaring completion

## Architecture guardrails
- Treat `IMPLEMENTATION_PLAN.md` as the authoritative execution queue.
- Prefer additive and compatibility-preserving changes.
- Keep milestone scope narrow; do not widen the current slice unless the plan explicitly requires it.
- Encode worker interactions as durable files and machine-readable state before adding UI.
- OpenClaw integration should be adapter-driven; keep core run logic decoupled from transport/runtime specifics.
