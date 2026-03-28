# Naming cleanup plan

This document captures incremental naming cleanup needed to support the narrower Laizy product identity.

The goal is consistency, not churn.

## Phase 2 framing

This phase is wording-only cleanup.

- keep schema, wire format, and runtime compatibility stable
- do not rename CLI commands just to make the wording prettier
- do not rename document `kind` values, run snapshot keys, worker role values, or backend identifiers in this phase
- prefer aligning docs, help text, comments, titles, and summaries first

That means `start-run`, `supervisor-tick`, `init-run`, existing worker labels, and stable artifact keys can all remain in place even when the surrounding explanation gets tighter.

## Naming principles

- keep stable CLI commands unless there is a strong compatibility reason to change them
- prefer additive wording changes before renames
- keep durable document kinds and state keys stable unless a migration path exists
- align docs, help text, examples, and operator guidance before changing schemas
- treat wording cleanup as incremental: first explain the canonical flow, then de-emphasize legacy or lower-level entry points without breaking them

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

## Canonical operator story for this phase

By the end of this phase, docs, CLI help, and artifact wording should all tell the same story:

1. start from a local implementation plan
2. use `start-run` to bootstrap the run and initial supervisor artifacts
3. use `supervisor-tick` as the continuation/control decision point
4. execute one bounded milestone action at a time
5. record verification before marking the milestone completed
6. recover or resume from durable state instead of improvising from chat memory

`init-run` remains a valid compatibility-preserving lower-level command, but it should no longer lead the operator narrative when the supervised flow is what we recommend.

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
- preserve lower-level commands in reference material when they still serve compatibility or debugging use cases

### 2. CLI help text

- align command descriptions with supervisor language
- prefer "bootstrap" and "continuation" where the commands already map to those concepts
- keep historical command names stable if they are already public
- make it obvious which command is the recommended path versus a lower-level compatibility surface

### 3. Artifact names and summaries

- keep document `kind` values stable for compatibility
- improve human-facing `title`, `summary`, and explanatory text first
- only rename files or kinds if the compatibility cost is clearly worth it
- treat emitted operator guidance as explanatory copy, not a license to rename runtime keys

### 4. Example content

- update examples that still narrate the flow as ad hoc orchestration instead of bounded supervision
- keep milestone examples small and verification-oriented
- make examples match the canonical operator story used in the CLI help and README

## Candidate cleanup items by area

### README

- replace generic orchestration framing with repo-control-loop framing
- tighten backend language so it reads as runtime flexibility, not product sprawl

### `docs/EXAMPLE_RUN.md`

- lead with `start-run` for the recommended supervised path
- mention `init-run` only as an optional lower-level bootstrap when that distinction matters
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
- `init-run`
- worker role names
- existing worker labels
- existing run snapshot keys
- existing backend identifiers
- existing document `kind` values consumed by downstream tooling

These names are already embedded in repo examples, generated artifacts, and downstream automation.

## Migration strategy if renames become necessary later

If a future phase needs stronger cleanup:

1. add aliases or dual-written descriptions first
2. update docs and examples
3. keep emitted artifacts backward-compatible for at least one release window
4. remove old wording only after the new path is exercised
5. only then consider changing runtime keys, kinds, or command names

## Success criteria

Naming cleanup is successful when:

- docs, examples, help text, and artifact summaries use the same terms for the same concepts
- the product reads as narrow and operational
- compatibility is preserved for existing commands and artifact consumers
- users can predict what a command or document does from its name
