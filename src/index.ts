#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  createImplementerContract,
  createPlannerIntent,
  createPlannerRequest,
  selectNextActionableMilestone,
  writeContractDocument,
} from './core/contracts.js';
import {
  initializeRunArtifacts,
  rebuildSnapshot,
  recordManagedRunnerLaunch,
  recordManagedRunnerResult,
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
import {
  createClaudeCodeExecAdapter,
  createCodexCliExecAdapter,
  createLaizyWatchdogAdapter,
  writeBackendAdapter,
} from './core/backends.js';
import { writeManagedRunnerLaunchBundle } from './core/managed-runner.js';
import {
  assertHealthyBackendCheck,
  createBackendCheckResult,
  createDefaultBackendConfiguration,
  mergeBackendConfiguration,
  writeBackendCheckResult,
} from './core/backend-preflight.js';
import { createRunState } from './core/run-state.js';
import { selectSupervisorRuntimeProfile } from './core/runtime-profile.js';
import {
  createReviewerOutput,
  createVerificationCommand,
  writeVerificationDocument,
} from './core/verification.js';
import { writeSupervisorBundle } from './core/supervisor.js';
import type { MilestoneStatus, VerificationStatus, WorkerLabel, WorkerRole } from './core/types.js';

const ALL_WORKER_ROLES: WorkerRole[] = ['planner', 'implementer', 'recovery', 'verifier', 'watchdog'];

function printHelp() {
  console.log(`Laizy CLI — repo-native control loop for milestone-based coding work

Recommended operator flow:
  1. Start from a local implementation plan.
  2. Bootstrap the run with start-run.
  3. Ask supervisor-tick for the next bounded action.
  4. Execute one milestone, then record verification before completion.

Usage:
  node dist/src/index.js next --plan <path>
  node dist/src/index.js summary --plan <path>
  node dist/src/index.js init-run --goal <text> --plan <path> --out <snapshot-path> [--run-id <id>] [--backend-config <json-or-path>]
  node dist/src/index.js start-run --goal <text> --plan <path> --out <snapshot-path> [--run-id <id>] [--bundle-dir <dir>] [--runtime <value>] [--schedule <cron>] [--prompt <text>] [--backend-config <json-or-path>]
  node dist/src/index.js watchdog --snapshot <snapshot-path> [--out-dir <dir>] [--interval-seconds <n>] [--stall-threshold-minutes <n>] [--verification-command <text>] [--backend-config <json-or-path>] [--once]
  node dist/src/index.js transition --snapshot <snapshot-path> --milestone <id> --status <status> [--note <text>]
  node dist/src/index.js snapshot --snapshot <snapshot-path>
  node dist/src/index.js select-milestone --snapshot <snapshot-path>
  node dist/src/index.js emit-implementer-contract --snapshot <snapshot-path> [--out <contract-path>]
  node dist/src/index.js emit-planner-intent --snapshot <snapshot-path> [--out <intent-path>]
  node dist/src/index.js emit-planner-request --snapshot <snapshot-path> [--out <request-path>]
  node dist/src/index.js heartbeat --snapshot <snapshot-path> --worker <worker-name> [--note <text>]
  node dist/src/index.js inspect-health --snapshot <snapshot-path> [--stall-threshold-minutes <n>] [--now <iso>] [--out <report-path>]
  node dist/src/index.js plan-recovery --snapshot <snapshot-path> [--stall-threshold-minutes <n>] [--now <iso>] [--out <plan-path>]
  node dist/src/index.js supervisor-tick --snapshot <snapshot-path> [--out-dir <dir>] [--stall-threshold-minutes <n>] [--verification-command <text>] [--backend-config <json-or-path>]
  node dist/src/index.js check-backends --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--out <path>] [--out-dir <dir>] [--backend-config <json-or-path>]
  node dist/src/index.js record-recovery-action --snapshot <snapshot-path> --action <action> --reason <text> --worker <worker-name> [--milestone <id>] [--note <text>] [--source <value>]
  node dist/src/index.js emit-openclaw-spawn --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--milestone <id>] [--runtime <value>] [--out <path>]
  node dist/src/index.js emit-openclaw-send --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] --message <text> [--mode <append|replace>] [--out <path>]
  node dist/src/index.js emit-openclaw-history --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--limit <n>] [--since <iso>] [--include-tool-calls] [--out <path>]
  node dist/src/index.js emit-openclaw-cron --snapshot <snapshot-path> [--worker <watchdog|planner|recovery>] [--schedule <cron>] [--prompt <text>] [--job-label <label>] [--out <path>]
  node dist/src/index.js emit-codex-cli-exec --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--milestone <id>] [--out <path>]
  node dist/src/index.js emit-claude-code-exec --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--milestone <id>] [--out <path>]
  node dist/src/index.js emit-managed-runner-launch --snapshot <snapshot-path> [--worker <implementer|recovery|planner|verifier>] [--provider <codex|claude-code|openclaw>] [--milestone <id>] [--runtime <value>] [--verification-command <text>] [--out-dir <dir>]
  node dist/src/index.js record-managed-runner-launch --snapshot <snapshot-path> --launch-artifact <path> [--status <launching|running|finished>] [--tracking-kind <pid|exec-session|session-key>] [--tracking-id <id>] [--stdout-path <path>] [--stderr-path <path>] [--summary <text>]
  node dist/src/index.js record-managed-runner-result --snapshot <snapshot-path> --launch-artifact <path> --outcome <succeeded|failed|timed_out|cancelled|launch_failed|unknown> [--result-artifact <path>] [--exit-code <n>] [--tracking-kind <pid|exec-session|session-key>] [--tracking-id <id>] [--stdout-path <path>] [--stderr-path <path>] [--summary <text>]
  node dist/src/index.js emit-laizy-watchdog --snapshot <snapshot-path> [--out-dir <dir>] [--interval-seconds <n>] [--stall-threshold-minutes <n>] [--verification-command <text>] [--mode <ensure|disable>] [--out <path>]
  node dist/src/index.js emit-backend-check --snapshot <snapshot-path> [--worker <implementer|recovery|watchdog|planner|verifier>] [--out <path>]
  node dist/src/index.js emit-verification-command --snapshot <snapshot-path> [--milestone <id>] [--command <text>] [--stage <value>] [--out <path>]
  node dist/src/index.js emit-reviewer-output --snapshot <snapshot-path> [--milestone <id>] [--verdict <approved|changes-requested|needs-review>] [--summary <text>] [--next-action <value>] [--finding <text> ...] [--out <path>]
  node dist/src/index.js record-verification-result --snapshot <snapshot-path> --milestone <id> --command <text> --status <pending|passed|failed> [--output-path <path>] [--summary <text>] [--reviewer-output <path>]

Notes:
  - Keep command names stable; use start-run once, then supervisor-tick as the source of truth.
  - Read emitted managed-runner launch requests and supervisor bundles instead of improvising the next step from chat memory.
  - Complete milestones only after verification is recorded.
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

function parseOptionalTrackingHandle(options: CliOptions) {
  if (typeof options['tracking-kind'] !== 'string' || typeof options['tracking-id'] !== 'string') {
    return null;
  }

  return {
    kind: options['tracking-kind'] as 'pid' | 'exec-session' | 'session-key',
    id: options['tracking-id'],
  };
}

function parseJsonOption(value: string): unknown {
  const trimmed = value.trim();
  const source = trimmed.startsWith('{') ? trimmed : readFileSync(path.resolve(trimmed), 'utf8');
  return JSON.parse(source);
}

function resolveBackendConfigurationOption(options: CliOptions, currentBackends = createDefaultBackendConfiguration()) {
  if (typeof options['backend-config'] !== 'string') {
    return currentBackends;
  }

  return mergeBackendConfiguration(currentBackends, parseJsonOption(options['backend-config']) as never);
}

function applyBackendConfigurationOption<T extends { backends: ReturnType<typeof createDefaultBackendConfiguration> }>(
  snapshot: T,
  options: CliOptions,
): T {
  return {
    ...snapshot,
    backends: resolveBackendConfigurationOption(options, snapshot.backends),
  };
}

function writeCheckedBackendDocument(
  snapshot: Parameters<typeof createBackendCheckResult>[0],
  role: WorkerRole,
  outputPath: string,
  context: string,
) {
  const document = createBackendCheckResult(snapshot, role, { outputPath });
  const writtenOutputPath = writeBackendCheckResult(outputPath, document);
  return assertHealthyBackendCheck({
    ...document,
    outputPath: writtenOutputPath,
  }, { context });
}

function defaultRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-').toLowerCase()}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultBootstrapDir(snapshotPath: string): string {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  return resolvedSnapshotPath.endsWith('.json')
    ? resolvedSnapshotPath.replace(/\.json$/u, '.bootstrap')
    : `${resolvedSnapshotPath}.bootstrap`;
}

function writeJsonDocument(outputPath: string, document: object): string {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}

async function main() {
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

  if (command === 'init-run' || command === 'start-run') {
    const planPath = requireOption(options, 'plan');
    const goal = requireOption(options, 'goal');
    const snapshotPath = requireOption(options, 'out');
    const runId = typeof options['run-id'] === 'string' ? options['run-id'] : defaultRunId();

    const { milestones, path: resolvedPlanPath } = loadImplementationPlan(planPath);
    const backends = resolveBackendConfigurationOption(options);
    const runState = createRunState({
      runId,
      goal,
      repoPath: process.cwd(),
      planPath: resolvedPlanPath,
      milestones,
      backends,
    });

    const initialized = initializeRunArtifacts(snapshotPath, runState);

    if (command === 'init-run') {
      console.log(
        JSON.stringify(
          {
            runId,
            snapshotPath: initialized.snapshotPath,
            eventLogPath: initialized.eventLogPath,
            currentMilestoneId: initialized.snapshot.currentMilestoneId,
          planState: initialized.snapshot.planState,
          },
          null,
          2,
        ),
      );
      return;
    }

    const rebuilt = rebuildSnapshot(initialized.snapshotPath);
    const snapshot = applyBackendConfigurationOption(rebuilt.snapshot, options);
    const bundleDir = typeof options['bundle-dir'] === 'string'
      ? path.resolve(options['bundle-dir'])
      : defaultBootstrapDir(initialized.snapshotPath);
    const plannerIntent = createPlannerIntent(snapshot);
    const plannerIntentPath = writeContractDocument(path.join(bundleDir, 'planner-intent.json'), plannerIntent);
    const watchdogBackendCheck = writeCheckedBackendDocument(
      snapshot,
      'watchdog',
      path.join(bundleDir, 'watchdog.backend-check.json'),
      'start-run cannot emit watchdog adapters',
    );
    const watchdogCron = createCronAdapter(snapshot, {
      worker: 'watchdog',
      schedule: typeof options.schedule === 'string' ? options.schedule : undefined,
      prompt: typeof options.prompt === 'string' ? options.prompt : undefined,
      backendCheck: watchdogBackendCheck,
    });
    const watchdogCronPath = writeOpenClawAdapter(path.join(bundleDir, 'openclaw-watchdog-cron.json'), watchdogCron);
    const laizyWatchdog = createLaizyWatchdogAdapter(snapshot, {
      outDir: typeof options['supervisor-dir'] === 'string'
        ? options['supervisor-dir']
        : path.join(path.dirname(rebuilt.snapshotPath), `${path.basename(rebuilt.snapshotPath, '.json')}.supervisor`),
      intervalSeconds: typeof options['interval-seconds'] === 'string' ? Number(options['interval-seconds']) : undefined,
      stallThresholdMinutes: typeof options['stall-threshold-minutes'] === 'string' ? Number(options['stall-threshold-minutes']) : undefined,
      verificationCommand: typeof options['verification-command'] === 'string' ? options['verification-command'] : undefined,
      mode: 'ensure',
      backendCheck: watchdogBackendCheck,
    });
    const laizyWatchdogPath = writeBackendAdapter(path.join(bundleDir, 'laizy-watchdog.json'), laizyWatchdog);
    const documents: Record<string, string> = {
      plannerIntent: plannerIntentPath,
      watchdogCron: watchdogCronPath,
      laizyWatchdog: laizyWatchdogPath,
      watchdogBackendCheck: watchdogBackendCheck.outputPath ?? path.join(bundleDir, 'watchdog.backend-check.json'),
    };

    if (snapshot.planState.status === 'needs-plan') {
      const plannerRuntimeProfile = selectSupervisorRuntimeProfile(snapshot, 'plan');
      const plannerBackendCheck = createBackendCheckResult(snapshot, 'planner', {
        outputPath: path.join(bundleDir, 'planner.backend-check.json'),
      });
      const plannerBackendCheckPath = writeBackendCheckResult(plannerBackendCheck.outputPath ?? path.join(bundleDir, 'planner.backend-check.json'), plannerBackendCheck);
      assertHealthyBackendCheck({ ...plannerBackendCheck, outputPath: plannerBackendCheckPath }, {
        context: 'start-run cannot emit planner adapters',
      });
      const launchBundle = writeManagedRunnerLaunchBundle(bundleDir, snapshot, {
        worker: 'planner',
        runtimeProfile: plannerRuntimeProfile,
        backendCheck: { ...plannerBackendCheck, outputPath: plannerBackendCheckPath },
      });
      documents.plannerManagedRunnerRequest = launchBundle.launchRequestPath;
      documents.plannerManagedRunnerLaunch = launchBundle.launchArtifactPath;
      documents.plannerRequest = launchBundle.contractPath;
      documents.plannerProviderAdapter = launchBundle.providerAdapterPath;
      documents.plannerResultArtifact = launchBundle.resultArtifactPath;
      documents.plannerBackendCheck = plannerBackendCheckPath;
    } else {
      const implementerRuntimeProfile = selectSupervisorRuntimeProfile(snapshot, 'continue');
      const implementerBackendCheck = createBackendCheckResult(snapshot, 'implementer', {
        outputPath: path.join(bundleDir, 'implementer.backend-check.json'),
      });
      const implementerBackendCheckPath = writeBackendCheckResult(
        implementerBackendCheck.outputPath ?? path.join(bundleDir, 'implementer.backend-check.json'),
        implementerBackendCheck,
      );
      const implementerContract = createImplementerContract(snapshot);
      assertHealthyBackendCheck({ ...implementerBackendCheck, outputPath: implementerBackendCheckPath }, {
        context: 'start-run cannot emit implementer adapters',
      });
      const launchBundle = writeManagedRunnerLaunchBundle(bundleDir, snapshot, {
        worker: 'implementer',
        runtime: typeof options.runtime === 'string' ? options.runtime : undefined,
        runtimeProfile: implementerRuntimeProfile,
        backendCheck: { ...implementerBackendCheck, outputPath: implementerBackendCheckPath },
      });
      documents.implementerManagedRunnerRequest = launchBundle.launchRequestPath;
      documents.implementerManagedRunnerLaunch = launchBundle.launchArtifactPath;
      documents.implementerContract = launchBundle.contractPath;
      documents.implementerProviderAdapter = launchBundle.providerAdapterPath;
      documents.implementerResultArtifact = launchBundle.resultArtifactPath;
      documents.implementerBackendCheck = implementerBackendCheckPath;
    }

    const manifestPath = writeJsonDocument(path.join(bundleDir, 'bootstrap-manifest.json'), {
      schemaVersion: 1,
      kind: 'run.bootstrap',
      generatedAt: new Date().toISOString(),
      runId,
      goal,
      repoPath: snapshot.repoPath,
      planPath: snapshot.planPath,
      snapshotPath: rebuilt.snapshotPath,
      eventLogPath: rebuilt.eventLogPath,
      currentMilestoneId: snapshot.currentMilestoneId,
      bundleDir,
      planState: snapshot.planState,
      backends: snapshot.backends,
      documents,
    });

    console.log(
      JSON.stringify(
        {
          runId,
          snapshotPath: rebuilt.snapshotPath,
          eventLogPath: rebuilt.eventLogPath,
          bundleDir,
          manifestPath,
          currentMilestoneId: snapshot.currentMilestoneId,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'watchdog') {
    const snapshotPath = requireOption(options, 'snapshot');
    const intervalSeconds = typeof options['interval-seconds'] === 'string'
      ? Number(options['interval-seconds'])
      : 300;

    if (Number.isNaN(intervalSeconds) || intervalSeconds <= 0) {
      throw new Error('Expected --interval-seconds to be a positive number');
    }

    do {
      const rebuilt = rebuildSnapshot(snapshotPath);
      rebuilt.snapshot.backends = resolveBackendConfigurationOption(options, rebuilt.snapshot.backends);
      const outputDir = typeof options['out-dir'] === 'string'
        ? path.resolve(options['out-dir'])
        : path.join(path.dirname(rebuilt.snapshotPath), `${path.basename(rebuilt.snapshotPath, '.json')}.supervisor`);
      const bundle = writeSupervisorBundle(outputDir, rebuilt.snapshot, {
        stallThresholdMinutes: typeof options['stall-threshold-minutes'] === 'string'
          ? Number(options['stall-threshold-minutes'])
          : undefined,
        verificationCommand: typeof options['verification-command'] === 'string'
          ? options['verification-command']
          : undefined,
      });

      console.log(JSON.stringify({
        decision: bundle.decision.decision,
        reason: bundle.decision.reason,
        manifestPath: bundle.manifestPath,
        decisionPath: bundle.decisionPath,
        actions: bundle.decision.actions,
      }, null, 2));

      if (options.once || bundle.decision.decision === 'closeout') {
        return;
      }

      await sleep(intervalSeconds * 1000);
    } while (true);
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

  if (command === 'emit-planner-request') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const request = createPlannerRequest(rebuilt.snapshot);

    if (typeof options.out === 'string') {
      const outputPath = writeContractDocument(options.out, request);
      console.log(JSON.stringify({ outputPath, requestedMode: request.requestedMode }, null, 2));
      return;
    }

    console.log(JSON.stringify(request, null, 2));
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

  if (command === 'supervisor-tick') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    rebuilt.snapshot.backends = resolveBackendConfigurationOption(options, rebuilt.snapshot.backends);
    const outputDir = typeof options['out-dir'] === 'string'
      ? options['out-dir']
      : path.join(path.dirname(rebuilt.snapshotPath), `${path.basename(rebuilt.snapshotPath, '.json')}.supervisor`);
    const result = writeSupervisorBundle(outputDir, rebuilt.snapshot, {
      stallThresholdMinutes:
        typeof options['stall-threshold-minutes'] === 'string'
          ? Number(options['stall-threshold-minutes'])
          : undefined,
      verificationCommand:
        typeof options['verification-command'] === 'string'
          ? options['verification-command']
          : undefined,
    });

    console.log(JSON.stringify({
      decision: result.decision.decision,
      reason: result.decision.reason,
      decisionPath: result.decisionPath,
      manifestPath: result.manifestPath,
      actions: result.decision.actions,
    }, null, 2));
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
      console.log(JSON.stringify({
        outputPath,
        kind: document.kind,
        worker: document.worker.label,
        backendPreflight: document.payload.backendPreflight,
      }, null, 2));
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
      console.log(JSON.stringify({
        outputPath,
        kind: document.kind,
        worker: document.worker.label,
        backendPreflight: document.payload.backendPreflight,
      }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-codex-cli-exec') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createCodexCliExecAdapter(rebuilt.snapshot, {
      worker: typeof options.worker === 'string' ? options.worker as WorkerRole : undefined,
      milestoneId: typeof options.milestone === 'string' ? options.milestone : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeBackendAdapter(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, worker: document.worker.label }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-claude-code-exec') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createClaudeCodeExecAdapter(rebuilt.snapshot, {
      worker: typeof options.worker === 'string' ? options.worker as WorkerRole : undefined,
      milestoneId: typeof options.milestone === 'string' ? options.milestone : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeBackendAdapter(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, worker: document.worker.label }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'emit-managed-runner-launch') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    rebuilt.snapshot.backends = resolveBackendConfigurationOption(options, rebuilt.snapshot.backends);
    const outputDir = typeof options['out-dir'] === 'string'
      ? options['out-dir']
      : path.join(path.dirname(rebuilt.snapshotPath), `${path.basename(rebuilt.snapshotPath, '.json')}.managed-runners`);
    const launchBundle = writeManagedRunnerLaunchBundle(outputDir, rebuilt.snapshot, {
      worker: typeof options.worker === 'string' ? options.worker as 'implementer' | 'recovery' | 'planner' | 'verifier' : undefined,
      provider: typeof options.provider === 'string' ? options.provider as 'codex' | 'claude-code' | 'openclaw' : undefined,
      milestoneId: typeof options.milestone === 'string' ? options.milestone : undefined,
      runtime: typeof options.runtime === 'string' ? options.runtime : undefined,
      verificationCommand: typeof options['verification-command'] === 'string' ? options['verification-command'] : undefined,
    });

    console.log(JSON.stringify({
      launchId: launchBundle.launchRequest.launchId,
      provider: launchBundle.launchRequest.provider,
      worker: launchBundle.launchRequest.worker.label,
      launchRequestPath: launchBundle.launchRequestPath,
      launchArtifactPath: launchBundle.launchArtifactPath,
      contractPath: launchBundle.contractPath,
      providerAdapterPath: launchBundle.providerAdapterPath,
      resultArtifactPath: launchBundle.resultArtifactPath,
    }, null, 2));
    return;
  }

  if (command === 'record-managed-runner-launch') {
    const snapshotPath = requireOption(options, 'snapshot');
    const launchArtifactPath = requireOption(options, 'launch-artifact');
    const updated = recordManagedRunnerLaunch(snapshotPath, {
      launchArtifactPath,
      status: typeof options.status === 'string' ? options.status as 'launching' | 'running' | 'finished' : undefined,
      tracking: parseOptionalTrackingHandle(options),
      stdoutPath: typeof options['stdout-path'] === 'string' ? options['stdout-path'] : undefined,
      stderrPath: typeof options['stderr-path'] === 'string' ? options['stderr-path'] : undefined,
      summary: typeof options.summary === 'string' ? options.summary : undefined,
    });

    console.log(JSON.stringify({
      snapshotPath: updated.snapshotPath,
      eventLogPath: updated.eventLogPath,
      event: updated.event,
      launchArtifact: updated.launchArtifact,
    }, null, 2));
    return;
  }

  if (command === 'record-managed-runner-result') {
    const snapshotPath = requireOption(options, 'snapshot');
    const launchArtifactPath = requireOption(options, 'launch-artifact');
    const updated = recordManagedRunnerResult(snapshotPath, {
      launchArtifactPath,
      resultArtifactPath: typeof options['result-artifact'] === 'string' ? options['result-artifact'] : undefined,
      outcome: requireOption(options, 'outcome') as 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'launch_failed' | 'unknown',
      exitCode: typeof options['exit-code'] === 'string' ? Number(options['exit-code']) : undefined,
      tracking: parseOptionalTrackingHandle(options),
      stdoutPath: typeof options['stdout-path'] === 'string' ? options['stdout-path'] : undefined,
      stderrPath: typeof options['stderr-path'] === 'string' ? options['stderr-path'] : undefined,
      summary: typeof options.summary === 'string' ? options.summary : undefined,
    });

    console.log(JSON.stringify({
      snapshotPath: updated.snapshotPath,
      eventLogPath: updated.eventLogPath,
      event: updated.event,
      launchArtifact: updated.launchArtifact,
      resultArtifact: updated.resultArtifact,
    }, null, 2));
    return;
  }

  if (command === 'emit-laizy-watchdog') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createLaizyWatchdogAdapter(rebuilt.snapshot, {
      outDir: typeof options['out-dir'] === 'string' ? options['out-dir'] : undefined,
      intervalSeconds: typeof options['interval-seconds'] === 'string' ? Number(options['interval-seconds']) : undefined,
      stallThresholdMinutes: typeof options['stall-threshold-minutes'] === 'string' ? Number(options['stall-threshold-minutes']) : undefined,
      verificationCommand: typeof options['verification-command'] === 'string' ? options['verification-command'] : undefined,
      mode: typeof options.mode === 'string' ? options.mode as 'ensure' | 'disable' : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeBackendAdapter(options.out, document);
      console.log(JSON.stringify({ outputPath, kind: document.kind, worker: document.worker.label }, null, 2));
      return;
    }

    console.log(JSON.stringify(document, null, 2));
    return;
  }

  if (command === 'check-backends') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    rebuilt.snapshot.backends = resolveBackendConfigurationOption(options, rebuilt.snapshot.backends);

    if (typeof options.worker === 'string') {
      const workerRole = options.worker as WorkerRole;
      const document = createBackendCheckResult(rebuilt.snapshot, workerRole, {
        outputPath: typeof options.out === 'string' ? options.out : undefined,
      });

      if (typeof options.out === 'string') {
        const outputPath = writeBackendCheckResult(options.out, document);
        console.log(JSON.stringify({
          outputPath,
          kind: document.kind,
          worker: document.worker.label,
          overallStatus: document.overallStatus,
          handoffStatus: document.summary.handoffStatus,
          headline: document.summary.headline,
          nextAction: document.summary.nextAction,
          failedProbeCount: document.summary.failedProbeCount,
          failedProbeNames: document.summary.failedProbeNames,
        }, null, 2));
        return;
      }

      console.log(JSON.stringify(document, null, 2));
      return;
    }

    const outputDir = typeof options['out-dir'] === 'string'
      ? path.resolve(options['out-dir'])
      : path.join(path.dirname(rebuilt.snapshotPath), `${path.basename(rebuilt.snapshotPath, '.json')}.backend-checks`);
    const documents = ALL_WORKER_ROLES.map((role) => {
      const outputPath = path.join(outputDir, `${role}.backend-check.json`);
      const document = createBackendCheckResult(rebuilt.snapshot, role, { outputPath });
      const writtenOutputPath = writeBackendCheckResult(outputPath, document);
      return {
        role,
        worker: document.worker.label,
        overallStatus: document.overallStatus,
        handoffStatus: document.summary.handoffStatus,
        headline: document.summary.headline,
        nextAction: document.summary.nextAction,
        failedProbeCount: document.summary.failedProbeCount,
        failedProbeNames: document.summary.failedProbeNames,
        backend: document.backend.backend,
        outputPath: writtenOutputPath,
      };
    });
    const unhealthyDocuments = documents.filter((document) => document.overallStatus !== 'healthy');
    const overallStatus = unhealthyDocuments.length === 0 ? 'healthy' : 'unhealthy';

    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: 'backend.check-summary',
      snapshotPath: rebuilt.snapshotPath,
      outputDir,
      overallStatus,
      summary: {
        checkedWorkerCount: documents.length,
        healthyWorkerCount: documents.length - unhealthyDocuments.length,
        unhealthyWorkerCount: unhealthyDocuments.length,
        headline: unhealthyDocuments.length === 0
          ? 'All configured worker backends passed preflight and are ready for handoff.'
          : `${unhealthyDocuments.length} worker backend preflight check(s) blocked handoff.`,
        nextAction: unhealthyDocuments.length === 0 ? 'proceed-to-handoff' : 'inspect-failed-probes',
        unhealthyWorkers: unhealthyDocuments.map((document) => ({
          role: document.role,
          worker: document.worker,
          backend: document.backend,
          headline: document.headline,
          failedProbeCount: document.failedProbeCount,
          failedProbeNames: document.failedProbeNames,
          nextAction: document.nextAction,
          outputPath: document.outputPath,
        })),
      },
      documents,
    }, null, 2));
    return;
  }

  if (command === 'emit-backend-check') {
    const snapshotPath = requireOption(options, 'snapshot');
    const rebuilt = rebuildSnapshot(snapshotPath);
    const document = createBackendCheckResult(rebuilt.snapshot, typeof options.worker === 'string' ? options.worker as WorkerRole : 'implementer', {
      outputPath: typeof options.out === 'string' ? options.out : undefined,
    });

    if (typeof options.out === 'string') {
      const outputPath = writeBackendCheckResult(options.out, document);
      console.log(JSON.stringify({
        outputPath,
        kind: document.kind,
        worker: document.worker.label,
        overallStatus: document.overallStatus,
        handoffStatus: document.summary.handoffStatus,
        headline: document.summary.headline,
        nextAction: document.summary.nextAction,
        failedProbeCount: document.summary.failedProbeCount,
        failedProbeNames: document.summary.failedProbeNames,
      }, null, 2));
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
