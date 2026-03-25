import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createImplementerContract,
  createPlannerIntent,
  selectNextActionableMilestone,
  writeContractDocument,
} from '../src/core/contracts.mjs';
import {
  eventLogPathForSnapshot,
  initializeRunArtifacts,
  loadRunEvents,
  recordRecoveryAction,
  recordWorkerHeartbeat,
  transitionMilestone,
} from '../src/core/events.mjs';
import { evaluateRunHealth, writeHealthReport } from '../src/core/health.mjs';
import { loadImplementationPlan, summarizePlan } from '../src/core/plan.mjs';
import { createRecoveryPlan, writeRecoveryPlan } from '../src/core/recovery.mjs';
import {
  createCronAdapter,
  createSessionHistoryAdapter,
  createSessionSendAdapter,
  createSessionSpawnAdapter,
  writeOpenClawAdapter,
} from '../src/core/openclaw.mjs';
import { createRunState } from '../src/core/run-state.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runNodeCheck(target) {
  const result = spawnSync(process.execPath, ['--check', target], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `node --check failed for ${target}`);
  }
}

runNodeCheck('src/index.mjs');
runNodeCheck('src/core/plan.mjs');
runNodeCheck('src/core/run-state.mjs');
runNodeCheck('src/core/events.mjs');
runNodeCheck('src/core/contracts.mjs');
runNodeCheck('src/core/health.mjs');
runNodeCheck('src/core/recovery.mjs');
runNodeCheck('src/core/openclaw.mjs');

const plan = loadImplementationPlan('IMPLEMENTATION_PLAN.md');
const summary = summarizePlan(plan.milestones);
const nextMilestoneId = summary.next?.id;
assert(summary.total >= 7, 'expected at least seven milestones in IMPLEMENTATION_PLAN.md');
assert(nextMilestoneId === 'L6', 'expected next incomplete milestone to be L6 after recovery-planning milestone');

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'laizy-build-'));
const snapshotPath = path.join(tempDir, 'run.json');

const runState = createRunState({
  runId: 'build-check',
  goal: 'Verify event-log-backed run state',
  repoPath: process.cwd(),
  planPath: plan.path,
  milestones: plan.milestones,
});

const initialized = initializeRunArtifacts(snapshotPath, runState);
assert(initialized.snapshot.currentMilestoneId === nextMilestoneId, `expected initialized run to point at ${nextMilestoneId}`);
assert(initialized.snapshot.status === 'planned', 'expected initialized run status to be planned');
assert(initialized.snapshot.eventCount === 1, 'expected one initialization event');
assert(
  (initialized.snapshot.milestones.find((milestone) => milestone.id === nextMilestoneId)?.details.length ?? 0) >= 1,
  'expected active milestone details to be captured from the implementation plan',
);

const selected = selectNextActionableMilestone(initialized.snapshot);
assert(selected?.id === nextMilestoneId, `expected actionable milestone selection to return ${nextMilestoneId}`);

const plannerIntent = createPlannerIntent(initialized.snapshot, selected);
assert(plannerIntent.kind === 'planner.intent', 'expected planner intent document kind');
assert(plannerIntent.scope.milestoneCount === 1, 'expected planner intent to enforce single-milestone scope');
assert((plannerIntent.selectedMilestone?.details.length ?? 0) >= 1, 'expected planner intent to include milestone details');

const implementerContract = createImplementerContract(initialized.snapshot, selected);
assert(implementerContract.kind === 'implementer.contract', 'expected implementer contract document kind');
assert(implementerContract.milestone?.id === nextMilestoneId, `expected implementer contract to target ${nextMilestoneId}`);

const contractPath = writeContractDocument(path.join(tempDir, 'contracts', 'implementer.json'), implementerContract);
const persistedContract = JSON.parse(readFileSync(contractPath, 'utf8'));
assert(persistedContract.milestone?.id === nextMilestoneId, `expected persisted contract to target ${nextMilestoneId}`);

const spawnAdapter = createSessionSpawnAdapter(initialized.snapshot, { worker: 'implementer' });
assert(spawnAdapter.kind === 'openclaw.sessions_spawn', 'expected spawn adapter document kind');
assert(spawnAdapter.payload.sessionLabel === 'laizy-implementer', 'expected implementer spawn adapter to use stable label');
assert(spawnAdapter.payload.promptDocument?.kind === 'implementer.contract', 'expected implementer spawn adapter to embed the implementer contract');

const sendAdapter = createSessionSendAdapter(initialized.snapshot, {
  worker: 'implementer',
  message: 'resume milestone execution',
  mode: 'append',
});
assert(sendAdapter.kind === 'openclaw.sessions_send', 'expected send adapter document kind');
assert(sendAdapter.payload.message === 'resume milestone execution', 'expected send adapter to preserve the steering message');

const historyAdapter = createSessionHistoryAdapter(initialized.snapshot, {
  worker: 'implementer',
  limit: 5,
  includeToolCalls: true,
});
assert(historyAdapter.kind === 'openclaw.sessions_history', 'expected history adapter document kind');
assert(historyAdapter.payload.includeToolCalls === true, 'expected history adapter to preserve tool-call inspection flag');

