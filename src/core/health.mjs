import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_STALL_THRESHOLD_MINUTES = 15;

function toTimestamp(value) {
  return value ? Date.parse(value) : Number.NaN;
}

function getWorkerHeartbeat(snapshot, workerName) {
  return snapshot.workerHeartbeats?.[workerName] ?? null;
}

function getMilestone(snapshot, milestoneId) {
  return snapshot.milestones.find((milestone) => milestone.id === milestoneId) ?? null;
}

export function createRecoveryRecommendation({
  action,
  reason,
  worker,
  milestoneId = null,
  severity = 'info',
}) {
  return {
    schemaVersion: 1,
    kind: 'recovery.recommendation',
    generatedAt: new Date().toISOString(),
    action,
    reason,
    severity,
    worker,
    milestoneId,
  };
}

export function evaluateRunHealth(snapshot, options = {}) {
  const checkedAt = options.now ?? new Date().toISOString();
  const stallThresholdMinutes = Number(options.stallThresholdMinutes ?? DEFAULT_STALL_THRESHOLD_MINUTES);
  const stallThresholdMs = stallThresholdMinutes * 60 * 1000;
  const activeMilestone = getMilestone(snapshot, snapshot.currentMilestoneId);
  const implementerWorker = snapshot.workers.implementer;
  const implementerHeartbeat = getWorkerHeartbeat(snapshot, implementerWorker);
  const implementerHeartbeatAt = implementerHeartbeat?.at ?? null;
  const implementerHeartbeatMs = toTimestamp(implementerHeartbeatAt);
  const milestoneUpdatedMs = toTimestamp(activeMilestone?.updatedAt ?? null);
  const lastProgressMs = Math.max(
    Number.isFinite(implementerHeartbeatMs) ? implementerHeartbeatMs : Number.NEGATIVE_INFINITY,
    Number.isFinite(milestoneUpdatedMs) ? milestoneUpdatedMs : Number.NEGATIVE_INFINITY,
  );
  const checkedAtMs = toTimestamp(checkedAt);
  const idleMs = Number.isFinite(lastProgressMs) ? checkedAtMs - lastProgressMs : null;

  let overallStatus = 'healthy';
  let reason = 'Run is progressing normally.';
  let recoveryRecommendation = createRecoveryRecommendation({
    action: 'none',
    reason,
    worker: implementerWorker,
    milestoneId: activeMilestone?.id ?? null,
  });

  if (snapshot.status === 'completed') {
    overallStatus = 'completed';
    reason = 'All milestones are completed.';
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'none',
      reason,
      worker: implementerWorker,
      milestoneId: null,
    });
  } else if (snapshot.status === 'blocked') {
    overallStatus = 'blocked';
    reason = 'Run is blocked and needs escalation.';
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'escalate-blocked',
      reason,
      severity: 'high',
      worker: snapshot.workers.recovery,
      milestoneId: activeMilestone?.id ?? null,
    });
  } else if (snapshot.status === 'planned') {
    overallStatus = 'idle';
    reason = 'Run is planned but no implementer activity has started yet.';
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'rehand-off',
      reason,
      severity: 'medium',
      worker: implementerWorker,
      milestoneId: activeMilestone?.id ?? null,
    });
  } else if (
    (snapshot.status === 'implementing' || snapshot.status === 'verifying')
    && Number.isFinite(idleMs)
    && idleMs > stallThresholdMs
  ) {
    overallStatus = 'stalled';
    reason = `No implementer progress was recorded within ${stallThresholdMinutes} minute(s).`;
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'restart-implementer',
      reason,
      severity: 'high',
      worker: snapshot.workers.recovery,
      milestoneId: activeMilestone?.id ?? null,
    });
  }

  return {
    schemaVersion: 1,
    kind: 'run.health',
    checkedAt,
    stallThresholdMinutes,
    runId: snapshot.runId,
    runStatus: snapshot.status,
    overallStatus,
    activeMilestoneId: activeMilestone?.id ?? null,
    implementerHeartbeatAt,
    milestoneUpdatedAt: activeMilestone?.updatedAt ?? null,
    idleMinutes: idleMs === null ? null : Math.max(0, Math.floor(idleMs / 60000)),
    recoveryRecommendation,
  };
}

export function writeHealthReport(outputPath, report) {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
