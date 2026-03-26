# IMPLEMENTATION_PLAN.md

Goal: add a dedicated planner subagent path so Laizy can invoke planning/replanning as a first-class supervised worker role instead of relying on manual plan reasoning in chat.

## Execution rules
- This plan is the authoritative execution queue for the planner-subagent slice.
- Advance one highest-priority incomplete milestone at a time.
- After each completed milestone: update this file, verify with `/usr/bin/node scripts/build-check.mjs`, commit exactly once, and push immediately.
- Keep scope narrow and compatibility-safe; extend existing supervisor/openclaw/runtime-profile primitives rather than inventing a separate orchestration subsystem.
- The compiled CLI entrypoint is `dist/src/index.js`; the wrapper flow remains `start-run` once, then `supervisor-tick` for continuation.

### [x] P1 - Add first-class planner request artifacts and plan-needed bootstrap semantics
- Add a machine-readable `planner.request` document type describing goal, repo, plan path, current plan state, requested mode (`plan` or `replan`), and trigger reason.
- Teach run initialization / supervisor bootstrap to distinguish an empty-or-missing-actionable plan from a completed run so Laizy can request planning instead of closing out.
- Keep the first version deterministic and compatible with the existing snapshot/event-log model.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
- Completed: added `planner.request`, preserved `needs-plan` bootstrap state for empty plans, and verified with `/usr/bin/node scripts/build-check.mjs`.

### [x] P2 - Add `plan` / `replan` supervisor decisions and planner spawn adapters
- Extend `supervisor-tick` to emit `plan` or `replan` decisions when the run lacks actionable milestones or when the current run state clearly requires plan repair.
- Emit bounded planner bundles containing `planner.request` plus OpenClaw planner spawn adapters.
- Thread runtime-profile selection into planner decisions so planning can use a stronger default profile than ordinary implementation when appropriate.
- Keep existing `continue` / `recover` / `verify` / `closeout` behavior stable.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
- Completed: supervisor now emits `plan`/`replan` decisions with planner bundles and planner spawn adapters, and planner runtime selection is high-thinking by default.

### [ ] P3 - Refresh README and verification coverage for planner-driven runs
- Update `README.md` to explain when `supervisor-tick` emits `plan` / `replan` and how a dedicated planner worker fits into the wrapper-driven operator flow.
- Document the intended operator contract that supervisors should consume planner manifests/artifacts instead of improvising plan refreshes in chat.
- Extend `scripts/build-check.mjs` to cover plan-needed bootstrap, replan triggers, planner bundle emission, and planner runtime-profile selection.
- Record the final verification checkpoint and notable discoveries in this plan.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
