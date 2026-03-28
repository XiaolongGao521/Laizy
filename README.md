# Laizy

Laizy is a repo-native control loop for coding-agent work.

It does not try to replace Codex, Claude Code, OpenClaw, or other coding agents. It wraps them in a durable, milestone-based delivery loop so the next step is explicit, verification is recorded, and interrupted work can resume from repo state instead of chat memory.

## What it does

Laizy helps an operator run work through a narrow sequence:

1. start from a local implementation plan
2. bootstrap a run
3. ask the supervisor what should happen next
4. execute one bounded milestone action
5. record verification before completion
6. recover or resume safely when the loop stalls

The point is not more autonomy theatre. The point is a cleaner control surface for repo work that already uses coding agents.

## Core ideas

- **Repo-local plan** — the active queue lives in `IMPLEMENTATION_PLAN.md` or another local milestone plan file.
- **Durable run state** — the run snapshot and event log live under `state/runs/`.
- **Bounded worker contracts** — planner, implementer, recovery, verifier, and watchdog handoffs are emitted as explicit documents.
- **Verification gate** — a milestone is not complete until a passed verification result is recorded.
- **Recovery path** — stalls and interruptions are part of the model, not exceptional cases hidden in chat.

## Recommended operator flow

Bootstrap once:

```bash
laizy start-run \
  --goal "Turn a brief into a verified PR" \
  --plan IMPLEMENTATION_PLAN.md \
  --out state/runs/my-run.json
```

Continue from durable state:

```bash
laizy supervisor-tick \
  --snapshot state/runs/my-run.json \
  --out-dir state/runs/my-run.supervisor
```

Consume the emitted supervisor bundle instead of improvising the next step in chat.

## What gets written

A typical run produces:

- `state/runs/<run>.json` — derived run snapshot
- `state/runs/<run>.events.jsonl` — append-only event log
- `state/runs/<run>.bootstrap/` — initial bundle from `start-run`
- `state/runs/<run>.supervisor/` — next-action bundle from `supervisor-tick`
- `state/verification/` — reviewer and verification artifacts when used

These files make it possible to inspect, pause, resume, and recover the loop without reconstructing state from memory.

## Supervisor decisions

`supervisor-tick` evaluates the current snapshot and emits one bounded decision:

- `plan` — the run needs an actionable plan
- `continue` — start or continue the active milestone
- `recover` — resume safely from a stall or blocked path
- `verify` — run the required acceptance check
- `closeout` — disable watchdogs and end the run

The next action is described by machine-readable artifacts in the supervisor bundle.

## Worker roles

Laizy keeps worker responsibilities explicit:

- **planner** — creates or repairs the milestone plan
- **implementer** — executes one milestone at a time
- **watchdog** — checks progress on cadence
- **recovery** — repairs and resumes the conveyor without widening scope
- **verifier** — records the evidence needed to complete a milestone

## Backends and runtimes

Laizy keeps its core loop separate from execution backends.

Today the repo can emit adapter documents for:

- OpenClaw session spawn/send/history/cron flows
- Codex CLI execution
- Claude Code execution
- local `laizy watchdog` cadence

Across all of those adapters, the operator guidance should stay the same:

- **Laizy remains the control plane** — run `start-run` once, then use `supervisor-tick` to emit the next bounded action from durable repo state.
- **OpenClaw is the session runtime** — prefer `runtime=subagent` or another runtime-backed session for planner, implementer, recovery, and verifier handoffs.
- **Codex CLI is a one-shot worker runtime** — use a PTY-backed `codex exec --full-auto ...` invocation for the emitted contract.
- **Claude Code is a one-shot worker runtime** — use `claude --permission-mode bypassPermissions --print ...` without PTY for the emitted contract.
- **`laizy watchdog` is the cadence runtime** — run it locally against the same snapshot/out-dir instead of inventing a chat-only watchdog loop.

Backend preflight artifacts are also emitted so worker handoff can fail early when a configured runtime is unavailable.

These adapter documents are intentionally thin and replaceable: they restate durable control-loop intent for a specific runtime without pushing backend-specific concerns into the run snapshot schema.

### Backend configuration overrides

You can override worker backends with `--backend-config` as inline JSON or as a path to a JSON file.

