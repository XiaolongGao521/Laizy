# Phase 1+ implementation plan

This document turns the current product framing into a staged repo plan.

The intent is not to describe a giant rewrite. It is to show how Laizy can keep tightening its repo-control-loop identity with small, compatibility-safe slices.

## Planning assumptions

- The local `IMPLEMENTATION_PLAN.md` remains the execution queue for an active run.
- Repo-local state under `state/` remains the source of truth for continuity.
- `start-run` and `supervisor-tick` remain the primary operator path.
- Worker roles stay explicit: planner, implementer, recovery, verifier, watchdog.
- Verification gates milestone completion.

## Stage 1 — product framing and docs alignment

### Goal

Make the narrow product identity obvious in the docs without changing the runtime model.

### Files

- `README.md`
- `docs/POSITIONING.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/METRICS.md`
- `docs/NAMING_CLEANUP.md`
- `docs/EXAMPLE_RUN.md`

### Work

- rewrite the top-level story around repo-native supervision and resume
- document the current architecture using the code that already exists
- align example docs with `start-run` + `supervisor-tick`
- identify legacy wording that overstates orchestration breadth

### Exit criteria

- a new reader can understand the product in one pass
- docs describe the existing CLI honestly
- Phase 1 docs are internally consistent

## Stage 2 — terminology and CLI consistency

### Goal

Reduce naming drift between docs, artifacts, CLI help text, and code comments.

### Files

- `src/index.ts`
- `src/core/types.ts`
- `src/core/contracts.ts`
- `src/core/supervisor.ts`
- `src/core/openclaw.ts`
- `src/core/backends.ts`
- `README.md`
- `docs/NAMING_CLEANUP.md`

### Work

- standardize on "repo-native control loop", "supervisor bundle", and "verification-gated milestone"
- keep command names stable where possible
- clean up help text and document aliases before removing any old wording
- keep emitted document kinds stable unless a compatibility bridge exists

### Exit criteria

- the same concepts have the same names across docs and CLI output
- any renamed user-facing terms have migration notes
- no compatibility-breaking rename ships without an adapter or alias

## Stage 3 — supervisor and recovery hardening

### Goal

Improve confidence that continuation and recovery decisions are deterministic and restartable.

### Files

- `src/core/health.ts`
- `src/core/recovery.ts`
- `src/core/supervisor.ts`
- `src/core/events.ts`
- `examples/demo-implementation-plan.md`
- `docs/ARCHITECTURE.md`
- `docs/EXAMPLE_RUN.md`

### Work

- tighten recovery recommendations for stalled and blocked runs
- make supervisor decisions easier to audit from emitted artifacts alone
- improve event-to-snapshot rebuild coverage in docs and tests
- ensure recovery preserves single-milestone scope

### Exit criteria

- a stalled run can be resumed from local artifacts without manual reconstruction
- recovery artifacts explain why the recommendation was chosen
- health and recovery behavior are easier to inspect in examples and tests

## Stage 4 — verification flow hardening

### Goal

Make milestone completion more obviously evidence-driven.

### Files

- `src/core/verification.ts`
- `src/core/events.ts`
- `src/core/supervisor.ts`
- `scripts/build-check.mjs`
- `docs/METRICS.md`
- `docs/EXAMPLE_RUN.md`

### Work

- standardize verification artifact shape and summaries
- improve reviewer-output and command-document examples
- make failure and retry paths clearer in durable state
- strengthen operator guidance for milestone closeout

### Exit criteria

- verification artifacts are easy to inspect and compare across milestones
- failed verification produces a clear next action
- completion remains impossible without a passed verification record

## Stage 5 — backend and operator ergonomics

### Goal

Keep backend flexibility while preserving the repo-local control model.

### Files

- `src/core/backend-preflight.ts`
- `src/core/openclaw.ts`
- `src/core/backends.ts`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/METRICS.md`

### Work

- tighten backend preflight summaries and diagnostics
- make runtime-profile guidance clearer in emitted documents
- improve operator-facing examples for OpenClaw, Codex CLI, Claude Code, and local watchdog usage
- keep backend adapters thin and replaceable

### Exit criteria

- backend issues are visible before worker handoff
- operator docs show the same core loop across supported runtimes
- backend-specific logic stays outside the core run-state model

## Sequencing notes

Recommended implementation order after this docs pass:

1. README and example cleanup
2. naming consistency in help text and docs
3. supervisor/recovery auditability improvements
4. verification hardening
5. backend/operator ergonomics

That order keeps product clarity ahead of deeper runtime changes.
