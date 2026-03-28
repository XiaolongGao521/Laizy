# Demo Implementation Plan

Goal: demonstrate Laizy's milestone-oriented delivery flow with a simple, user-facing example plan.

### [x] E1 - Capture the goal and establish durable run artifacts
- Define a clear user goal.
- Initialize a run snapshot and event log.
- Keep the first milestone small and auditable.

### [ ] E2 - Emit bounded worker contracts for the next implementation step
- Select the highest-priority actionable milestone.
- Emit a planner intent and implementer contract from the emitted handoff bundle.
- Record enough milestone progress that a rebuilt snapshot can resume the same step without widening scope.
- Keep scope constrained to one milestone at a time.

### [ ] E3 - Verify, recover if needed, and close out the run
- Run verification before completion.
- Emit recovery guidance when progress stalls.
- Rebuild from the event log and re-run `supervisor-tick` to demonstrate restartable, artifact-driven continuation.
- Finish with a closeout decision once all milestones are complete.
