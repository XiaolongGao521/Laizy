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

### [ ] T2 - Convert core planning and run-state modules under `src/core/` to TypeScript
- Convert the plan, run-state, contracts, events, health, recovery, OpenClaw adapter, and verification modules from `.mjs` to `.ts`.
- Add explicit shared TypeScript types for milestones, run snapshots, events, adapters, recovery documents, and verification artifacts where that improves safety.
- Preserve current runtime behavior and machine-readable artifact shapes.
- Keep ESM-compatible imports/exports and compile cleanly through the new TS build.

### [ ] T3 - Convert the CLI entrypoint and verification script to TypeScript-aware operation
- Convert `src/index.mjs` to `src/index.ts` and keep command behavior unchanged.
- Update `scripts/build-check.mjs` only as needed so it validates the compiled TypeScript output and core end-to-end flows.
- Keep `/usr/bin/node scripts/build-check.mjs` green in this environment.

### [ ] T4 - Refresh repository docs for the TypeScript-first layout
- Update `README.md` and any directly affected docs/examples to reference `src/*.ts`, compiled output, and the new build expectations.
- Record the final verification checkpoint and notable migration discoveries in this plan.
