# Laizy

Laizy is an open-source orchestration layer for people already using tools like Claude Code, Codex, and OpenClaw.

Instead of replacing your coding agent with a hosted black-box platform, Laizy acts as the repo-native control plane around the tools you already trust. It turns them into a supervised software delivery loop with explicit planning, implementation, recovery, verification, and closeout artifacts.

The npm package exposes a single CLI entrypoint:

```bash
laizy
```

That command resolves to the compiled runtime at `dist/src/index.js`.

## Install

```bash
npm install -g laizy
```

Or use it without a global install:

```bash
npx laizy --help
```

## OpenClaw skill

This repo now also ships an OpenClaw/AgentSkills-compatible skill source at:

```text
skills/laizy/
```

That skill is designed for people already using Claude Code, Codex, OpenClaw, and similar coding agents. It teaches OpenClaw how to drive Laizy's `start-run` / `supervisor-tick` workflow and includes installer metadata so the skill can install the Laizy CLI.

Package the skill locally with OpenClaw's `package_skill.py` helper, or publish it later with ClawHub:

```bash
clawhub publish ./skills/laizy --slug laizy --name "Laizy" --version 0.2.0 --changelog "Initial ClawHub release"
```

Current installer note:
- the skill is configured to install the Laizy CLI from GitHub via npm (`github:XiaolongGao521/Laizy`)
- that avoids requiring an npm registry release before the ClawHub skill itself can be published

## Why Laizy

- **Bring your own agents** — use Claude Code, Codex, OpenClaw, and similar tools instead of being locked into one hosted platform.
- **Keep state in the repo** — plans, run snapshots, event logs, contracts, and verification records are explicit files.
- **Separate worker roles** — planner, implementer, recovery, verifier, and supervisor decisions are distinct instead of collapsing into one opaque prompt.
- **Stay deterministic between steps** — `start-run` and `supervisor-tick` emit bounded machine-readable artifacts for the next action.
- **Recover instead of restarting from scratch** — watchdog and recovery flows are first-class parts of the delivery loop.

## Quick start

```bash
laizy start-run \
  --goal "Turn a brief into a verified PR" \
  --plan examples/demo-implementation-plan.md \
  --out state/runs/demo-run.json
```

Then continue from durable state:

```bash
laizy supervisor-tick \
  --snapshot state/runs/demo-run.json \
  --out-dir state/runs/demo-run.supervisor
```

That flow is designed to:

- plan first
- implement one milestone at a time
- verify after every milestone
- commit exactly once per milestone
- push immediately
- keep a watchdog running
- recover stalled work with a separate worker

## What Laizy does today

Laizy is already usable as a TypeScript-first CLI and orchestration layer with:

- public architecture and example docs under `docs/`
- a generic example plan under `examples/demo-implementation-plan.md`
- a small TypeScript CLI (`src/**/*.ts`) that compiles to runnable ESM output under `dist/` and can:
  - parse a user-provided milestone plan file (commonly named `IMPLEMENTATION_PLAN.md`)
  - report the next incomplete milestone
  - initialize a run-state snapshot plus adjacent JSONL event log
  - transition milestone lifecycle state and rebuild the derived snapshot
  - select the next actionable milestone from durable run state
  - emit planner-request, planner-intent, and implementer-contract JSON handoff documents
  - record worker heartbeats in the event log
  - inspect run health and emit machine-readable recovery recommendations
  - plan bounded recovery actions and persist recovery history in the run snapshot
  - emit adapter documents for OpenClaw `sessions_spawn`, `sessions_send`, `sessions_history`, and `cron`
  - emit verification-command and reviewer-output documents, then persist verification results
  - gate milestone completion on an explicit passed verification record

## Core idea

Laizy is not "one big autonomous prompt." It is a deterministic delivery loop with explicit artifacts:

- **Goal** → what the human wants
- **Plan** → a milestone queue (commonly stored as `IMPLEMENTATION_PLAN.md` in the target repo)
- **Run state** → JSON snapshot for the current execution
- **Workers** → planner, implementer, watchdog, recovery, verifier
- **Verification** → build/test/review checks after each milestone

