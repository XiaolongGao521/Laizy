Goal: convert Laizy from JavaScript `.mjs` modules to a TypeScript-first repository without a risky flag-day rewrite.

## Execution rules
- The plan is the authoritative execution queue for TypeScript migration work in this repository.
- Build mode should advance one highest-priority incomplete milestone at a time.
- Every completed milestone must be verified, committed once, and pushed.
- Prefer compatibility-safe slices that keep the repo runnable after each milestone.
- In this environment, use `/usr/bin/node scripts/build-check.mjs` as the primary verification checkpoint unless a stronger TS-aware path is added and passes here.

### [x] T1 - Add TypeScript toolchain and TS-first package wiring
- Added `typescript` and `@types/node` as development dependencies.
- Introduced a repo-local `tsconfig.json` configured for Node ESM output with `allowJs` so the migration can proceed incrementally.
- Updated package scripts to add explicit `compile` and `typecheck` entry points while keeping `/usr/bin/node scripts/build-check.mjs` as the canonical build verification path.
- Refreshed `scripts/build-check.mjs` to compile into `dist/` and validate the built artifacts instead of only checking source files in place.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
- Discovery: `allowJs` + `NodeNext` lets the repo adopt a TS-first build pipeline before the source conversion is complete, which keeps each migration slice runnable.
- Discovery: the verification script should derive stall-check timestamps from the active snapshot rather than hard-coding dates, otherwise time-sensitive health assertions become flaky.

### [x] T2 - Convert core planning and run-state modules under `src/core/` to TypeScript
- Converted the plan, run-state, contracts, events, health, recovery, OpenClaw adapter, and verification modules from `.mjs` to `.ts`.
- Added a shared `src/core/types.ts` module covering milestone, run snapshot, worker, recovery, and verification document shapes.
- Preserved the existing machine-readable artifact contracts while switching ESM source imports to `.js` specifiers for NodeNext-compatible TypeScript output.
- Updated the compiled smoke path so the repo continues to run through `dist/` while the CLI entrypoint itself is still being migrated.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
- Discovery: NodeNext TypeScript conversion works cleanly when source files use runtime `.js` specifiers even before the whole tree is renamed, which makes staged ESM migration much safer.
- Discovery: dynamic object-literal keys for worker heartbeats need an explicit typed baseline in TS, otherwise the stable worker-label contract gets widened into an unsafe index signature.

### [x] T3 - Convert the CLI entrypoint and verification script to TypeScript-aware operation
- Converted `src/index.mjs` to `src/index.ts` while preserving the command surface and JSON output behavior.
- Tightened the CLI option typing enough for `tsc` to validate worker/status arguments without changing runtime semantics.
- Updated runtime references to use compiled `dist/src/index.js` output, including the smoke-init package script and CLI help text.
- Kept `scripts/build-check.mjs` green against the compiled TypeScript CLI + core flow in this environment.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
- Discovery: even with `strict` disabled, the CLI still benefits from explicit narrow casts at the command boundary because worker-role and milestone-status unions catch accidental contract drift immediately.
- Discovery: once the entrypoint becomes TypeScript, the operator-facing help/examples need to point at compiled output instead of source paths or they quietly teach a broken invocation path.

### [ ] T4 - Refresh repository docs for the TypeScript-first layout
- Update `README.md` and any directly affected docs/examples to reference `src/*.ts`, compiled output, and the new build expectations.
- Record the final verification checkpoint and notable migration discoveries in this plan.
