import { readFileSync } from 'node:fs';
import path from 'node:path';

const MILESTONE_PATTERN = /^### \[( |x)\] ([^—-]+?)\s*[—-]\s*(.+)$/;

export function parseImplementationPlan(planText) {
  const milestones = [];
  const lines = planText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    const match = line.match(MILESTONE_PATTERN);

    if (!match) {
      continue;
    }

    const [, state, id, title] = match;
    milestones.push({
      id: id.trim(),
      title: title.trim(),
      completed: state === 'x',
      lineNumber: index + 1,
    });
  }

  return milestones;
}

export function loadImplementationPlan(planPath) {
  const absolutePlanPath = path.resolve(planPath);
  const planText = readFileSync(absolutePlanPath, 'utf8');
  const milestones = parseImplementationPlan(planText);

  return {
    path: absolutePlanPath,
    milestones,
    raw: planText,
  };
}

export function getNextIncompleteMilestone(milestones) {
  return milestones.find((milestone) => !milestone.completed) ?? null;
}

export function summarizePlan(milestones) {
  const completed = milestones.filter((milestone) => milestone.completed).length;
  const pending = milestones.length - completed;

  return {
    total: milestones.length,
    completed,
    pending,
    next: getNextIncompleteMilestone(milestones),
  };
}
