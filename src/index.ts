#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  createImplementerContract,
  createPlannerIntent,
  selectNextActionableMilestone,
  writeContractDocument,
} from './core/contracts.js';
import {
  initializeRunArtifacts,
  rebuildSnapshot,
  recordRecoveryAction,
  recordVerificationResult,
  recordWorkerHeartbeat,
  transitionMilestone,
} from './core/events.js';
import {
  evaluateRunHealth,
  writeHealthReport,
} from './core/health.js';
import {
  getNextIncompleteMilestone,
  loadImplementationPlan,
  summarizePlan,
} from './core/plan.js';
import {
  createRecoveryPlan,
  writeRecoveryPlan,
} from './core/recovery.js';
import {
  createCronAdapter,
  createSessionHistoryAdapter,
  createSessionSendAdapter,
  createSessionSpawnAdapter,
  writeOpenClawAdapter,
} from './core/openclaw.js';
import { createRunState } from './core/run-state.js';
import {
  createReviewerOutput,
  createVerificationCommand,
  writeVerificationDocument,
} from './core/verification.js';
import type { MilestoneStatus, VerificationStatus, WorkerLabel, WorkerRole } from './core/types.js';

function printHelp() {
  console.log(`Laizy CLI

Usage:
  node dist/src/index.js next --plan <path>
  node dist/src/index.js summary --plan <path>
  node dist/src/index.js init-run --goal <text> --plan <path> --out <snapshot-path> [--run-id <id>]
  node dist/src/index.js transition --snapshot <snapshot-path> --milestone <id> --status <status> [--note <text>]
  node dist/src/index.js snapshot --snapshot <snapshot-path>
  node dist/src/index.js select-milestone --snapshot <snapshot-path>
  node dist/src/index.js emit-implementer-contract --snapshot <snapshot-path> [--out <contract-path>]
  node dist/src/index.js emit-planner-intent --snapshot <snapshot-path> [--out <intent-path>]
  node dist/src/index.js heartbeat --snapshot <snapshot-path> --worker <worker-name> [--note <text>]
  node dist/src/index.js inspect-health --snapshot <snapshot-path> [--stall-threshold-minutes <n>] [--now <iso>] [--out <report-path>]
  node dist/src/index.js plan-recovery --snapshot <snapshot-path> [--stall-threshold-minutes <n>] [--now <iso>] [--out <plan-path>]
  node dist/src/index.js record-recovery-action --snapshot <snapshot-path> --action <action> --reason <text> --worker <worker-name> [--milestone <id>] [--note <text>] [--source <value>]
  node dist/src/index.js emit-openclaw-spawn --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--milestone <id>] [--runtime <value>] [--out <path>]
  node dist/src/index.js emit-openclaw-send --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] --message <text> [--mode <append|replace>] [--out <path>]
  node dist/src/index.js emit-openclaw-history --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--limit <n>] [--since <iso>] [--include-tool-calls] [--out <path>]
  node dist/src/index.js emit-openclaw-cron --snapshot <snapshot-path> [--worker <watchdog|planner|recovery>] [--schedule <cron>] [--prompt <text>] [--job-label <label>] [--out <path>]
  node dist/src/index.js emit-verification-command --snapshot <snapshot-path> [--milestone <id>] [--command <text>] [--stage <value>] [--out <path>]
  node dist/src/index.js emit-reviewer-output --snapshot <snapshot-path> [--milestone <id>] [--verdict <approved|changes-requested|needs-review>] [--summary <text>] [--next-action <value>] [--finding <text> ...] [--out <path>]
  node dist/src/index.js record-verification-result --snapshot <snapshot-path> --milestone <id> --command <text> --status <pending|passed|failed> [--output-path <path>] [--summary <text>] [--reviewer-output <path>]
`);
}

