#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

import {
  createImplementerContract,
  createPlannerIntent,
  selectNextActionableMilestone,
  writeContractDocument,
} from './core/contracts.mjs';
import {
  initializeRunArtifacts,
  rebuildSnapshot,
  recordWorkerHeartbeat,
  transitionMilestone,
} from './core/events.mjs';
import {
  evaluateRunHealth,
  writeHealthReport,
} from './core/health.mjs';
import {
  getNextIncompleteMilestone,
  loadImplementationPlan,
  summarizePlan,
} from './core/plan.mjs';
import { createRunState } from './core/run-state.mjs';

function printHelp() {
  console.log(`Laizy CLI

Usage:
  node src/index.mjs next --plan <path>
  node src/index.mjs summary --plan <path>
  node src/index.mjs init-run --goal <text> --plan <path> --out <snapshot-path> [--run-id <id>]
  node src/index.mjs transition --snapshot <snapshot-path> --milestone <id> --status <status> [--note <text>]
  node src/index.mjs snapshot --snapshot <snapshot-path>
  node src/index.mjs select-milestone --snapshot <snapshot-path>
  node src/index.mjs emit-implementer-contract --snapshot <snapshot-path> [--out <contract-path>]
  node src/index.mjs emit-planner-intent --snapshot <snapshot-path> [--out <intent-path>]
  node src/index.mjs heartbeat --snapshot <snapshot-path> --worker <worker-name> [--note <text>]
  node src/index.mjs inspect-health --snapshot <snapshot-path> [--stall-threshold-minutes <n>] [--now <iso>] [--out <report-path>]
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const nextToken = rest[index + 1];
    if (!nextToken || nextToken.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = nextToken;
    index += 1;
  }

  return { command, options };
}

function requireOption(options, key) {
  const value = options[key];
  if (!value || value === true) {
    throw new Error(`Missing required option --${key}`);
  }
  return String(value);
}

function defaultRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-').toLowerCase()}`;
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || options.help) {
    printHelp();
    return;
  }

  if (command === 'next') {
    const planPath = requireOption(options, 'plan');
    const { milestones } = loadImplementationPlan(planPath);
    const nextMilestone = getNextIncompleteMilestone(milestones);

    if (!nextMilestone) {
      console.log('No incomplete milestones remain.');
      return;
    }

    console.log(JSON.stringify(nextMilestone, null, 2));
    return;
  }

  if (command === 'summary') {
    const planPath = requireOption(options, 'plan');
    const { milestones } = loadImplementationPlan(planPath);
    console.log(JSON.stringify(summarizePlan(milestones), null, 2));
    return;
  }

  if (command === 'init-run') {
    const planPath = requireOption(options, 'plan');
    const goal = requireOption(options, 'goal');
    const snapshotPath = requireOption(options, 'out');
    const runId = typeof options['run-id'] === 'string' ? options['run-id'] : defaultRunId();

    const { milestones, path: resolvedPlanPath } = loadImplementationPlan(planPath);
    const runState = createRunState({
      runId,
      goal,
      repoPath: process.cwd(),
      planPath: resolvedPlanPath,
      milestones,
    });

    const initialized = initializeRunArtifacts(snapshotPath, runState);
    console.log(
      JSON.stringify(
        {
          runId,
          snapshotPath: initialized.snapshotPath,
          eventLogPath: initialized.eventLogPath,
          currentMilestoneId: initialized.snapshot.currentMilestoneId,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'transition') {
    const snapshotPath = requireOption(options, 'snapshot');
    const milestoneId = requireOption(options, 'milestone');
    const status = requireOption(options, 'status');
    const note = typeof options.note === 'string' ? options.note : undefined;

    const updated = transitionMilestone(snapshotPath, {
      milestoneId,
      status,
      note,
    });

    console.log(
      JSON.stringify(
        {
          snapshotPath: updated.snapshotPath,
          eventLogPath: updated.eventLogPath,
          event: updated.event,
          currentMilestoneId: updated.snapshot.currentMilestoneId,
          runStatus: updated.snapshot.status,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'snapshot') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    console.log(
      JSON.stringify(
        {
          snapshotPath: rebuilt.snapshotPath,
          eventLogPath: rebuilt.eventLogPath,
          eventCount: rebuilt.snapshot.eventCount,
          currentMilestoneId: rebuilt.snapshot.currentMilestoneId,
          runStatus: rebuilt.snapshot.status,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'select-milestone') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const milestone = selectNextActionableMilestone(rebuilt.snapshot);
    console.log(JSON.stringify(milestone, null, 2));
    return;
  }

  if (command === 'emit-implementer-contract') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const contract = createImplementerContract(rebuilt.snapshot);

    if (typeof options.out === 'string') {
      const outputPath = writeContractDocument(options.out, contract);
      console.log(JSON.stringify({ outputPath, milestoneId: contract.milestone?.id ?? null }, null, 2));
      return;
    }

    console.log(JSON.stringify(contract, null, 2));
    return;
  }

  if (command === 'emit-planner-intent') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const intent = createPlannerIntent(rebuilt.snapshot);

    if (typeof options.out === 'string') {
      const outputPath = writeContractDocument(options.out, intent);
      console.log(JSON.stringify({ outputPath, milestoneId: intent.selectedMilestone?.id ?? null }, null, 2));
      return;
    }

    console.log(JSON.stringify(intent, null, 2));
    return;
  }

  if (command === 'heartbeat') {
    const snapshotPath = requireOption(options, 'snapshot');
    const worker = requireOption(options, 'worker');
    const note = typeof options.note === 'string' ? options.note : undefined;
    const updated = recordWorkerHeartbeat(snapshotPath, { worker, note, metadata: {} });
    console.log(
      JSON.stringify(
        {
          snapshotPath: updated.snapshotPath,
          eventLogPath: updated.eventLogPath,
          event: updated.event,
          heartbeat: updated.snapshot.workerHeartbeats[worker] ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'inspect-health') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const report = evaluateRunHealth(rebuilt.snapshot, {
      now: typeof options.now === 'string' ? options.now : undefined,
      stallThresholdMinutes:
        typeof options['stall-threshold-minutes'] === 'string'
          ? Number(options['stall-threshold-minutes'])
          : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeHealthReport(options.out, report);
      console.log(JSON.stringify({ outputPath, overallStatus: report.overallStatus }, null, 2));
      return;
    }

    console.log(JSON.stringify(report, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
