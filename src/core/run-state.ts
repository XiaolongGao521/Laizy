import { createDefaultBackendConfiguration } from './backend-preflight.js';

import type { BackendConfiguration, MilestonePlanEntry, PlanState, RunSnapshot, WorkerRole } from './types.js';

function derivePlanState(milestones: MilestonePlanEntry[]): PlanState {
  const milestoneCount = milestones.length;
  const completedMilestoneCount = milestones.filter((milestone) => milestone.completed).length;
  const pendingMilestoneCount = milestoneCount - completedMilestoneCount;

  if (milestoneCount === 0) {
    return {
      status: 'needs-plan',
      reason: 'The implementation plan does not contain any actionable milestones yet.',
      milestoneCount,
      completedMilestoneCount,
      pendingMilestoneCount,
    };
  }

  if (pendingMilestoneCount === 0) {
    return {
      status: 'completed',
      reason: 'All implementation plan milestones are already completed.',
      milestoneCount,
      completedMilestoneCount,
      pendingMilestoneCount,
    };
  }

  return {
    status: 'actionable',
    reason: 'The implementation plan contains at least one incomplete milestone.',
    milestoneCount,
    completedMilestoneCount,
    pendingMilestoneCount,
  };
}

export function createRunState({
  runId,
  goal,
  repoPath,
  planPath,
  milestones,
  workerLabels = {},
  backends,
}: {
  runId: string;
  goal: string;
  repoPath: string;
  planPath: string;
  milestones: MilestonePlanEntry[];
  workerLabels?: Partial<Record<WorkerRole, RunSnapshot['workers'][WorkerRole]>>;
  backends?: BackendConfiguration;
}): RunSnapshot {
  const now = new Date().toISOString();
  const current = milestones.find((milestone) => !milestone.completed) ?? null;
  const planState = derivePlanState(milestones);

  return {
    schemaVersion: 1,
    runId,
    goal,
    repoPath,
    planPath,
    status: planState.status === 'completed' ? 'completed' : 'planned',
    planState,
    backends: backends ?? createDefaultBackendConfiguration(),
    createdAt: now,
    updatedAt: now,
    currentMilestoneId: current?.id ?? null,
    workers: {
      planner: workerLabels.planner ?? 'laizy-planner',
      implementer: workerLabels.implementer ?? 'laizy-implementer',
      watchdog: workerLabels.watchdog ?? 'laizy-watchdog',
      recovery: workerLabels.recovery ?? 'laizy-recovery',
      verifier: workerLabels.verifier ?? 'laizy-verifier',
    },
    workerHeartbeats: {
      'laizy-planner': null,
      'laizy-implementer': null,
      'laizy-watchdog': null,
      'laizy-recovery': null,
      'laizy-verifier': null,
      ...(workerLabels.planner && workerLabels.planner !== 'laizy-planner' ? { [workerLabels.planner]: null } : {}),
      ...(workerLabels.implementer && workerLabels.implementer !== 'laizy-implementer' ? { [workerLabels.implementer]: null } : {}),
      ...(workerLabels.watchdog && workerLabels.watchdog !== 'laizy-watchdog' ? { [workerLabels.watchdog]: null } : {}),
      ...(workerLabels.recovery && workerLabels.recovery !== 'laizy-recovery' ? { [workerLabels.recovery]: null } : {}),
      ...(workerLabels.verifier && workerLabels.verifier !== 'laizy-verifier' ? { [workerLabels.verifier]: null } : {}),
    } as RunSnapshot['workerHeartbeats'],
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.completed ? 'completed' : 'planned',
      lineNumber: milestone.lineNumber,
      details: [...(milestone.details ?? [])],
      updatedAt: now,
      lastNote: null,
    })),
    recovery: [],
    verification: [],
    managedRunners: {
      launches: [],
      results: [],
    },
  };
}
