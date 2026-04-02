import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { summarizeManagedRunnerState } from './managed-runner.js';

import type {
  HealthReport,
  RecoveryReasoningFact,
  RecoveryRecommendation,
  RecoveryScope,
  RecoveryTrigger,
  RunSnapshot,
  WorkerHeartbeat,
  WorkerLabel,
} from './types.js';

const DEFAULT_STALL_THRESHOLD_MINUTES = 15;

type ProgressSignal = {
  at: string | null;
  source: 'implementer-heartbeat' | 'milestone-update' | 'none';
  sourceLabel: string;
};

function toTimestamp(value: string | null | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

function getWorkerHeartbeat(snapshot: RunSnapshot, workerName: WorkerLabel): WorkerHeartbeat | null {
  return snapshot.workerHeartbeats?.[workerName] ?? null;
}

function getMilestone(snapshot: RunSnapshot, milestoneId: string | null): RunSnapshot['milestones'][number] | null {
  if (!milestoneId) {
    return null;
  }

  return snapshot.milestones.find((milestone) => milestone.id === milestoneId) ?? null;
}

function getProgressSignal({
  implementerHeartbeatAt,
  milestoneUpdatedAt,
}: {
  implementerHeartbeatAt: string | null;
  milestoneUpdatedAt: string | null;
}): ProgressSignal {
  const heartbeatMs = toTimestamp(implementerHeartbeatAt);
  const milestoneMs = toTimestamp(milestoneUpdatedAt);

  if (Number.isFinite(heartbeatMs) && (!Number.isFinite(milestoneMs) || heartbeatMs >= milestoneMs)) {
    return {
      at: implementerHeartbeatAt,
      source: 'implementer-heartbeat',
      sourceLabel: 'implementer heartbeat',
    };
  }

  if (Number.isFinite(milestoneMs)) {
    return {
      at: milestoneUpdatedAt,
      source: 'milestone-update',
      sourceLabel: 'milestone update',
    };
  }

  return {
    at: null,
    source: 'none',
    sourceLabel: 'no recorded progress signal',
  };
}

function toIdleMinutes(idleMs: number | null): number | null {
  if (idleMs === null) {
    return null;
  }

  return Math.max(0, Math.floor(idleMs / 60000));
}

function createRecoveryScope({
  activeMilestone,
  note,
}: {
  activeMilestone: RunSnapshot['milestones'][number] | null;
  note: string;
}): RecoveryScope {
  if (!activeMilestone) {
    return {
      mode: 'run',
      milestoneId: null,
      milestoneTitle: null,
      note,
    };
  }

  return {
    mode: 'single-milestone',
    milestoneId: activeMilestone.id,
    milestoneTitle: activeMilestone.title,
    note,
  };
}

function createEvidence({
  snapshot,
  activeMilestone,
  checkedAt,
  implementerHeartbeatAt,
  milestoneUpdatedAt,
  progressSignal,
  idleMinutes,
  stallThresholdMinutes,
  managedRunnerState,
}: {
  snapshot: RunSnapshot;
  activeMilestone: RunSnapshot['milestones'][number] | null;
  checkedAt: string;
  implementerHeartbeatAt: string | null;
  milestoneUpdatedAt: string | null;
  progressSignal: ProgressSignal;
  idleMinutes: number | null;
  stallThresholdMinutes: number;
  managedRunnerState: ReturnType<typeof summarizeManagedRunnerState>;
}): RecoveryReasoningFact[] {
  return [
    {
      label: 'run-status',
      value: snapshot.status,
      detail: 'Run status at the time the health check was evaluated.',
    },
    {
      label: 'active-milestone-id',
      value: activeMilestone?.id ?? null,
      detail: activeMilestone?.title ?? 'No active incomplete milestone was available.',
    },
    {
      label: 'active-milestone-status',
      value: activeMilestone?.status ?? null,
      detail: activeMilestone
        ? 'Current status of the active milestone in the run snapshot.'
        : 'No active milestone status is available because no milestone is selected.',
    },
    {
      label: 'active-milestone-note',
      value: activeMilestone?.lastNote ?? null,
      detail: activeMilestone?.lastNote
        ? 'Most recent milestone note recorded in the run snapshot.'
        : 'No milestone note is currently recorded for the active milestone.',
    },
    {
      label: 'implementer-heartbeat-at',
      value: implementerHeartbeatAt,
      detail: implementerHeartbeatAt
        ? 'Most recent recorded implementer heartbeat timestamp.'
        : 'No implementer heartbeat has been recorded yet.',
    },
    {
      label: 'milestone-updated-at',
      value: milestoneUpdatedAt,
      detail: milestoneUpdatedAt
        ? 'Last time the active milestone status or note changed.'
        : 'The active milestone does not have an updatedAt timestamp.',
    },
    {
      label: 'last-progress-source',
      value: progressSignal.source,
      detail: `The health check used the ${progressSignal.sourceLabel} as the latest progress signal.`,
    },
    {
      label: 'last-progress-at',
      value: progressSignal.at,
      detail: progressSignal.at
        ? 'Timestamp used as the latest progress point for stall detection.'
        : 'No progress timestamp was available for stall detection.',
    },
    {
      label: 'checked-at',
      value: checkedAt,
      detail: 'Timestamp when the run health evaluation was produced.',
    },
    {
      label: 'idle-minutes',
      value: idleMinutes,
      detail: idleMinutes === null
        ? 'Idle duration is unavailable because no progress signal was available.'
        : 'Whole minutes since the latest progress signal.',
    },
    {
      label: 'stall-threshold-minutes',
      value: stallThresholdMinutes,
      detail: 'Configured inactivity threshold before the implementer is considered stalled.',
    },
    {
      label: 'managed-runner-launch-id',
      value: managedRunnerState.launch?.launchId ?? null,
      detail: managedRunnerState.launch
        ? `Latest managed-runner launch for the active milestone is ${managedRunnerState.launch.launchId}.`
        : 'No managed-runner launch has been recorded for the active milestone.',
    },
    {
      label: 'managed-runner-status',
      value: managedRunnerState.launch?.status ?? null,
      detail: managedRunnerState.launch
        ? `Latest managed-runner launch is in ${managedRunnerState.launch.status} state.`
        : 'No managed-runner launch state is available for the active milestone.',
    },
    {
      label: 'managed-runner-outcome',
      value: managedRunnerState.result?.outcome ?? managedRunnerState.launch?.outcome ?? null,
      detail: managedRunnerState.result
        ? `Latest managed-runner result recorded outcome ${managedRunnerState.result.outcome}.`
        : managedRunnerState.launch?.outcome
          ? `Latest managed-runner launch recorded outcome ${managedRunnerState.launch.outcome}.`
          : 'No managed-runner outcome has been recorded yet.',
    },
  ];
}

export function createRecoveryRecommendation({
  action,
  summary,
  reason,
  trigger,
  worker,
  milestoneId = null,
  severity = 'info',
  evidence,
  scope,
}: {
  action: string;
  summary: string;
  reason: string;
  trigger: RecoveryTrigger;
  worker: WorkerLabel;
  milestoneId?: string | null;
  severity?: string;
  evidence: RecoveryReasoningFact[];
  scope: RecoveryScope;
}): RecoveryRecommendation {
  return {
    schemaVersion: 1,
    kind: 'recovery.recommendation',
    generatedAt: new Date().toISOString(),
    action,
    summary,
    reason,
    trigger,
    severity,
    worker,
    milestoneId,
    evidence,
    scope,
  };
}

export function evaluateRunHealth(
  snapshot: RunSnapshot,
  options: { now?: string; stallThresholdMinutes?: number } = {},
): HealthReport {
  const checkedAt = options.now ?? new Date().toISOString();
  const stallThresholdMinutes = Number(options.stallThresholdMinutes ?? DEFAULT_STALL_THRESHOLD_MINUTES);
  const stallThresholdMs = stallThresholdMinutes * 60 * 1000;
  const activeMilestone = getMilestone(snapshot, snapshot.currentMilestoneId);
  const activeMilestoneLabel = activeMilestone
    ? `${activeMilestone.id} (${activeMilestone.title})`
    : 'no active milestone';
  const implementerWorker = snapshot.workers.implementer;
  const implementerHeartbeat = getWorkerHeartbeat(snapshot, implementerWorker);
  const implementerHeartbeatAt = implementerHeartbeat?.at ?? null;
  const milestoneUpdatedAt = activeMilestone?.updatedAt ?? null;
  const progressSignal = getProgressSignal({ implementerHeartbeatAt, milestoneUpdatedAt });
  const managedRunnerState = summarizeManagedRunnerState(snapshot, 'implementer', activeMilestone?.id ?? null);
  const lastProgressMs = toTimestamp(progressSignal.at);
  const checkedAtMs = toTimestamp(checkedAt);
  const idleMs = Number.isFinite(lastProgressMs) ? checkedAtMs - lastProgressMs : null;
  const idleMinutes = toIdleMinutes(idleMs);
  const evidence = createEvidence({
    snapshot,
    activeMilestone,
    checkedAt,
    implementerHeartbeatAt,
    milestoneUpdatedAt,
    progressSignal,
    idleMinutes,
    stallThresholdMinutes,
    managedRunnerState,
  });

  let overallStatus = 'healthy';
  let statusSummary = `Active milestone ${activeMilestoneLabel} is progressing within the configured threshold.`;
  let recoveryRecommendation = createRecoveryRecommendation({
    action: 'none',
    summary: 'No recovery action is needed.',
    reason: `Run status is ${snapshot.status}, and the latest progress signal for ${activeMilestoneLabel} is within the ${stallThresholdMinutes} minute threshold, so no recovery action was selected.`,
    trigger: 'healthy',
    worker: implementerWorker,
    milestoneId: activeMilestone?.id ?? null,
    evidence,
    scope: createRecoveryScope({
      activeMilestone,
      note: activeMilestone
        ? `Keep execution bounded to active milestone ${activeMilestone.id} while it remains incomplete.`
        : 'No active milestone scope needs recovery at this time.',
    }),
  });

  if (snapshot.status === 'completed') {
    overallStatus = 'completed';
    statusSummary = 'All verification-gated milestones are already complete.';
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'none',
      summary: 'No recovery action is needed because the run is complete.',
      reason: 'Run status is completed, so no recovery action was selected because every verification-gated milestone is already finished.',
      trigger: 'completed',
      worker: implementerWorker,
      milestoneId: null,
      evidence,
      scope: createRecoveryScope({
        activeMilestone: null,
        note: 'Recovery scope is run-level only because there is no active incomplete milestone.',
      }),
    });
  } else if (snapshot.status === 'blocked') {
    overallStatus = 'blocked';
    statusSummary = activeMilestone
      ? `Active milestone ${activeMilestoneLabel} is blocked and needs bounded escalation before work can resume.`
      : 'Run is blocked and needs bounded escalation before work can resume.';
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'escalate-blocked',
      summary: `Escalate blocked milestone ${activeMilestone?.id ?? 'unknown'} without widening scope.`,
      reason: activeMilestone?.lastNote
        ? `Run status is blocked for ${activeMilestoneLabel}, and the snapshot already records blocker note "${activeMilestone.lastNote}", so blocked escalation was selected instead of restarting the implementer.`
        : `Run status is blocked for ${activeMilestoneLabel}, so blocked escalation was selected instead of restarting the implementer because the snapshot already records a blocked milestone that needs bounded repair or escalation.`,
      trigger: 'run-blocked',
      severity: 'high',
      worker: snapshot.workers.recovery,
      milestoneId: activeMilestone?.id ?? null,
      evidence,
      scope: createRecoveryScope({
        activeMilestone,
        note: activeMilestone
          ? `Escalate only milestone ${activeMilestone.id}; do not widen recovery beyond the blocked milestone.`
          : 'Escalate the blocked run state without widening to new milestones.',
      }),
    });
  } else if (snapshot.status === 'planned') {
    overallStatus = 'idle';
    statusSummary = `Milestone ${activeMilestoneLabel} is ready but implementer execution has not started.`;
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'rehand-off',
      summary: `Hand milestone ${activeMilestone?.id ?? 'unknown'} back to the implementer to start bounded work.`,
      reason: `Run status is planned for ${activeMilestoneLabel}, and no implementer heartbeat has been recorded yet, so rehand-off was selected to start bounded execution for the active milestone.`,
      trigger: 'planned-no-activity',
      severity: 'medium',
      worker: implementerWorker,
      milestoneId: activeMilestone?.id ?? null,
      evidence,
      scope: createRecoveryScope({
        activeMilestone,
        note: activeMilestone
          ? `Start only milestone ${activeMilestone.id}; do not advance recovery to later milestones.`
          : 'Re-hand off the run without inventing a new milestone scope.',
      }),
    });
  } else if (
    (snapshot.status === 'implementing' || snapshot.status === 'verifying')
    && Number.isFinite(idleMs)
    && idleMs > stallThresholdMs
  ) {
    overallStatus = 'stalled';
    statusSummary = activeMilestone
      ? `Milestone ${activeMilestoneLabel} is stalled: ${idleMinutes ?? 'unknown'} idle minute(s) exceeds the ${stallThresholdMinutes} minute threshold.`
      : `Run progress is stalled: ${idleMinutes ?? 'unknown'} idle minute(s) exceeds the ${stallThresholdMinutes} minute threshold.`;
    recoveryRecommendation = createRecoveryRecommendation({
      action: 'restart-implementer',
      summary: `Restart the implementer for active milestone ${activeMilestone?.id ?? 'unknown'}.`,
      reason: `Run status is ${snapshot.status} for ${activeMilestoneLabel}; the latest progress signal came from the ${progressSignal.sourceLabel} at ${progressSignal.at ?? 'an unknown time'}; checked at ${checkedAt}; idle ${idleMinutes ?? 'unknown'} minute(s), which exceeds the ${stallThresholdMinutes} minute threshold, so restart-implementer was selected to resume the same milestone without widening scope.`,
      trigger: 'implementer-stalled',
      severity: 'high',
      worker: snapshot.workers.recovery,
      milestoneId: activeMilestone?.id ?? null,
      evidence,
      scope: createRecoveryScope({
        activeMilestone,
        note: activeMilestone
          ? `Restart only milestone ${activeMilestone.id}; resume from the same bounded contract instead of selecting later milestones.`
          : 'Restart bounded work without expanding beyond the current run snapshot.',
      }),
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
    statusSummary,
    activeMilestoneId: activeMilestone?.id ?? null,
    implementerHeartbeatAt,
    milestoneUpdatedAt,
    lastProgressAt: progressSignal.at,
    lastProgressSource: progressSignal.source,
    idleMinutes,
    recoveryRecommendation,
  };
}

export function writeHealthReport(outputPath: string, report: HealthReport): string {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
