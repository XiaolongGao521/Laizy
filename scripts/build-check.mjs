import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  eventLogPathForSnapshot,
  initializeRunArtifacts,
  loadRunEvents,
  transitionMilestone,
} from '../src/core/events.mjs';
import { loadImplementationPlan, summarizePlan } from '../src/core/plan.mjs';
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

const plan = loadImplementationPlan('IMPLEMENTATION_PLAN.md');
const summary = summarizePlan(plan.milestones);
assert(summary.total >= 3, 'expected at least three milestones in IMPLEMENTATION_PLAN.md');
assert(summary.next?.id === 'L3', 'expected next incomplete milestone to be L3 after event-log milestone');

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
assert(initialized.snapshot.currentMilestoneId === 'L3', 'expected initialized run to point at L3');
assert(initialized.snapshot.status === 'planned', 'expected initialized run status to be planned');
assert(initialized.snapshot.eventCount === 1, 'expected one initialization event');

transitionMilestone(snapshotPath, {
  milestoneId: 'L3',
  status: 'implementing',
  note: 'worker picked up milestone',
});
transitionMilestone(snapshotPath, {
  milestoneId: 'L3',
  status: 'verifying',
  note: 'verification started',
});
const completed = transitionMilestone(snapshotPath, {
  milestoneId: 'L3',
  status: 'completed',
  note: 'verification passed',
});

assert(completed.snapshot.currentMilestoneId === 'L4', 'expected completed milestone to advance current pointer to L4');
assert(completed.snapshot.status === 'planned', 'expected run to return to planned after a milestone completes');
assert(completed.snapshot.eventCount === 4, 'expected three transitions plus initialization in event log');

const persisted = JSON.parse(readFileSync(snapshotPath, 'utf8'));
assert(persisted.currentMilestoneId === 'L4', 'expected persisted snapshot to point at L4');
assert(persisted.milestones.find((milestone) => milestone.id === 'L3')?.status === 'completed', 'expected persisted L3 milestone status to be completed');

const events = loadRunEvents(eventLogPathForSnapshot(snapshotPath));
assert(events.length === 4, 'expected event log to contain four events');

rmSync(tempDir, { recursive: true, force: true });
console.log('build-check: ok');