## CLI

The published package ships the `laizy` binary. Inside the packaged artifact, it resolves to the compiled CLI entrypoint at `dist/src/index.js`.

For local repository development, you can still invoke the built entrypoint directly:

```bash
node dist/src/index.js
```

### Recommended operator flow: `start-run` once, then `supervisor-tick` until closeout

Bootstrap a run once:

```bash
node dist/src/index.js start-run \
  --goal "Turn a brief into a verified PR" \
  --plan examples/demo-implementation-plan.md \
  --out state/runs/demo-run.json
```

Then continue deterministically from durable state with the supervisor wrapper:

```bash
node dist/src/index.js supervisor-tick \
  --snapshot state/runs/demo-run.json \
  --out-dir state/runs/demo-run.supervisor
```

This is the primary Laizy-native operator path.

- `start-run` handles bootstrap once and writes the initial bundle.
- `supervisor-tick` is the continuation wrapper for every later decision point.
- The wrapper reads the durable snapshot and event log, rebuilds the current state, evaluates health, and emits the next bounded machine-readable action bundle.
- Each supervisor decision now also includes a bounded runtime profile: selected `model`, `thinking`, `reasoningMode`, and classified `scope` for the next action.
- Operators and chat supervisors should consume the emitted bundle instead of re-reasoning in freeform chat about what to do next.

That makes continuation deterministic across normal progress, stalled workers, verification handoff, and final closeout.

### `start-run` bootstrap bundle

Instead of manually chaining `init-run`, contract emission, and OpenClaw adapter emission, `start-run` writes a deterministic bootstrap bundle for the active run.

By default it creates:

- `state/runs/demo-run.json` — the current derived snapshot
- `state/runs/demo-run.events.jsonl` — the append-only event log
- `state/runs/demo-run.bootstrap/bootstrap-manifest.json` — machine-readable bundle manifest
- `state/runs/demo-run.bootstrap/planner-intent.json` — current planner handoff
- `state/runs/demo-run.bootstrap/openclaw-watchdog-cron.json` — OpenClaw cron adapter for watchdog cadence
- `state/runs/demo-run.bootstrap/laizy-watchdog.json` — backend-neutral/local watchdog command document (`laizy watchdog ...`)
- if the plan already has actionable milestones:
  - `state/runs/demo-run.bootstrap/implementer-contract.json` — bounded implementer contract
  - `state/runs/demo-run.bootstrap/openclaw-implementer-spawn.json` — OpenClaw worker spawn adapter
  - `state/runs/demo-run.bootstrap/codex-cli-implementer-exec.json` — Codex CLI execution adapter
  - `state/runs/demo-run.bootstrap/claude-code-implementer-exec.json` — Claude Code execution adapter
- if the plan is empty or otherwise lacks actionable milestones:
  - `state/runs/demo-run.bootstrap/planner-request.json` — machine-readable request for bounded planning
  - `state/runs/demo-run.bootstrap/openclaw-planner-spawn.json` — OpenClaw planner spawn adapter
  - `state/runs/demo-run.bootstrap/codex-cli-planner-exec.json` — Codex CLI planner adapter
  - `state/runs/demo-run.bootstrap/claude-code-planner-exec.json` — Claude Code planner adapter

The manifest is the stable document an external supervisor can consume to start the run without recomputing or manually stitching together the first-step artifacts.

The important bootstrap distinction is:

- an empty/no-actionable plan is **not** treated as a completed run
- instead, the snapshot records `planState.status: "needs-plan"`
- bootstrap emits a `planner.request` artifact so downstream supervisors can request planning deterministically

Useful options:

- `--run-id <id>` — force a deterministic run id
- `--bundle-dir <dir>` — override where the bootstrap bundle is written
- `--runtime <value>` — override the emitted OpenClaw worker runtime
- `--schedule <cron>` — override the watchdog cron cadence
- `--prompt <text>` — override the emitted watchdog prompt

### `supervisor-tick` continuation, recovery handoff, verification, and closeout