const cronAdapter = createCronAdapter(initialized.snapshot, { worker: 'watchdog' });
assert(cronAdapter.kind === 'openclaw.cron', 'expected cron adapter document kind');
assert(cronAdapter.payload.targetWorker === 'laizy-watchdog', 'expected cron adapter to preserve stable watchdog label');
assert(cronAdapter.payload.schedule === '*/5 * * * *', 'expected cron adapter to default to five-minute cadence');

const spawnAdapterPath = writeOpenClawAdapter(path.join(tempDir, 'adapters', 'spawn.json'), spawnAdapter);
const persistedSpawnAdapter = JSON.parse(readFileSync(spawnAdapterPath, 'utf8'));
assert(persistedSpawnAdapter.payload.sessionLabel === 'laizy-implementer', 'expected persisted spawn adapter to remain machine-readable');

const started = transitionMilestone(snapshotPath, {
  milestoneId: nextMilestoneId,
  status: 'implementing',
  note: 'worker picked up milestone',
});

const stalledReport = evaluateRunHealth(started.snapshot, {
  now: '2026-03-25T06:30:00.000Z',
  stallThresholdMinutes: 15,
});
assert(stalledReport.overallStatus === 'stalled', 'expected run-health inspection to flag a stalled implementer');
assert(
  stalledReport.recoveryRecommendation.action === 'restart-implementer',
  'expected stalled run-health inspection to emit a restart recommendation',
);

const recoveryPlan = createRecoveryPlan(started.snapshot, stalledReport);
assert(recoveryPlan.action === 'restart-implementer', 'expected recovery plan to mirror stalled recommendation');
assert(recoveryPlan.resumeContract?.milestone?.id === nextMilestoneId, 'expected recovery plan to include bounded resume contract');

const recoveryPlanPath = writeRecoveryPlan(path.join(tempDir, 'recovery', 'plan.json'), recoveryPlan);
const persistedRecoveryPlan = JSON.parse(readFileSync(recoveryPlanPath, 'utf8'));
assert(persistedRecoveryPlan.action === 'restart-implementer', 'expected persisted recovery plan to remain machine-readable');

const recoveryRecord = recordRecoveryAction(snapshotPath, {
  action: recoveryPlan.action,
  reason: recoveryPlan.reason,
  worker: recoveryPlan.worker,
  milestoneId: recoveryPlan.milestoneId,
  note: 'watchdog requested bounded resume',
  source: 'watchdog',
});
assert(recoveryRecord.snapshot.recovery.length === 1, 'expected recovery action to be persisted in snapshot state');

const heartbeat = recordWorkerHeartbeat(snapshotPath, {
  worker: 'laizy-implementer',
  note: 'still making progress',
  metadata: { surface: 'build-check' },
});
assert(heartbeat.snapshot.workerHeartbeats['laizy-implementer']?.note === 'still making progress', 'expected heartbeat state to persist');

const healthyReport = evaluateRunHealth(heartbeat.snapshot, {
  now: heartbeat.snapshot.workerHeartbeats['laizy-implementer']?.at,
  stallThresholdMinutes: 15,
});
assert(healthyReport.overallStatus === 'healthy', 'expected fresh heartbeat to clear stalled status');
assert(healthyReport.recoveryRecommendation.action === 'none', 'expected healthy run-health inspection to avoid recovery action');

const reportPath = writeHealthReport(path.join(tempDir, 'reports', 'health.json'), healthyReport);
const persistedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
assert(persistedReport.overallStatus === 'healthy', 'expected persisted health report to remain machine-readable');

transitionMilestone(snapshotPath, {
  milestoneId: nextMilestoneId,
  status: 'verifying',
  note: 'verification started',
});
const completed = transitionMilestone(snapshotPath, {
  milestoneId: nextMilestoneId,
  status: 'completed',
  note: 'verification passed',
});

assert(completed.snapshot.currentMilestoneId === 'L7', 'expected completed milestone to advance current pointer to L7');
assert(completed.snapshot.status === 'planned', 'expected run to return to planned after a milestone completes');
assert(completed.snapshot.eventCount === 6, 'expected initialization, recovery, heartbeat, and milestone transitions in event log');

const persisted = JSON.parse(readFileSync(snapshotPath, 'utf8'));
assert(persisted.currentMilestoneId === 'L7', 'expected persisted snapshot to point at L7');
assert(persisted.milestones.find((milestone) => milestone.id === nextMilestoneId)?.status === 'completed', 'expected persisted active milestone status to be completed');
assert(persisted.recovery.length === 1, 'expected persisted snapshot to retain recovery action history');

const events = loadRunEvents(eventLogPathForSnapshot(snapshotPath));
assert(events.length === 6, 'expected event log to contain six events');

rmSync(tempDir, { recursive: true, force: true });
console.log('build-check: ok');
