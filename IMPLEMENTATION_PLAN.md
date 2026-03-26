# IMPLEMENTATION_PLAN.md

Goal: allow the Laizy supervisor process to choose model, reasoning mode, and thinking effort depending on task scope, then emit those runtime choices as part of the bounded machine-readable next-action bundle.

## Execution rules
- This plan is the authoritative execution queue for the runtime-profile slice.
- Advance one highest-priority incomplete milestone at a time.
- After each completed milestone: update this file, verify with `/usr/bin/node scripts/build-check.mjs`, commit exactly once, and push immediately.
- Keep scope narrow and compatibility-safe; prefer extending existing supervisor/openclaw primitives over introducing a separate orchestration subsystem.
- The compiled CLI entrypoint is `dist/src/index.js`; the wrapper flow remains `start-run` once, then `supervisor-tick` for continuation.

### [x] R1 - Add scope-aware runtime profile selection in supervisor logic
- Add explicit runtime profile types covering at least model, thinking effort, and reasoning mode.
- Teach the supervisor layer to classify the current next action (`continue`, `recover`, `verify`, `closeout`) and active milestone scope into a bounded runtime profile.
- Keep the first heuristic version simple and deterministic.
- Default reasoning visibility conservatively for shared/group-safe operation.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
- Completed 2026-03-26: added explicit supervisor runtime-profile types plus deterministic action/scope classification with conservative hidden-reasoning defaults; verified via `/usr/bin/node scripts/build-check.mjs`.

### [ ] R2 - Thread runtime profiles through emitted Laizy/OpenClaw artifacts
- Attach the selected runtime profile to the supervisor decision bundle.
- Thread model/thinking into emitted OpenClaw spawn adapters where applicable.
- Carry reasoning mode as an explicit machine-readable field in the emitted runtime/adaptor documents, even where execution remains wrapper-mediated.
- Keep continue/recover/verify bundles explicit about which worker/runtime profile should be used next.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`

### [ ] R3 - Refresh README and verification coverage for runtime-profile-aware supervision
- Update `README.md` to explain that `supervisor-tick` now chooses runtime profile as well as next action.
- Document the intended operator contract around automatic model/thinking/reasoning selection and any conservative defaults.
- Extend `scripts/build-check.mjs` to assert that the emitted bundles include the expected runtime profile data across representative supervisor decisions.
- Record the final verification checkpoint and notable discoveries in this plan.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