```bash
node dist/src/index.js supervisor-tick \
  --snapshot state/runs/demo-run.json \
  --out-dir state/runs/demo-run.supervisor
```

`supervisor-tick` is the thin deterministic replacement for the remaining manual supervisor glue. It rebuilds state from the snapshot, inspects run health, selects the next action, and writes one bounded decision bundle.

Depending on the current run state, the bundle will classify the next step as one of:

- `plan` — request bounded planning when the run has no actionable milestones yet
- `replan` — request bounded plan repair when the active milestone is explicitly blocked
- `continue` — keep implementation moving with a fresh bounded implementer handoff
- `recover` — hand off to recovery with a machine-readable restart/repair plan
- `verify` — hand off the current milestone to verification/review
- `closeout` — declare the run complete and emit the watchdog-disable/shutdown artifacts

Typical emitted artifacts include:

- a stable supervisor manifest describing the decision
- the decision-specific handoff document (`planner.request`, `implementer`, `recovery`, `verification`, or `closeout`)
- backend-specific execution adapters for the same next step, including:
  - OpenClaw spawn/cron adapters
  - Codex CLI exec adapters
  - Claude Code exec adapters
  - local watchdog command documents for `laizy watchdog`
- explicit runtime-profile data in the decision and next-step documents so downstream tooling can see the intended `model`, `thinking`, and `reasoningMode`
- closeout-specific watchdog disable guidance when the plan is complete

The important contract is that the supervisor bundle becomes the source of truth for the next action. A chat-based watchdog or operator should read the manifest and execute the emitted bounded document, not improvise the next step from memory.

For planner-driven runs specifically, operators should consume `planner.request` plus the emitted planner adapter for the backend they are using rather than asking a chat model to refresh the plan freehand. That keeps planning/replanning inside the same durable, machine-readable supervision loop as implementation and recovery.

### Local watchdog loop

```bash
node dist/src/index.js watchdog \
  --snapshot state/runs/demo-run.json \
  --out-dir state/runs/demo-run.supervisor \
  --interval-seconds 300
```

Use `watchdog` when you want Laizy itself to own the periodic supervisor cadence instead of relying on OpenClaw cron. It repeatedly rebuilds state, runs `supervisor-tick` logic, prints the emitted decision, and exits automatically on `closeout`.

### Low-level building blocks

```bash
node dist/src/index.js init-run \
  --goal "Turn a brief into a verified PR" \
  --plan examples/demo-implementation-plan.md \
  --out state/runs/demo-run.json
```

Use `init-run` when you explicitly want only the snapshot/event log without the wrapper bundle.

### Show the next milestone

```bash
node dist/src/index.js next --plan examples/demo-implementation-plan.md
```

### Transition a milestone

```bash
node dist/src/index.js transition \
  --snapshot state/runs/demo-run.json \
  --milestone L3 \
  --status implementing \
  --note "worker picked up the milestone"
```

### Rebuild the snapshot from the event log

```bash
node dist/src/index.js snapshot --snapshot state/runs/demo-run.json
```

### Select the next actionable milestone from the run snapshot

```bash
node dist/src/index.js select-milestone --snapshot state/runs/demo-run.json
```

### Emit a planner request

```bash
node dist/src/index.js emit-planner-request \
  --snapshot state/runs/demo-run.json \
  --out state/contracts/demo-planner-request.json
```

### Emit a planner intent

```bash
node dist/src/index.js emit-planner-intent \
  --snapshot state/runs/demo-run.json \
  --out state/contracts/demo-planner-intent.json
```

### Emit an implementer contract

```bash
node dist/src/index.js emit-implementer-contract \
  --snapshot state/runs/demo-run.json \
  --out state/contracts/demo-implementer-contract.json
```

The emitted JSON documents preserve strict single-milestone scope and are designed to be handed to the next worker without relying on freeform prompt state.

### Record a worker heartbeat

```bash
node dist/src/index.js heartbeat \
  --snapshot state/runs/demo-run.json \
  --worker laizy-implementer \
  --note "implemented parser branch"
```

### Inspect run health

