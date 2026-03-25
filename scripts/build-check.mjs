import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(' ')} failed`);
  }

  return result;
}

function importBuiltModule(relativePath) {
  const absolutePath = path.resolve(relativePath);
  return import(pathToFileURL(absolutePath).href);
}

run('/usr/bin/npx', ['tsc', '-p', 'tsconfig.json']);
run(process.execPath, ['--check', 'dist/src/index.mjs']);
run(process.execPath, ['--check', 'dist/src/core/plan.mjs']);
run(process.execPath, ['--check', 'dist/src/core/run-state.mjs']);
run(process.execPath, ['--check', 'dist/src/core/events.mjs']);
run(process.execPath, ['--check', 'dist/src/core/contracts.mjs']);
run(process.execPath, ['--check', 'dist/src/core/health.mjs']);
run(process.execPath, ['--check', 'dist/src/core/recovery.mjs']);
run(process.execPath, ['--check', 'dist/src/core/openclaw.mjs']);
run(process.execPath, ['--check', 'dist/src/core/verification.mjs']);

const [
  contractsModule,
  eventsModule,
  healthModule,
  planModule,
  recoveryModule,
  openClawModule,
  runStateModule,
  verificationModule,
] = await Promise.all([
  importBuiltModule('dist/src/core/contracts.mjs'),
  importBuiltModule('dist/src/core/events.mjs'),
  importBuiltModule('dist/src/core/health.mjs'),
  importBuiltModule('dist/src/core/plan.mjs'),
  importBuiltModule('dist/src/core/recovery.mjs'),
  importBuiltModule('dist/src/core/openclaw.mjs'),
  importBuiltModule('dist/src/core/run-state.mjs'),
  importBuiltModule('dist/src/core/verification.mjs'),
]);

const {
  createImplementerContract,
  createPlannerIntent,
  selectNextActionableMilestone,
  writeContractDocument,
} = contractsModule;
const {
  eventLogPathForSnapshot,
  initializeRunArtifacts,
  loadRunEvents,
  recordRecoveryAction,
  recordVerificationResult,
  recordWorkerHeartbeat,
  transitionMilestone,
} = eventsModule;
const { evaluateRunHealth, writeHealthReport } = healthModule;
const { loadImplementationPlan, summarizePlan } = planModule;
const { createRecoveryPlan, writeRecoveryPlan } = recoveryModule;
const {
  createCronAdapter,
  createSessionHistoryAdapter,
  createSessionSendAdapter,
  createSessionSpawnAdapter,
  writeOpenClawAdapter,
} = openClawModule;
const { createRunState } = runStateModule;
const {
  createReviewerOutput,
  createVerificationCommand,
  writeVerificationDocument,
} = verificationModule;

const plan = loadImplementationPlan('IMPLEMENTATION_PLAN.md');
const summary = summarizePlan(plan.milestones);
const nextMilestoneId = summary.next?.id;
assert(summary.total >= 4, 'expected at least four milestones in IMPLEMENTATION_PLAN.md');
const targetMilestoneId = nextMilestoneId ?? plan.milestones.at(-1)?.id ?? null;
assert(targetMilestoneId, 'expected IMPLEMENTATION_PLAN.md to contain at least one milestone');

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'laizy-build-'));
const snapshotPath = path.join(tempDir, 'run.json');

const syntheticMilestones = plan.milestones.map((milestone) => ({
  ...milestone,
  completed: milestone.id === targetMilestoneId ? false : milestone.completed,
}));

const runState = createRunState({
  runId: 'build-check',
  goal: 'Verify event-log-backed run state',
  repoPath: process.cwd(),
  planPath: plan.path,
  milestones: syntheticMilestones,
});

const initialized = initializeRunArtifacts(snapshotPath, runState);
assert(initialized.snapshot.currentMilestoneId === targetMilestoneId, `expected initialized run to point at ${targetMilestoneId}`);
assert(initialized.snapshot.status === 'planned', 'expected initialized run status to be planned');
assert(initialized.snapshot.eventCount === 1, 'expected one initialization event');
assert(
  (initialized.snapshot.milestones.find((milestone) => milestone.id === targetMilestoneId)?.details.length ?? 0) >= 1,
  'expected active milestone details to be captured from the implementation plan',
);

const selected = selectNextActionableMilestone(initialized.snapshot);
assert(selected?.id === targetMilestoneId, `expected actionable milestone selection to return ${targetMilestoneId}`);

const plannerIntent = createPlannerIntent(initialized.snapshot, selected);
assert(plannerIntent.kind === 'planner.intent', 'expected planner intent document kind');
assert(plannerIntent.scope.milestoneCount === 1, 'expected planner intent to enforce single-milestone scope');
assert((plannerIntent.selectedMilestone?.details.length ?? 0) >= 1, 'expected planner intent to include milestone details');

const implementerContract = createImplementerContract(initialized.snapshot, selected);
assert(implementerContract.kind === 'implementer.contract', 'expected implementer contract document kind');
assert(implementerContract.milestone?.id === targetMilestoneId, `expected implementer contract to target ${targetMilestoneId}`);

const contractPath = writeContractDocument(path.join(tempDir, 'contracts', 'implementer.json'), implementerContract);
const persistedContract = JSON.parse(readFileSync(contractPath, 'utf8'));
assert(persistedContract.milestone?.id === targetMilestoneId, `expected persisted contract to target ${targetMilestoneId}`);

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

const verificationCommand = createVerificationCommand(initialized.snapshot, {
  command: '/usr/bin/node scripts/build-check.mjs',
});
assert(verificationCommand.kind === 'verification.command', 'expected verification command document kind');
assert(verificationCommand.worker === 'laizy-verifier', 'expected verification command to target stable verifier label');

const reviewerOutput = createReviewerOutput(initialized.snapshot, {
  verdict: 'approved',
  summary: 'Verification passed cleanly.',
  findings: [],
  nextAction: 'complete-milestone',
});
assert(reviewerOutput.kind === 'reviewer.output', 'expected reviewer output document kind');
assert(reviewerOutput.verdict === 'approved', 'expected reviewer output to preserve verdict');

const reviewerOutputPath = writeVerificationDocument(path.join(tempDir, 'verification', 'reviewer.json'), reviewerOutput);
const persistedReviewerOutput = JSON.parse(readFileSync(reviewerOutputPath, 'utf8'));
assert(persistedReviewerOutput.verdict === 'approved', 'expected persisted reviewer output to remain machine-readable');

const started = transitionMilestone(snapshotPath, {
  milestoneId: targetMilestoneId,
  status: 'implementing',
  note: 'worker picked up milestone',
});

const stalledCheckedAt = new Date(Date.parse(started.snapshot.updatedAt) + 30 * 60 * 1000).toISOString();
const stalledReport = evaluateRunHealth(started.snapshot, {
  now: stalledCheckedAt,
  stallThresholdMinutes: 15,
});
assert(stalledReport.overallStatus === 'stalled', 'expected run-health inspection to flag a stalled implementer');
assert(
  stalledReport.recoveryRecommendation.action === 'restart-implementer',
  'expected stalled run-health inspection to emit a restart recommendation',
);

const recoveryPlan = createRecoveryPlan(started.snapshot, stalledReport);
assert(recoveryPlan.action === 'restart-implementer', 'expected recovery plan to mirror stalled recommendation');
assert(recoveryPlan.resumeContract?.milestone?.id === targetMilestoneId, 'expected recovery plan to include bounded resume contract');

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
  milestoneId: targetMilestoneId,
  status: 'verifying',
  note: 'verification started',
});

let completionBlocked = false;
try {
  transitionMilestone(snapshotPath, {
    milestoneId: targetMilestoneId,
    status: 'completed',
    note: 'attempted completion without explicit verification result',
  });
} catch (error) {
  completionBlocked = String(error?.message ?? error).includes('without a passed verification result');
}
assert(completionBlocked, 'expected milestone completion to be gated on a passed verification result');

const verificationRecord = recordVerificationResult(snapshotPath, {
  milestoneId: targetMilestoneId,
  command: '/usr/bin/node scripts/build-check.mjs',
  status: 'passed',
  outputPath: reviewerOutputPath,
  summary: 'build-check passed',
  reviewerOutput,
});
assert(verificationRecord.snapshot.verification.length === 1, 'expected verification result to be persisted in snapshot state');
assert(verificationRecord.snapshot.verification[0]?.reviewerOutput?.verdict === 'approved', 'expected reviewer output to be retained alongside verification history');

const completed = transitionMilestone(snapshotPath, {
  milestoneId: targetMilestoneId,
  status: 'completed',
  note: 'verification passed',
});

const expectedRemainingMilestoneId = syntheticMilestones.find((milestone) => !milestone.completed && milestone.id !== targetMilestoneId)?.id ?? null;
const expectedRunStatus = expectedRemainingMilestoneId ? 'planned' : 'completed';

assert(completed.snapshot.currentMilestoneId === expectedRemainingMilestoneId, 'expected completed milestone to advance current pointer to the next incomplete milestone');
assert(completed.snapshot.status === expectedRunStatus, 'expected run status to reflect whether incomplete milestones remain');
assert(completed.snapshot.eventCount === 7, 'expected initialization, recovery, heartbeat, verification, and milestone transitions in event log');

const persisted = JSON.parse(readFileSync(snapshotPath, 'utf8'));
assert(persisted.currentMilestoneId === expectedRemainingMilestoneId, 'expected persisted snapshot to point at the next incomplete milestone');
assert(persisted.milestones.find((milestone) => milestone.id === targetMilestoneId)?.status === 'completed', 'expected persisted active milestone status to be completed');
assert(persisted.recovery.length === 1, 'expected persisted snapshot to retain recovery action history');
assert(persisted.verification.length === 1, 'expected persisted snapshot to retain verification history');

const events = loadRunEvents(eventLogPathForSnapshot(snapshotPath));
assert(events.length === 7, 'expected event log to contain seven events');

rmSync(tempDir, { recursive: true, force: true });
console.log('build-check: ok');
