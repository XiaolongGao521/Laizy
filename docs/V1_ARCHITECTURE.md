# Laizy v1 Architecture

## Purpose

Laizy is a generalized Ralph-loop engine for autonomous, repo-native software delivery using OpenClaw as supervisor and external coding runtimes as workers.

The target experience is:

1. human provides a high-level goal or issue
2. Laizy turns it into an explicit execution plan
3. workers execute one milestone at a time
4. each milestone is verified, committed, and pushed
5. a watchdog detects stalls and invokes recovery
6. the run terminates only when acceptance criteria are satisfied

## Design principles

- **Plan-first**: every meaningful run has an explicit `IMPLEMENTATION_PLAN.md`
- **Single-milestone execution**: one highest-priority unchecked milestone per build step
- **Durable state**: runtime decisions should be persisted as machine-readable state and logs
- **Separation of roles**: planner, implementer, watchdog, recovery, verifier should be distinguishable
- **Verification over vibes**: build/test/review output is the source of truth
- **Compatibility-safe increments**: avoid wide rewrites when a narrow slice works

## Core entities

### Goal
The human request, issue text, or brief that kicked off the run.

### Plan
`IMPLEMENTATION_PLAN.md` is the canonical prioritized queue. Each milestone should be:

- small
- verifiable
- safe to commit independently
- stable enough for watchdog inspection

### Run
A run is a durable execution instance derived from a goal + plan.

Suggested fields:

- `runId`
- `goal`
- `repoPath`
- `planPath`
- `status`
- `createdAt`
- `updatedAt`
- `currentMilestoneId`
- `milestones[]`
- `workers`
- `verification`
- `events[]` or an event-log pointer

### Workers
Laizy v1 models five conceptual roles:

- **planner** — refreshes or repairs the plan
- **implementer** — executes the next milestone
- **watchdog** — checks health/progress on cadence
- **recovery** — repairs and resumes stalled work
- **verifier** — runs build/test/review acceptance checks

### Verification
A structured record of what proved a milestone good enough to commit:

- command
- exit status
- started/finished timestamps
- summary
- artifact paths (optional)

## Run state machine

```text
intake
  -> planned
  -> implementing
  -> verifying
  -> committed
  -> synced
  -> implementing (next milestone)
  -> completed

error paths:
implementing -> stalled -> recovering -> implementing
verifying -> failed_verification -> recovering | blocked
any state -> blocked
```

## File layout

```text
Laizy/
├── AGENTS.md
├── IMPLEMENTATION_PLAN.md
├── README.md
├── docs/
│   └── V1_ARCHITECTURE.md
├── src/
│   ├── core/
│   │   ├── plan.mjs
│   │   └── run-state.mjs
│   └── index.mjs
├── scripts/
│   └── build-check.mjs
└── state/
    └── runs/
```

## OpenClaw integration points

Laizy should treat OpenClaw as the orchestration substrate:

- `sessions_spawn` — start implementer/watchdog/recovery workers
- `sessions_send` — steer running workers
- `sessions_history` — inspect worker output and health
- `cron` — run watchdog cadence and reminders
- ACP runtime sessions — external coding harnesses such as Codex or Claude Code

## v1 milestone intent

The first implemented slices establish the durable contract:

- plan parsing
- next-milestone selection
- run-state initialization
- append-only run events + derived snapshots
- repo-local workflow documents

Later slices can add:

- richer verification artifacts
- worker lease/heartbeat tracking
- watchdog policy
- recovery strategies
- OpenClaw transport adapters
