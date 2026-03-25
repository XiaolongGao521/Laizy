import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createImplementerContract, selectNextActionableMilestone } from './contracts.mjs';
import { evaluateRunHealth } from './health.mjs';

export function createRecoveryPlan(snapshot, healthReport = evaluateRunHealth(snapshot)) {
  const milestone = selectNextActionableMilestone(snapshot);
  const recommendation = healthReport.recoveryRecommendation;
  const shouldResume = recommendation.action === 'restart-implementer' || recommendation.action === 'rehand-off';

  return {
    schemaVersion: 1,
    kind: 'recovery.plan',
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    basedOnHealthReport: {
      checkedAt: healthReport.checkedAt,
      overallStatus: healthReport.overallStatus,
      action: recommendation.action,
    },
    action: recommendation.action,
    worker: recommendation.worker,
    milestoneId: recommendation.milestoneId,
    reason: recommendation.reason,
    severity: recommendation.severity,
    resumeContract: shouldResume && milestone
      ? createImplementerContract(snapshot, milestone)
      : null,
    escalation: recommendation.action === 'escalate-blocked'
      ? {
          targetWorker: snapshot.workers.recovery,
          targetMilestoneId: recommendation.milestoneId,
          mode: 'blocked-escalation',
        }
      : null,
  };
}

export function createRecoveryActionRecord({ action, reason, worker, milestoneId, note, source }) {
  return {
    action,
    reason,
    worker,
    milestoneId: milestoneId ?? null,
    note: note ?? null,
    source: source ?? 'manual',
  };
}

export function writeRecoveryPlan(outputPath, document) {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
