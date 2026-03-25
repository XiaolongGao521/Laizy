export function createRunState({ runId, goal, repoPath, planPath, milestones, workerLabels = {} }) {
  const now = new Date().toISOString();
  const current = milestones.find((milestone) => !milestone.completed) ?? null;

  return {
    schemaVersion: 1,
    runId,
    goal,
    repoPath,
    planPath,
    status: current ? 'planned' : 'completed',
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
      [workerLabels.planner ?? 'laizy-planner']: null,
      [workerLabels.implementer ?? 'laizy-implementer']: null,
      [workerLabels.watchdog ?? 'laizy-watchdog']: null,
      [workerLabels.recovery ?? 'laizy-recovery']: null,
      [workerLabels.verifier ?? 'laizy-verifier']: null,
    },
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
  };
}
