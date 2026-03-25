import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createImplementerContract } from './contracts.mjs';
import { evaluateRunHealth } from './health.mjs';
import { createRecoveryPlan } from './recovery.mjs';

const VALID_ADAPTER_WORKERS = new Set([
  'planner',
  'implementer',
  'watchdog',
  'recovery',
  'verifier',
]);

function resolveWorker(snapshot, workerRole) {
  if (!VALID_ADAPTER_WORKERS.has(workerRole)) {
    throw new Error(`Unsupported worker role for OpenClaw adapter: ${workerRole}`);
  }

  return {
    role: workerRole,
    label: snapshot.workers[workerRole],
  };
}

function resolveMilestone(snapshot, milestoneId = snapshot.currentMilestoneId) {
  if (!milestoneId) {
    return null;
  }

  return snapshot.milestones.find((milestone) => milestone.id === milestoneId) ?? null;
}

function createAdapterEnvelope({ operation, snapshot, worker, payload }) {
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
    payload,
  };
}

export function createSessionSpawnAdapter(snapshot, options = {}) {
  const worker = resolveWorker(snapshot, options.worker ?? 'implementer');
  const milestone = resolveMilestone(snapshot, options.milestoneId);
  const runtime = options.runtime ?? 'subagent';
  const contract = worker.role === 'implementer'
    ? createImplementerContract(snapshot, milestone)
    : null;
  const recoveryPlan = worker.role === 'recovery'
    ? createRecoveryPlan(snapshot, evaluateRunHealth(snapshot, options.healthOptions ?? {}))
    : null;

  return createAdapterEnvelope({
    operation: 'sessions_spawn',
    snapshot,
    worker,
    payload: {
      adapter: 'sessions_spawn',
      sessionLabel: worker.label,
      runtime,
      cwd: snapshot.repoPath,
      milestoneId: milestone?.id ?? null,
      promptDocument: contract ?? recoveryPlan,
      metadata: {
        stableWorkerLabel: true,
        repoPath: snapshot.repoPath,
        planPath: snapshot.planPath,
      },
    },
  });
}

export function createSessionSendAdapter(snapshot, options = {}) {
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

export function createSessionHistoryAdapter(snapshot, options = {}) {
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

export function createCronAdapter(snapshot, options = {}) {
  const worker = resolveWorker(snapshot, options.worker ?? 'watchdog');
  const schedule = options.schedule ?? '*/5 * * * *';
  const prompt = options.prompt
    ?? `Inspect ${snapshot.workers.implementer} for milestone progress or stalls in ${path.basename(snapshot.repoPath)}.`;

  return createAdapterEnvelope({
    operation: 'cron',
    snapshot,
    worker,
    payload: {
      adapter: 'cron',
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

export function writeOpenClawAdapter(outputPath, document) {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
