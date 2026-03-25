import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.completed ? 'completed' : 'planned',
      lineNumber: milestone.lineNumber,
    })),
    verification: [],
    events: [
      {
        type: 'run.initialized',
        at: now,
        detail: {
          currentMilestoneId: current?.id ?? null,
          milestoneCount: milestones.length,
        },
      },
    ],
  };
}

export function writeRunState(outputPath, runState) {
  const absolutePath = path.resolve(outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, JSON.stringify(runState, null, 2) + '\n', 'utf8');
  return absolutePath;
}
