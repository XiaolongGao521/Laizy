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
  - initialize a run-state JSON file for a new autonomous run

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