Example:

```json
{
  "planner": "openclaw",
  "implementer": { "backend": "codex-cli", "preferredRuntime": "pty" },
  "recovery": "claude-code",
  "verifier": "openclaw",
  "watchdog": "laizy-watchdog"
}
```

Use the operator-facing validation command before handoff when you want an explicit preflight summary:

```bash
laizy check-backends \
  --snapshot state/runs/my-run.json \
  --out-dir state/runs/my-run.backend-checks \
  --backend-config backend-config.json
```

That keeps backend issues visible before a worker is asked to act.

## Install

```bash
npm install -g laizy
```

Or run it from the repo after compiling:

```bash
node dist/src/index.js --help
```

## CLI surface

The published package exposes one binary:

```bash
laizy
```

Useful commands:

- `laizy start-run` — bootstrap a run and emit the initial bundle
- `laizy supervisor-tick` — evaluate durable state and emit the next bounded action
- `laizy watchdog` — run local watchdog cadence
- `laizy check-backends` — inspect backend readiness for configured worker roles
- `laizy transition` — record milestone lifecycle changes
- `laizy record-verification-result` — persist verification evidence

## Runtime examples

OpenClaw handoff example:

```json
{
  "adapter": "sessions_spawn",
  "runtime": "subagent",
  "operatorGuidance": {
    "loopSummary": "Keep Laizy as the control plane: start-run once, then supervisor-tick to emit the next bounded action from durable repo state."
  }
}
```

Codex CLI handoff example:

```bash
codex exec --full-auto "<contract emitted by Laizy>"
```

Claude Code handoff example:

```bash
claude --permission-mode bypassPermissions --print "<contract emitted by Laizy>"
```

Local watchdog example:

```bash
laizy watchdog \
  --snapshot state/runs/example-run.json \
  --out-dir state/runs/example-run.supervisor \
  --interval-seconds 300 \
  --stall-threshold-minutes 15 \
  --verification-command "/usr/bin/node scripts/build-check.mjs"
```

## Example lifecycle

### 1. Start the run

```bash
laizy start-run \
  --goal "Add verification-loop scaffolding" \
  --plan examples/demo-implementation-plan.md \
  --out state/runs/example-run.json
```

### 2. Ask the supervisor for the next action

```bash
laizy supervisor-tick \
  --snapshot state/runs/example-run.json \
  --out-dir state/runs/example-run.supervisor
```

### 3. Execute the bounded action

If the decision is `continue`, read the emitted implementer contract and perform exactly that milestone.

### 4. Verify before completion

For example:

```bash
/usr/bin/node scripts/build-check.mjs

laizy record-verification-result \
  --snapshot state/runs/example-run.json \
  --milestone L7 \
  --command "/usr/bin/node scripts/build-check.mjs" \
  --status passed \
  --summary "build-check passed"
```

### 5. Close out or continue

Run `supervisor-tick` again. The next bundle will tell you whether to continue, recover, verify, or close out.

## Repository docs

- `docs/POSITIONING.md` — product framing and boundaries
- `docs/ARCHITECTURE.md` — current architecture and control-loop model
- `docs/IMPLEMENTATION_PLAN.md` — staged repo evolution plan
- `docs/METRICS.md` — operational metrics worth tracking
- `docs/NAMING_CLEANUP.md` — terminology cleanup strategy
- `docs/EXAMPLE_RUN.md` — concrete milestone and verification example
- `docs/V1_ARCHITECTURE.md` — earlier architecture draft retained for historical context

## OpenClaw skill

This repo also ships an OpenClaw/AgentSkills-compatible skill source at:

```text
skills/laizy/
```

That skill teaches OpenClaw how to drive the `start-run` / `supervisor-tick` flow around existing coding agents.

## Development

Run the repo verification/build check:

```bash
/usr/bin/node scripts/build-check.mjs
```

Common repo scripts:

```bash
npm run build
npm run ralph:plan
npm run ralph:build
```

## Product boundary

Laizy is intentionally narrow.

It is not trying to be:

- a hosted control plane
- a replacement for your coding agent
- a generic workflow system for every domain
- an excuse to hide state in prompts

It is a durable repo control loop for milestone-based coding work.
