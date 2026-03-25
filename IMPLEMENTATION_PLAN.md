# IMPLEMENTATION_PLAN.md

Goal: turn Laizy into a reusable, repo-native autonomous software delivery engine based on the exact Ralph-loop process already used in SillyAvatar.

## Execution rules
- The plan is the authoritative execution queue for Ralph-style work in this repository.
- Build mode should advance one highest-priority incomplete milestone at a time.
- Every completed milestone must be verified, committed once, and pushed.
- Watchdog and recovery behavior should stay aligned with `AGENTS.md`.

### [x] L1 - Bootstrap the repo-local Ralph contract and initial run-state CLI
- Added repository workflow files mirroring the SillyAvatar Ralph process.
- Added an architecture document clarifying the generalized Laizy model.
- Added a runnable CLI slice for parsing the plan, reporting the next milestone, and initializing run state.
- Verification checkpoint: `npm run build`
- Discovery: a zero-dependency Node ESM bootstrap keeps the first slice deterministic while the orchestration model is still settling.
- Discovery: encoding milestone parsing early gives later workers a stable, machine-readable contract to follow.

### [ ] L2 - Add persistent event-log-backed run state
- Introduce append-only run events and derived run snapshots.
- Support milestone lifecycle transitions (`planned`, `implementing`, `verifying`, `completed`, `blocked`).
- Keep the storage format simple JSONL + derived snapshot JSON.
- Verification checkpoint: `npm run build`

### [ ] L3 - Add planner / implementer command contracts
- Model worker intents and handoff envelopes as durable JSON documents.
- Add commands to select the next actionable milestone and emit implementer instructions.
- Preserve strict single-milestone scope in the emitted work contract.
- Verification checkpoint: `npm run build`

### [ ] L4 - Add watchdog inspection and stall detection
- Add heartbeat metadata and run-health evaluation.
- Detect idle/stalled implementer states deterministically.
- Emit machine-readable recovery recommendations instead of freeform text.
- Verification checkpoint: `npm run build`

### [ ] L5 - Add recovery planning and resume logic
- Convert watchdog findings into bounded recovery actions.
- Support restart, re-handoff, and blocked-state escalation paths.
- Record every recovery action in the run event log.
- Verification checkpoint: `npm run build`

### [ ] L6 - Add OpenClaw orchestration adapters
- Add adapters for `sessions_spawn`, `sessions_send`, `sessions_history`, and `cron`.
- Keep OpenClaw transport/runtime details out of the core run-state model.
- Support the stable worker labels defined in `AGENTS.md`.
- Verification checkpoint: `npm run build`

### [ ] L7 - Add verification and reviewer loop scaffolding
- Model verification commands/results as first-class artifacts.
- Add reviewer/evaluator output contracts for post-implementation checks.
- Gate milestone completion on explicit verification status.
- Verification checkpoint: `npm run build`

### [ ] L8 - Add end-to-end example run docs
- Document a sample brief-to-run flow using the Laizy CLI artifacts.
- Show how the planner, implementer, watchdog, and recovery workers interact.
- Capture operator expectations for commit/push/closeout behavior.
- Verification checkpoint: `npm run build`
