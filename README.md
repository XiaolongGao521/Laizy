# Laizy

Laizy is a repo-native autonomous software factory built around the exact Ralph-loop workflow already proven in SillyAvatar:

- plan first
- implement one milestone at a time
- verify after every milestone
- commit exactly once per milestone
- push immediately
- keep a watchdog running
- recover stalled work with a separate worker

## Current scope

This bootstrap slice establishes the workflow contract and the first runnable core:

- repo-local `AGENTS.md` with the Laizy Ralph-loop operating model
- `IMPLEMENTATION_PLAN.md` with milestone-based execution order
- `docs/V1_ARCHITECTURE.md` describing the generalized run model
- a small CLI that can:
  - parse `IMPLEMENTATION_PLAN.md`
  - report the next incomplete milestone
  - initialize a run-state snapshot plus adjacent JSONL event log
  - transition milestone lifecycle state and rebuild the derived snapshot
  - select the next actionable milestone from durable run state
  - emit planner-intent and implementer-contract JSON handoff documents
  - record worker heartbeats in the event log
  - inspect run health and emit machine-readable recovery recommendations
  - plan bounded recovery actions and persist recovery history in the run snapshot
  - emit adapter documents for OpenClaw `sessions_spawn`, `sessions_send`, `sessions_history`, and `cron`

## Core idea

Laizy is not "one big autonomous prompt." It is a deterministic delivery loop with explicit artifacts:

- **Goal** → what the human wants
- **Plan** → milestone queue in `IMPLEMENTATION_PLAN.md`
- **Run state** → JSON snapshot for the current execution
- **Workers** → planner, implementer, watchdog, recovery, verifier
- **Verification** → build/test/review checks after each milestone

## CLI

### Show the next milestone

```bash
node src/index.mjs next --plan IMPLEMENTATION_PLAN.md
```

### Initialize a run file

```bash
node src/index.mjs init-run \
  --goal "Turn a brief into a verified PR" \
  --plan IMPLEMENTATION_PLAN.md \
  --out state/runs/demo-run.json
```

This writes:

- `state/runs/demo-run.json` — the current derived snapshot
- `state/runs/demo-run.events.jsonl` — the append-only event log

### Transition a milestone

```bash
node src/index.mjs transition \
  --snapshot state/runs/demo-run.json \
  --milestone L3 \
  --status implementing \
  --note "worker picked up the milestone"
```

### Rebuild the snapshot from the event log

```bash
node src/index.mjs snapshot --snapshot state/runs/demo-run.json
```

### Select the next actionable milestone from the run snapshot

```bash
node src/index.mjs select-milestone --snapshot state/runs/demo-run.json
```

### Emit a planner intent

```bash
node src/index.mjs emit-planner-intent \
  --snapshot state/runs/demo-run.json \
  --out state/contracts/demo-planner-intent.json
```

### Emit an implementer contract

```bash
node src/index.mjs emit-implementer-contract \
  --snapshot state/runs/demo-run.json \
  --out state/contracts/demo-implementer-contract.json
```

The emitted JSON documents preserve strict single-milestone scope and are designed to be handed to the next worker without relying on freeform prompt state.

### Record a worker heartbeat

```bash
node src/index.mjs heartbeat \
  --snapshot state/runs/demo-run.json \
  --worker laizy-implementer \
  --note "implemented parser branch"
```

### Inspect run health

```bash
node src/index.mjs inspect-health \
  --snapshot state/runs/demo-run.json \
  --stall-threshold-minutes 15 \
  --out state/reports/demo-health.json
```

The health report includes a machine-readable recovery recommendation instead of freeform watchdog prose.

### Plan recovery from a health report

```bash
node src/index.mjs plan-recovery \
  --snapshot state/runs/demo-run.json \
  --stall-threshold-minutes 15 \
  --out state/reports/demo-recovery-plan.json
```

### Record a recovery action in the event log

```bash
node src/index.mjs record-recovery-action \
  --snapshot state/runs/demo-run.json \
  --action restart-implementer \
  --reason "implementer heartbeat expired" \
  --worker laizy-recovery \
  --milestone L5 \
  --source watchdog
```

### Emit an OpenClaw worker spawn adapter

```bash
node src/index.mjs emit-openclaw-spawn \
  --snapshot state/runs/demo-run.json \
  --worker implementer \
  --out state/adapters/demo-implementer-spawn.json
```

### Emit an OpenClaw watchdog cron adapter

```bash
node src/index.mjs emit-openclaw-cron \
  --snapshot state/runs/demo-run.json \
  --out state/adapters/demo-watchdog-cron.json
```

The adapter payloads keep OpenClaw transport/runtime details out of the core run-state model while preserving the stable worker labels from `AGENTS.md`.

### Build / smoke check

```bash
npm run build
```

## Ralph loop entry points

These scripts mirror the SillyAvatar process and target this repository explicitly:

```bash
npm run ralph:plan
npm run ralph:build
```

## Near-term roadmap

The next milestones add:

1. persistent event-log-backed run state
2. worker orchestration contracts
3. watchdog and recovery logic
4. OpenClaw ACP / cron integration
5. verification and review loops
