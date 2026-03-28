# Laizy architecture

## Architecture summary

Laizy is built as a small CLI that maintains durable run state and emits bounded machine-readable documents for the next step in a repo delivery loop.

The current architecture is best understood as five layers:

1. **plan parsing** — read a local milestone plan file
2. **durable run state** — snapshot + append-only event log
3. **supervisor decision logic** — decide whether to plan, continue, recover, verify, or close out
4. **worker handoff documents** — contracts and adapter payloads for the next bounded action
5. **verification and recovery records** — evidence that a milestone can safely advance

## Core runtime objects

### Plan

The plan is a markdown checklist, typically `IMPLEMENTATION_PLAN.md`, parsed into milestone entries.

Each milestone carries:

- id
- title
- completion marker from the plan file
- line number
- detail bullets

The implementation plan is treated as the execution queue, not as descriptive prose.

### Run snapshot

The snapshot is the derived JSON view of the active run. It stores:

- run identity and goal
- repo path and plan path
- current run status
- plan state summary
- backend configuration per worker role
- current milestone id
- milestone statuses and notes
- worker heartbeat state
- recovery history
- verification history
- snapshot/event-log locations and event counters

This is the main state object used by supervisor and worker artifact generation.

### Event log

The event log is append-only JSONL. It records transitions such as:

- run initialization
- milestone transitions
- worker heartbeats
- recovery actions
- verification results

The snapshot can be rebuilt from the log, which is why the log is the durable source and the snapshot is the derived view.

## Worker model

The current code models five worker roles:

- `planner`
- `implementer`
- `recovery`
- `verifier`
- `watchdog`

These are logical roles, not hardcoded runtime implementations. A role can be mapped to different execution backends through backend configuration.

## Decision loop

The main control loop is:

1. bootstrap once with `start-run`
2. continue with `supervisor-tick`
3. execute the emitted next action from the emitted supervisor bundle
4. update state through transitions, heartbeats, recovery records, and verification results
5. rebuild from the event log when a worker or operator resumes after interruption
6. repeat until `closeout`

The supervisor decision space is intentionally narrow:

- `plan`
- `replan`
- `continue`
- `recover`
- `verify`
- `closeout`

That narrow decision set is the architectural center of the project.

## Bounded handoff artifacts

Instead of sending workers unstructured repo context, Laizy emits purpose-specific documents.

### Core contract documents

Current contract types include:

- `planner.request`
- `planner.intent`
- `implementer.contract`
- `recovery.plan`
- `verification.command`
- `reviewer.output`
- `supervisor.decision`

These documents keep the next action explicit and limited in scope.

The Stage 3 hardening pass makes the supervisor bundle itself part of the audit trail:

- the decision document carries event-derived restart/resume context
- continuation metadata points operators to the next durable document to open
- recovery plans stay bounded to the active milestone instead of broad repo guidance
- verification remains an explicit gate before a milestone can move to `completed`

### Backend adapter documents

The core run model is kept separate from transport/runtime details. The repository currently emits adapters for:

- OpenClaw spawn/send/history/cron flows
- Codex CLI execution
- Claude Code execution
- local `laizy watchdog` execution

That separation matters: backend-specific execution instructions are generated from durable state instead of being embedded into the state schema itself.

## Verification gate

Verification is not an afterthought in the current architecture.

The runtime can:

- emit a verification command document
- emit reviewer output
- record a verification result in run state
- prevent milestone completion until a passed verification result exists

For docs and code alike, this creates an explicit "prove it before advancing" gate.

## Recovery path

Recovery is also first-class.

The runtime can:

- inspect health from snapshot + heartbeat data
- classify stalls
- generate a machine-readable recovery recommendation
- persist recovery actions
- emit a bounded recovery plan for the recovery worker

That keeps stalled work inside the same durable control loop as normal progress.

In the hardened Stage 3 flow, recovery is deliberately restart-safe and audit-friendly:

- a snapshot can be rebuilt from the append-only event log before the next supervisor tick
- the next bundle explains whether the operator should `resume-after-rebuild` or `recover-before-continuing`
- the emitted recovery artifact stays tied to the current milestone so recovery cannot silently widen scope

## Runtime profile selection

Supervisor decisions also carry a bounded runtime profile:

- model
- thinking level
- reasoning mode
- coarse scope classification

This keeps downstream worker spawning deterministic and lets the control loop distinguish, for example, docs work from core-runtime work without widening the contract.

## File-level map of the current implementation

At a high level, the source tree is organized like this:

- `src/index.ts` — CLI entrypoint and command dispatch
- `src/core/plan.ts` — parse and summarize milestone plans
- `src/core/run-state.ts` — create baseline run snapshot state
- `src/core/events.ts` — initialize artifacts, record events, rebuild snapshots, transition milestones, persist verification/recovery data
- `src/core/contracts.ts` — planner and implementer handoff documents
- `src/core/health.ts` — run-health inspection and stall detection
- `src/core/recovery.ts` — recovery plan creation
- `src/core/verification.ts` — verification command and reviewer-output documents
- `src/core/supervisor.ts` — supervisor decision logic and bundle emission
- `src/core/openclaw.ts` — OpenClaw adapter documents
- `src/core/backends.ts` — non-OpenClaw execution adapter documents
- `src/core/backend-preflight.ts` / `src/core/backend-health.ts` — backend checks and preflight assertions
- `src/core/runtime-profile.ts` — deterministic runtime-profile selection
- `src/core/types.ts` — shared type contracts

## Operational stance

The important design choice is restraint.

Laizy does not attempt to directly "do the work" itself. It coordinates narrow slices of work, records what happened, and insists on verification before completion. That makes the system easier to resume, easier to audit, and harder to accidentally widen.

The build-check script reinforces that stance by validating both runtime behavior and the operator-facing docs that describe restart-safe supervision, bounded recovery, and verification-gated completion.

That is the architecture the current repository actually implements.