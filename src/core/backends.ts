import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createImplementerContract, createPlannerRequest, selectNextActionableMilestone } from './contracts.js';
import { evaluateRunHealth } from './health.js';
import { createRecoveryPlan } from './recovery.js';
import { selectSupervisorRuntimeProfile } from './runtime-profile.js';
import { createVerificationCommand } from './verification.js';

import type { RunSnapshot, SnapshotMilestone, SupervisorDecisionName, SupervisorRuntimeProfile, WorkerRole } from './types.js';

const VALID_BACKEND_WORKERS = new Set<WorkerRole>([
  'planner',
  'implementer',
  'watchdog',
  'recovery',
  'verifier',
]);

type BackendWorker = {
  role: WorkerRole;
  label: string;
};

type WorkerPromptDocument = Record<string, unknown>;

type RuntimeCapabilityMap = {
  model: boolean;
  thinking: boolean;
  reasoningMode: boolean;
  persistentSession: boolean;
  requiresPty: boolean;
};

const RUNTIME_CAPABILITIES = {
  'codex-cli': {
    model: false,
    thinking: false,
    reasoningMode: false,
    persistentSession: false,
    requiresPty: true,
  },
  'claude-code': {
    model: false,
    thinking: false,
    reasoningMode: false,
    persistentSession: false,
    requiresPty: false,
  },
} satisfies Record<'codex-cli' | 'claude-code', RuntimeCapabilityMap>;

function resolveWorker(snapshot: RunSnapshot, workerRole: WorkerRole): BackendWorker {
  if (!VALID_BACKEND_WORKERS.has(workerRole)) {
    throw new Error(`Unsupported worker role for backend adapter: ${workerRole}`);
  }

  return {
    role: workerRole,
    label: snapshot.workers[workerRole],
  };
}

function resolveMilestone(snapshot: RunSnapshot, milestoneId: string | null = snapshot.currentMilestoneId) {
  if (!milestoneId) {
    return null;
  }

  return snapshot.milestones.find((candidate) => candidate.id === milestoneId) ?? null;
}

function inferDecisionName(snapshot: RunSnapshot, workerRole: WorkerRole): SupervisorDecisionName {
  if (workerRole === 'planner') {
    return snapshot.planState.status === 'needs-plan' ? 'plan' : 'replan';
  }

  if (workerRole === 'recovery') {
    return 'recover';
  }

  if (workerRole === 'verifier') {
    return 'verify';
  }

  return 'continue';
}

function resolvePromptDocument(
  snapshot: RunSnapshot,
  workerRole: WorkerRole,
  milestone: SnapshotMilestone | null,
  options: { healthOptions?: { now?: string; stallThresholdMinutes?: number } } = {},
): WorkerPromptDocument | null {
  if (workerRole === 'planner') {
    const requestedMode = snapshot.planState.status === 'needs-plan' ? 'plan' : 'replan';
    return createPlannerRequest(snapshot, {
      requestedMode,
      triggerReason: requestedMode === 'replan'
        ? milestone?.lastNote ?? 'The current run state requires bounded plan repair before implementation can continue.'
        : snapshot.planState.reason,
    }) as unknown as WorkerPromptDocument;
  }

  if (workerRole === 'implementer') {
    return createImplementerContract(snapshot, milestone) as unknown as WorkerPromptDocument;
  }

  if (workerRole === 'recovery') {
    return createRecoveryPlan(snapshot, evaluateRunHealth(snapshot, options.healthOptions ?? {})) as unknown as WorkerPromptDocument;
  }

  if (workerRole === 'verifier') {
    return createVerificationCommand(snapshot, {
      milestoneId: milestone?.id ?? undefined,
    }) as unknown as WorkerPromptDocument;
  }

  return {
    schemaVersion: 1,
    kind: 'watchdog.request',
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    snapshotPath: snapshot.snapshotPath ?? null,
    eventLogPath: snapshot.eventLogPath ?? null,
    worker: snapshot.workers.watchdog,
    instructions: [
      'Inspect the active run snapshot and event log.',
      'Use supervisor-tick as the source of truth for the next bounded action.',
      'Stay quiet when progress is healthy and there is no newly landed milestone.',
    ],
  };
}

function stringifyPromptDocument(document: WorkerPromptDocument | null, worker: BackendWorker, runtimeProfile: SupervisorRuntimeProfile) {
  const lines = [
    `You are the ${worker.label} worker for a Laizy run.`,
    'Follow the machine-readable contract below exactly and do not widen scope.',
    `Requested runtime profile: model=${runtimeProfile.model}, thinking=${runtimeProfile.thinking}, reasoningMode=${runtimeProfile.reasoningMode}, scope=${runtimeProfile.scope}.`,
  ];

  if (document) {
    lines.push('', 'Contract JSON:', JSON.stringify(document, null, 2));
  }

  return lines.join('\n');
}

function createCliExecutionEnvelope({
  operation,
  snapshot,
  worker,
  runtimeProfile,
  promptDocument,
  promptText,
  payload,
}: {
  operation: string;
  snapshot: RunSnapshot;
  worker: BackendWorker;
  runtimeProfile: SupervisorRuntimeProfile;
  promptDocument: WorkerPromptDocument | null;
  promptText: string;
  payload: Record<string, unknown>;
}) {
  return {
    schemaVersion: 1,
    kind: operation,
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    repoPath: snapshot.repoPath,
    planPath: snapshot.planPath,
    snapshotPath: snapshot.snapshotPath ?? null,
    eventLogPath: snapshot.eventLogPath ?? null,
    worker,
    runtimeProfile,
    promptDocument,
    promptText,
    payload,
  };
}