```bash
node dist/src/index.js inspect-health \
  --snapshot state/runs/demo-run.json \
  --stall-threshold-minutes 15 \
  --out state/reports/demo-health.json
```

The health report includes a machine-readable recovery recommendation instead of freeform watchdog prose.

### Plan recovery from a health report

```bash
node dist/src/index.js plan-recovery \
  --snapshot state/runs/demo-run.json \
  --stall-threshold-minutes 15 \
  --out state/reports/demo-recovery-plan.json
```

### Record a recovery action in the event log

```bash
node dist/src/index.js record-recovery-action \
  --snapshot state/runs/demo-run.json \
  --action restart-implementer \
  --reason "implementer heartbeat expired" \
  --worker laizy-recovery \
  --milestone L5 \
  --source watchdog
```

### Emit an OpenClaw worker spawn adapter

```bash
node dist/src/index.js emit-openclaw-spawn \
  --snapshot state/runs/demo-run.json \
  --worker implementer \
  --out state/adapters/demo-implementer-spawn.json
```

### Emit an OpenClaw watchdog cron adapter

```bash
node dist/src/index.js emit-openclaw-cron \
  --snapshot state/runs/demo-run.json \
  --out state/adapters/demo-watchdog-cron.json
```

The adapter payloads keep OpenClaw transport/runtime details out of the core run-state model while preserving stable worker labels across planner, implementer, recovery, and verifier roles.

For runtime-profile-aware flows, spawn/verification artifacts now expose:

- `model` — the bounded model family selected for the next worker handoff
- `thinking` — low/medium/high effort chosen deterministically from action + milestone scope
- `reasoningMode` — explicit machine-readable reasoning visibility mode
- `scope` — the supervisor's simple heuristic classification of the active milestone (`docs`, `verification`, `core-runtime`, or generic implementation)

The first heuristic is intentionally conservative and deterministic:

- docs/README-style work tends toward a smaller model and low thinking
- core runtime/supervisor/recovery work tends toward the primary model and high thinking
- recovery stays high-thinking
- closeout stays cheap
- reasoning visibility defaults to `hidden` for shared/group-safe operation unless an operator explicitly chooses otherwise

### Emit a verification command

```bash
node dist/src/index.js emit-verification-command \
  --snapshot state/runs/demo-run.json \
  --command "/usr/bin/node scripts/build-check.mjs" \
  --out state/verification/demo-command.json
```

### Emit reviewer output and record a verification result

```bash
node dist/src/index.js emit-reviewer-output \
  --snapshot state/runs/demo-run.json \
  --verdict approved \
  --summary "build-check passed" \
  --next-action complete-milestone \
  --out state/verification/demo-review.json

node dist/src/index.js record-verification-result \
  --snapshot state/runs/demo-run.json \
  --milestone L7 \
  --command "/usr/bin/node scripts/build-check.mjs" \
  --status passed \
  --reviewer-output state/verification/demo-review.json \
  --summary "build-check passed"
```

Milestones cannot transition to `completed` until a passed verification result has been recorded for that milestone.

### Build / smoke check

```bash
npm run build
```

## End-to-end example

See `docs/EXAMPLE_RUN.md` for a full brief → planner → implementer → watchdog → recovery → verifier → closeout walkthrough.

## Ralph loop entry points

These scripts mirror the SillyAvatar process and target this repository explicitly:

```bash
npm run ralph:plan
npm run ralph:build
```

## Publish/readiness notes

The npm package is intended to publish only the compiled runtime and required package docs:

- `dist/`
- `README.md`
- `LICENSE`

Before publishing, run both readiness checks from a clean working tree:

```bash
/usr/bin/node scripts/build-check.mjs
/usr/bin/npm pack --dry-run
```

`prepack` recompiles `dist/`, so the tarball can be produced without committing generated output.

## License

Laizy is licensed under MIT. See `LICENSE` for the full text.

## Near-term roadmap

The next milestones add:

1. persistent event-log-backed run state
2. worker orchestration contracts
3. watchdog and recovery logic
4. OpenClaw ACP / cron integration
5. verification and review loops
