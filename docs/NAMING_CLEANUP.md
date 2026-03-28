# Naming cleanup plan

This document captures incremental naming cleanup needed to support the narrower Laizy product identity.

The goal is consistency, not churn.

## Naming principles

- keep stable CLI commands unless there is a strong compatibility reason to change them
- prefer additive wording changes before renames
- keep durable document kinds and state keys stable unless a migration path exists
- align docs, help text, and examples before changing schemas

## Preferred terms

Use these terms as the default language in docs and operator guidance.

### Product-level terms

- **repo-native control loop**
- **milestone supervisor**
- **verification-gated delivery loop**
- **durable run state**
- **supervisor bundle**

### Worker terms

- **planner**
- **implementer**
- **watchdog**
- **recovery**
- **verifier**

These already match the code and should remain the canonical role names.

## Terms to de-emphasize

These are not always wrong, but they should stop leading the story.

- "orchestration layer" when "repo-native control loop" is more precise
- "autonomous software delivery engine" when the implementation is actually milestone-supervised and operator-facing
- broad "agent platform" language that suggests a larger product than the repo currently provides
- wording that implies Laizy replaces the underlying coding agent

## Incremental cleanup targets

### 1. README and docs

- move top-level messaging toward control-loop language
- keep examples centered on `start-run` and `supervisor-tick`
- describe recovery and verification as normal parts of the loop

### 2. CLI help text

- align command descriptions with supervisor language
- prefer "bootstrap" and "continuation" where the commands already map to those concepts
- keep historical command names stable if they are already public

### 3. Artifact names and summaries

- keep document `kind` values stable for compatibility
- improve human-facing `title`, `summary`, and explanatory text first
- only rename files or kinds if the compatibility cost is clearly worth it

### 4. Example content

- update examples that still narrate the flow as ad hoc orchestration instead of bounded supervision
- keep milestone examples small and verification-oriented

## Candidate cleanup items by area

### README

- replace generic orchestration framing with repo-control-loop framing
- tighten backend language so it reads as runtime flexibility, not product sprawl

### `docs/EXAMPLE_RUN.md`

- shift examples from `init-run` to `start-run` where the supervisor flow is the intended operator path
- keep state transitions explicit

### `src/index.ts` help text

- ensure the recommended flow emphasizes `start-run` once, then `supervisor-tick`
- describe verification and closeout in the same operational language used in the docs

### Supervisor output summaries

- prefer summaries that explain the bounded next action
- avoid vague wording like "orchestration step"

## Renames to avoid for now

Do not change these without a compatibility plan:

- `start-run`
- `supervisor-tick`
- worker role names
- existing run snapshot keys
- existing document `kind` values consumed by downstream tooling

These names are already embedded in repo examples and generated artifacts.

## Migration strategy if renames become necessary later

If a future phase needs stronger cleanup:

1. add aliases or dual-written descriptions first
2. update docs and examples
3. keep emitted artifacts backward-compatible for at least one release window
4. remove old wording only after the new path is exercised

## Success criteria

Naming cleanup is successful when:

- docs, examples, and help text use the same terms for the same concepts
- the product reads as narrow and operational
- compatibility is preserved for existing commands and artifact consumers
- users can predict what a command or document does from its name
