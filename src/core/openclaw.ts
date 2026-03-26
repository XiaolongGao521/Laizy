import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createImplementerContract, createPlannerRequest } from './contracts.js';
import { evaluateRunHealth } from './health.js';
import { createRecoveryPlan } from './recovery.js';
import { selectSupervisorRuntimeProfile } from './runtime-profile.js';

import type { RunSnapshot, SupervisorDecisionName, WorkerRole } from './types.js';

const VALID_ADAPTER_WORKERS = new Set<WorkerRole>([
  'planner',
  'implementer',
  'watchdog',
  'recovery',
  'verifier',
]);

function resolveWorker(snapshot: RunSnapshot, workerRole: WorkerRole) {
  if (!VALID_ADAPTER_WORKERS.has(workerRole)) {
    throw new Error(`Unsupported worker role for OpenClaw adapter: ${workerRole}`);
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

  return snapshot.milestones.find((milestone) => milestone.id === milestoneId) ?? null;
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

function createAdapterEnvelope({
  operation,
  snapshot,
  worker,
  runtimeProfile,
  payload,
}: {
  operation: string;
  snapshot: RunSnapshot;
  worker: ReturnType<typeof resolveWorker>;
  runtimeProfile?: ReturnType<typeof selectSupervisorRuntimeProfile> | null;
  payload: Record<string, unknown>;
}) {
  return {
    schemaVersion: 1,
    kind: `openclaw.${operation}`,
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    repoPath: snapshot.repoPath,
    planPath: snapshot.planPath,
    snapshotPath: snapshot.snapshotPath ?? null,
    eventLogPath: snapshot.eventLogPath ?? null,
    worker,
    runtimeProfile: runtimeProfile ?? null,
    payload,
  };
}

export function createSessionSpawnAdapter(
  snapshot: RunSnapshot,
  options: { worker?: WorkerRole; milestoneId?: string; runtime?: string; healthOptions?: { now?: string; stallThresholdMinutes?: number } } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'implementer');
  const milestone = resolveMilestone(snapshot, options.milestoneId ?? null);
  const runtime = options.runtime ?? 'subagent';
  const decision = inferDecisionName(snapshot, worker.role);
  const runtimeProfile = selectSupervisorRuntimeProfile(snapshot, decision, milestone);
  const contract = worker.role === 'implementer'
    ? createImplementerContract(snapshot, milestone)
    : null;
  const plannerRequest = worker.role === 'planner'
    ? createPlannerRequest(snapshot, {
        requestedMode: decision === 'replan' ? 'replan' : 'plan',
        triggerReason: decision === 'replan'
          ? 'The current run state requires bounded plan repair before implementation can continue.'
          : snapshot.planState.reason,
      })
    : null;
  const recoveryPlan = worker.role === 'recovery'
    ? createRecoveryPlan(snapshot, evaluateRunHealth(snapshot, options.healthOptions ?? {}))
    : null;

  return createAdapterEnvelope({
    operation: 'sessions_spawn',
    snapshot,
    worker,
    runtimeProfile,
    payload: {
      adapter: 'sessions_spawn',
      sessionLabel: worker.label,
      runtime,
      cwd: snapshot.repoPath,
      milestoneId: milestone?.id ?? null,
      promptDocument: contract ?? plannerRequest ?? recoveryPlan,
      runtimeProfile,
      metadata: {
        stableWorkerLabel: true,
        repoPath: snapshot.repoPath,
        planPath: snapshot.planPath,
        model: runtimeProfile.model,
        thinking: runtimeProfile.thinking,
        reasoningMode: runtimeProfile.reasoningMode,
      },
    },
  });
}

export function createSessionSendAdapter(
  snapshot: RunSnapshot,
  options: { worker?: WorkerRole; message?: string; mode?: string } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'implementer');

  return createAdapterEnvelope({
    operation: 'sessions_send',
    snapshot,
    worker,
    payload: {
      adapter: 'sessions_send',
      sessionLabel: worker.label,
      message: options.message ?? '',
      mode: options.mode ?? 'append',
      metadata: {
        stableWorkerLabel: true,
      },
    },
  });
}

export function createSessionHistoryAdapter(
  snapshot: RunSnapshot,
  options: { worker?: WorkerRole; limit?: number; since?: string; includeToolCalls?: boolean } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'implementer');

  return createAdapterEnvelope({
    operation: 'sessions_history',
    snapshot,
    worker,
    payload: {
      adapter: 'sessions_history',
      sessionLabel: worker.label,
      limit: Number(options.limit ?? 50),
      since: options.since ?? null,
      includeToolCalls: Boolean(options.includeToolCalls ?? false),
      metadata: {
        stableWorkerLabel: true,
      },
    },
  });
}

export function createCronAdapter(
  snapshot: RunSnapshot,
  options: {
    worker?: Extract<WorkerRole, 'watchdog' | 'planner' | 'recovery'>;
    schedule?: string;
    prompt?: string;
    jobLabel?: string;
    mode?: 'ensure' | 'disable';
  } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'watchdog');
  const mode = options.mode ?? 'ensure';
  const schedule = options.schedule ?? '*/5 * * * *';
  const prompt = options.prompt
    ?? `Inspect ${snapshot.workers.implementer} for milestone progress or stalls in ${path.basename(snapshot.repoPath)}.`;

  return createAdapterEnvelope({
    operation: 'cron',
    snapshot,
    worker,
    payload: {
      adapter: 'cron',
      mode,
      jobLabel: options.jobLabel ?? `${snapshot.runId}-${worker.label}`,
      schedule,
      targetWorker: worker.label,
      prompt,
      metadata: {
        stableWorkerLabel: true,
        cadence: 'watchdog',
      },
    },
  });
}

export function writeOpenClawAdapter(outputPath: string, document: object): string {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