type CliOptions = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string | undefined; options: CliOptions } {
  const [command, ...rest] = argv;
  const options: CliOptions = {};

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

function requireOption(options: CliOptions, key: string): string {
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
    const status = requireOption(options, 'status') as MilestoneStatus;
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
    const worker = requireOption(options, 'worker') as WorkerLabel;
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

  if (command === 'plan-recovery') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const report = evaluateRunHealth(rebuilt.snapshot, {
      now: typeof options.now === 'string' ? options.now : undefined,
      stallThresholdMinutes:
        typeof options['stall-threshold-minutes'] === 'string'
          ? Number(options['stall-threshold-minutes'])
          : undefined,
    });
    const recoveryPlan = createRecoveryPlan(rebuilt.snapshot, report);

    if (typeof options.out === 'string') {
      const outputPath = writeRecoveryPlan(options.out, recoveryPlan);
      console.log(JSON.stringify({ outputPath, action: recoveryPlan.action }, null, 2));
      return;
    }

    console.log(JSON.stringify(recoveryPlan, null, 2));
    return;
  }

  if (command === 'record-recovery-action') {
    const snapshotPath = requireOption(options, 'snapshot');
    const action = requireOption(options, 'action');
    const reason = requireOption(options, 'reason');
    const worker = requireOption(options, 'worker') as WorkerLabel;
    const milestoneId = typeof options.milestone === 'string' ? options.milestone : undefined;
    const note = typeof options.note === 'string' ? options.note : undefined;
    const source = typeof options.source === 'string' ? options.source : undefined;
    const updated = recordRecoveryAction(snapshotPath, {
      action,
      reason,
      worker,
      milestoneId,
      note,
      source,
    });

    console.log(
      JSON.stringify(
        {
          snapshotPath: updated.snapshotPath,
          eventLogPath: updated.eventLogPath,
          event: updated.event,
          recoveryCount: updated.snapshot.recovery.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'emit-openclaw-spawn') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createSessionSpawnAdapter(rebuilt.snapshot, {
      worker: typeof options.worker === 'string' ? options.worker as WorkerRole : undefined,
      milestoneId: typeof options.milestone === 'string' ? options.milestone : undefined,
      runtime: typeof options.runtime === 'string' ? options.runtime : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeOpenClawAdapter(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, worker: document.worker.label }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-openclaw-send') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createSessionSendAdapter(rebuilt.snapshot, {
      worker: typeof options.worker === 'string' ? options.worker as WorkerRole : undefined,
      message: requireOption(options, 'message'),
      mode: typeof options.mode === 'string' ? options.mode : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeOpenClawAdapter(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, worker: document.worker.label }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-openclaw-history') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createSessionHistoryAdapter(rebuilt.snapshot, {
      worker: typeof options.worker === 'string' ? options.worker as WorkerRole : undefined,
      limit: typeof options.limit === 'string' ? Number(options.limit) : undefined,
      since: typeof options.since === 'string' ? options.since : undefined,
      includeToolCalls: Boolean(options['include-tool-calls']),
    });

    if (typeof options.out === 'string') {
      const outputPath = writeOpenClawAdapter(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, worker: document.worker.label }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-openclaw-cron') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createCronAdapter(rebuilt.snapshot, {
      worker: typeof options.worker === 'string' ? options.worker as 'watchdog' | 'planner' | 'recovery' : undefined,
      schedule: typeof options.schedule === 'string' ? options.schedule : undefined,
      prompt: typeof options.prompt === 'string' ? options.prompt : undefined,
      jobLabel: typeof options['job-label'] === 'string' ? options['job-label'] : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeOpenClawAdapter(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, worker: document.worker.label }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-verification-command') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createVerificationCommand(rebuilt.snapshot, {
      milestoneId: typeof options.milestone === 'string' ? options.milestone : undefined,
      command: typeof options.command === 'string' ? options.command : undefined,
      stage: typeof options.stage === 'string' ? options.stage : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeVerificationDocument(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, milestoneId: document.milestone.id }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-reviewer-output') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createReviewerOutput(rebuilt.snapshot, {
      milestoneId: typeof options.milestone === 'string' ? options.milestone : undefined,
      verdict: typeof options.verdict === 'string' ? options.verdict : undefined,
      summary: typeof options.summary === 'string' ? options.summary : undefined,
      nextAction: typeof options['next-action'] === 'string' ? options['next-action'] : undefined,
      findings: typeof options.finding === 'string' ? [options.finding] : [],
    });

    if (typeof options.out === 'string') {
      const outputPath = writeVerificationDocument(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, milestoneId: document.milestone.id }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'record-verification-result') {
    const snapshotPath = requireOption(options, 'snapshot');
    const milestoneId = requireOption(options, 'milestone');
    const commandText = requireOption(options, 'command');
    const status = requireOption(options, 'status') as VerificationStatus;
    let reviewerOutput = null;

    if (typeof options['reviewer-output'] === 'string') {
      const reviewerOutputPath = path.resolve(options['reviewer-output']);
      reviewerOutput = JSON.parse(readFileSync(reviewerOutputPath, 'utf8'));
    }

    const updated = recordVerificationResult(snapshotPath, {
      milestoneId,
      command: commandText,
      status,
      outputPath: typeof options['output-path'] === 'string' ? options['output-path'] : undefined,
      summary: typeof options.summary === 'string' ? options.summary : undefined,
      reviewerOutput,
    });

    console.log(JSON.stringify({
      snapshotPath: updated.snapshotPath,
      eventLogPath: updated.eventLogPath,
      event: updated.event,
      verificationCount: updated.snapshot.verification.length,
    }, null, 2));
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
