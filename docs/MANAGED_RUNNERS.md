# Managed runners

Laizy keeps planning, verification, and milestone state in its own durable run snapshot.

Managed runners fill the gap between that control-plane state and an actual backend worker launch.

## Why this exists

Without a managed launch record, a bounded contract can be emitted but the system still has to guess:

- which worker launch corresponds to which milestone
- whether the worker ever started
- what handle should be supervised
- whether completion was success, failure, timeout, cancellation, or launch failure

Managed-runner artifacts make that pairing explicit.

## Artifact set

Each bounded worker launch produces one artifact set:

1. `managed-runner.launch-request`
2. `managed-runner.launch`
3. `managed-runner.result`

The launch request points at:

- the bounded contract document
- the selected provider adapter
- the expected launch artifact path
- the expected result artifact path

The launch artifact records:

- run id
- milestone id
- worker role/label
- provider
- lifecycle status
- tracked handle
- contract/adapter/result paths
- stdout/stderr references when known

The result artifact records:

- the same run/milestone/provider binding
- terminal lifecycle status
- normalized outcome
- exit code when available
- started/ended timestamps
- tracked handle
- stdout/stderr references
- related artifact references

## Provider mapping

Managed-runner providers are intentionally narrow:

- `openclaw`
- `codex`
- `claude-code`

They reuse the existing adapter emitters under the hood, but the outer launch/result contract stays the same across providers.

## Lifecycle

1. Laizy emits the bounded worker contract.
2. Laizy emits `managed-runner.launch-request`.
3. The selected provider starts exactly one worker.
4. The tracked handle is recorded in `managed-runner.launch`.
5. The provider or wrapper watches that handle until terminal state.
6. The terminal state is normalized into `managed-runner.result`.
7. Laizy uses that result to decide whether to verify, recover, or continue.

Worker completion is not milestone completion. Verification and milestone transition remain explicit later steps.
