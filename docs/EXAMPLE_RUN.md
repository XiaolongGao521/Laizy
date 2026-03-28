# Laizy Example Run

This is a concrete brief-to-run example showing the durable artifacts Laizy expects workers to exchange.

It follows the recommended supervised operator path: `start-run` once, then `supervisor-tick` for continuation decisions. The lower-level `init-run` command remains available for compatibility and debugging, but it is not the primary story in this example.

## Example brief

> Add verification-loop scaffolding to Laizy so milestone completion is gated on explicit verification results.

## 1. Bootstrap the run

```bash
node dist/src/index.js start-run \
  --goal "Add verification-loop scaffolding to Laizy" \
  --plan examples/demo-implementation-plan.md \
  --out state/runs/example-run.json
```

Artifacts created:

- `state/runs/example-run.json` — derived snapshot
- `state/runs/example-run.events.jsonl` — append-only event log
- `state/runs/example-run.bootstrap/` — initial supervisor/bootstrap bundle

## 2. Supervisor selects the next bounded action

```bash
node dist/src/index.js supervisor-tick \
  --snapshot state/runs/example-run.json \
  --out-dir state/runs/example-run.supervisor
```

The supervisor bundle names the next bounded action and keeps the worker handoff repo-native and durable.

## 3. Implementer receives the bounded milestone

```bash
node dist/src/index.js emit-implementer-contract \
  --snapshot state/runs/example-run.json \
  --out state/contracts/example-implementer.json

node dist/src/index.js emit-openclaw-spawn \
  --snapshot state/runs/example-run.json \
  --worker implementer \
  --out state/adapters/example-implementer-spawn.json
```

The OpenClaw adapter is transport-specific, but the implementer contract remains repo-native and durable.

## 4. Implementer marks progress

```bash
node dist/src/index.js transition \
  --snapshot state/runs/example-run.json \
  --milestone L7 \
  --status implementing \
  --note "implementer started verification scaffolding"

node dist/src/index.js heartbeat \
  --snapshot state/runs/example-run.json \
  --worker laizy-implementer \
  --note "verification contract wiring in progress"
```

## 5. Watchdog inspects health on cadence

```bash
node dist/src/index.js emit-openclaw-cron \
  --snapshot state/runs/example-run.json \
  --out state/adapters/example-watchdog-cron.json

node dist/src/index.js inspect-health \
  --snapshot state/runs/example-run.json \
  --stall-threshold-minutes 15 \
  --out state/reports/example-health.json
```

If the run is stalled, the watchdog should create a bounded recovery plan instead of improvising.

## 6. Recovery resumes safely when needed

```bash
node dist/src/index.js plan-recovery \
  --snapshot state/runs/example-run.json \
  --stall-threshold-minutes 15 \
  --out state/reports/example-recovery.json
```

Recovery should either restart, re-handoff, or escalate the current milestone. It should not widen scope.

## 7. Verification and reviewer loop

```bash
node dist/src/index.js transition \
  --snapshot state/runs/example-run.json \
  --milestone L7 \
  --status verifying \
  --note "implementation complete; running build-check"

node dist/src/index.js emit-verification-command \
  --snapshot state/runs/example-run.json \
  --milestone L7 \
  --command "/usr/bin/node scripts/build-check.mjs" \
  --out state/verification/example-command.json

/usr/bin/node scripts/build-check.mjs

node dist/src/index.js emit-reviewer-output \
  --snapshot state/runs/example-run.json \
  --milestone L7 \
  --verdict approved \
  --summary "build-check passed" \
  --next-action complete-milestone \
  --out state/verification/example-review.json

node dist/src/index.js record-verification-result \
  --snapshot state/runs/example-run.json \
  --milestone L7 \
  --command "/usr/bin/node scripts/build-check.mjs" \
  --status passed \
  --reviewer-output state/verification/example-review.json \
  --summary "build-check passed"
```

Only after the passed verification result is recorded should the milestone move to `completed`.

## 8. Milestone closeout

```bash
node dist/src/index.js transition \
  --snapshot state/runs/example-run.json \
  --milestone L7 \
  --status completed \
  --note "verification passed"
```

## Operator expectations

- Work one highest-priority incomplete milestone at a time.
- Use the supervised path: `start-run` once, then `supervisor-tick` for continuation.
- Verify every milestone before completion.
- Commit exactly once per landed milestone.
- Push immediately after every milestone commit.
- Keep the watchdog cadence active while unchecked milestones remain.
- Disable the watchdog only after the plan is fully complete and the final verification checkpoint passes.
