import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadImplementationPlan, summarizePlan } from '../src/core/plan.mjs';
import { createRunState, writeRunState } from '../src/core/run-state.mjs';

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

const plan = loadImplementationPlan('IMPLEMENTATION_PLAN.md');
const summary = summarizePlan(plan.milestones);
assert(summary.total >= 2, 'expected at least two milestones in IMPLEMENTATION_PLAN.md');
assert(summary.next?.id === 'L2', 'expected next incomplete milestone to be L2 after bootstrap');

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'laizy-build-'));
const outputPath = path.join(tempDir, 'run.json');

const runState = createRunState({
  runId: 'build-check',
  goal: 'Verify bootstrap run-state wiring',
  repoPath: process.cwd(),
  planPath: plan.path,
  milestones: plan.milestones,
});

writeRunState(outputPath, runState);
const persisted = JSON.parse(readFileSync(outputPath, 'utf8'));
assert(persisted.currentMilestoneId === 'L2', 'expected initialized run to point at L2');
assert(persisted.status === 'planned', 'expected initialized run status to be planned');

rmSync(tempDir, { recursive: true, force: true });
console.log('build-check: ok');