export function createCodexCliExecAdapter(
  snapshot: RunSnapshot,
  options: {
    worker?: WorkerRole;
    milestoneId?: string;
    healthOptions?: { now?: string; stallThresholdMinutes?: number };
    runtimeProfile?: SupervisorRuntimeProfile;
  } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'implementer');
  const milestone = resolveMilestone(snapshot, options.milestoneId);
  const decision = inferDecisionName(snapshot, worker.role);
  const runtimeProfile = options.runtimeProfile ?? selectSupervisorRuntimeProfile(snapshot, decision, milestone);
  const promptDocument = resolvePromptDocument(snapshot, worker.role, milestone, options);
  const promptText = stringifyPromptDocument(promptDocument, worker, runtimeProfile);
  const capabilities = RUNTIME_CAPABILITIES['codex-cli'];

  return createCliExecutionEnvelope({
    operation: 'codex-cli.exec',
    snapshot,
    worker,
    runtimeProfile,
    promptDocument,
    promptText,
    payload: {
      adapter: 'codex-cli.exec',
      sessionLabel: worker.label,
      cwd: snapshot.repoPath,
      command: 'codex',
      args: ['exec', '--full-auto', promptText],
      pty: true,
      capabilities,
      requestedRuntimeProfile: runtimeProfile,
      metadata: {
        stableWorkerLabel: true,
        repoPath: snapshot.repoPath,
        planPath: snapshot.planPath,
        promptDocumentKind: promptDocument?.kind ?? null,
        requestedModel: runtimeProfile.model,
        requestedThinking: runtimeProfile.thinking,
        requestedReasoningMode: runtimeProfile.reasoningMode,
      },
    },
  });
}

export function createClaudeCodeExecAdapter(
  snapshot: RunSnapshot,
  options: {
    worker?: WorkerRole;
    milestoneId?: string;
    healthOptions?: { now?: string; stallThresholdMinutes?: number };
    runtimeProfile?: SupervisorRuntimeProfile;
  } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'implementer');
  const milestone = resolveMilestone(snapshot, options.milestoneId);
  const decision = inferDecisionName(snapshot, worker.role);
  const runtimeProfile = options.runtimeProfile ?? selectSupervisorRuntimeProfile(snapshot, decision, milestone);
  const promptDocument = resolvePromptDocument(snapshot, worker.role, milestone, options);
  const promptText = stringifyPromptDocument(promptDocument, worker, runtimeProfile);
  const capabilities = RUNTIME_CAPABILITIES['claude-code'];

  return createCliExecutionEnvelope({
    operation: 'claude-code.exec',
    snapshot,
    worker,
    runtimeProfile,
    promptDocument,
    promptText,
    payload: {
      adapter: 'claude-code.exec',
      sessionLabel: worker.label,
      cwd: snapshot.repoPath,
      command: 'claude',
      args: ['--permission-mode', 'bypassPermissions', '--print', promptText],
      pty: false,
      capabilities,
      requestedRuntimeProfile: runtimeProfile,
      metadata: {
        stableWorkerLabel: true,
        repoPath: snapshot.repoPath,
        planPath: snapshot.planPath,
        promptDocumentKind: promptDocument?.kind ?? null,
        requestedModel: runtimeProfile.model,
        requestedThinking: runtimeProfile.thinking,
        requestedReasoningMode: runtimeProfile.reasoningMode,
      },
    },
  });
}

export function createLaizyWatchdogAdapter(
  snapshot: RunSnapshot,
  options: {
    outDir?: string;
    intervalSeconds?: number;
    stallThresholdMinutes?: number;
    verificationCommand?: string;
    mode?: 'ensure' | 'disable';
  } = {},
) {
  const resolvedOutDir = path.resolve(
    options.outDir
      ?? path.join(path.dirname(snapshot.snapshotPath ?? path.resolve('state/runs/run.json')), `${path.basename(snapshot.snapshotPath ?? 'run.json', '.json')}.supervisor`),
  );
  const intervalSeconds = Number(options.intervalSeconds ?? 300);

  return {
    schemaVersion: 1,
    kind: 'laizy.watchdog',
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    repoPath: snapshot.repoPath,
    planPath: snapshot.planPath,
    snapshotPath: snapshot.snapshotPath ?? null,
    eventLogPath: snapshot.eventLogPath ?? null,
    worker: {
      role: 'watchdog',
      label: snapshot.workers.watchdog,
    },
    payload: {
      adapter: 'laizy.watchdog',
      mode: options.mode ?? 'ensure',
      cwd: snapshot.repoPath,
      intervalSeconds,
      command: 'laizy',
      args: [
        'watchdog',
        '--snapshot',
        snapshot.snapshotPath ?? '',
        '--out-dir',
        resolvedOutDir,
        '--interval-seconds',
        String(intervalSeconds),
        '--stall-threshold-minutes',
        String(options.stallThresholdMinutes ?? 15),
        '--verification-command',
        options.verificationCommand ?? '/usr/bin/node scripts/build-check.mjs',
      ],
      metadata: {
        stableWorkerLabel: true,
        cadence: 'watchdog',
        outputDir: resolvedOutDir,
      },
    },
  };
}

export function writeBackendAdapter(outputPath: string, document: object): string {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
