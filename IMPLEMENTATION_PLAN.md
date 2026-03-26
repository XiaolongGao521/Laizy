# IMPLEMENTATION_PLAN.md

Goal: make Laizy publishable on npm and add Apache-2.0 licensing, using the Laizy-native supervisor/planner flow rather than manual milestone authoring.

## Execution rules
- This plan is the authoritative execution queue for the npm-publishable + Apache-2.0 slice.
- Advance one highest-priority incomplete milestone at a time.
- After each completed milestone: update this file, verify with `/usr/bin/node scripts/build-check.mjs`, commit exactly once, and push immediately.
- Keep scope narrow and compatibility-safe; prefer publishable-package wiring over broad product changes.
- The compiled CLI entrypoint is `dist/src/index.js`; use `start-run` and `supervisor-tick` to drive the run.
- Treat `npm pack --dry-run` plus `/usr/bin/node scripts/build-check.mjs` as the packaging-readiness gates for this slice.

### [x] P1 - Add npm-ready package metadata and Apache-2.0 licensing
- Added publish-ready `package.json` metadata: Apache-2.0 license, repository/homepage/bugs links, explicit CLI/package entrypoints, and an explicit minimal `files` publish surface.
- Added the Apache-2.0 `LICENSE` file and aligned `README.md` wording around the published `laizy` CLI entrypoint and package identity.
- Limited the intended published artifact to compiled runtime assets plus required package docs (`dist/`, `README.md`, `LICENSE`).
- Verification checkpoint passed: `/usr/bin/node scripts/build-check.mjs`

### [ ] P2 - Make the package packable from a clean checkout
- Wire the package scripts and packaging controls so `npm pack --dry-run` can succeed from a fresh clone without depending on committed `dist/` output.
- Validate that the tarball includes the compiled CLI/runtime entrypoint and excludes development-only paths such as local run state, source-control noise, and other repo-internal artifacts.
- Prefer the smallest compatible change set (`files`, `.npmignore`, `prepack`/`prepare`, or related package wiring) that preserves the current local developer workflow.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`

### [ ] P3 - Refresh README/publish docs and finish package verification
- Update `README.md` with npm install/usage guidance, publish expectations, and the Apache-2.0 license notice for the packaged CLI.
- Record the final package-readiness checks in-repo, including `npm pack --dry-run` and `/usr/bin/node scripts/build-check.mjs`, so closeout has an explicit done condition.
- After docs and tarball contents are correct, capture the final verification note in this plan before marking the slice complete.
- Verification checkpoint: `/usr/bin/node scripts/build-check.mjs`
