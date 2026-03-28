import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  createBackendCheckResult,
  resolveBackendConfiguration,
} from './backend-preflight.js';
import { createImplementerContract, createPlannerRequest } from './contracts.js';
import { evaluateRunHealth } from './health.js';
import { createRecoveryPlan } from './recovery.js';
import { selectSupervisorRuntimeProfile } from './runtime-profile.js';

import type { BackendCheckResultDocument, RunSnapshot, SupervisorDecisionName, WorkerRole } from './types.js';

const VALID_ADAPTER_WORKERS = new Set<WorkerRole>([
  'planner',
  'implementer',
  'watchdog',
  'recovery',
  'verifier',
]);

function resolveWorker(snapshot: RunSnapshot, workerRole: WorkerRole) {
  if (!VALID_ADAPTER_WORKERS.has(workerRole)) {
    throw new Error(`Unsupported worker role for the OpenClaw adapter layer: ${workerRole}`);
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

function createBackendPreflightSummary(backendCheck: BackendCheckResultDocument) {
  return {
    handoffStatus: backendCheck.summary.handoffStatus,
    overallStatus: backendCheck.overallStatus,
    headline: backendCheck.summary.headline,
    operatorMessage: backendCheck.summary.operatorMessage,
    nextAction: backendCheck.summary.nextAction,
    failedProbeCount: backendCheck.summary.failedProbeCount,
    failedProbeNames: backendCheck.summary.failedProbeNames,
    probeStatusCounts: backendCheck.summary.probeStatusCounts,
    probes: backendCheck.summary.probes,
    outputPath: backendCheck.outputPath ?? null,
  };
}

function createRuntimeProfileSummary(runtimeProfile: ReturnType<typeof selectSupervisorRuntimeProfile>): string {
  return `Use runtime profile model=${runtimeProfile.model}, thinking=${runtimeProfile.thinking}, reasoningMode=${runtimeProfile.reasoningMode}, scope=${runtimeProfile.scope} when the runtime supports it.`;
}

function createOpenClawOperatorGuidance(
  runtimeProfile: ReturnType<typeof selectSupervisorRuntimeProfile>,
  workerLabel: string,
) {
  return {
    runtimeProfileSummary: createRuntimeProfileSummary(runtimeProfile),
    transportSummary: 'OpenClaw handoffs should use runtime-backed sessions, typically subagent, so the emitted contract stays separate from durable run state.',
    loopSummary: 'Keep Laizy as the control plane: start-run once, then supervisor-tick to emit the next bounded action from durable repo state.',
    watchdogSummary: 'Use local `laizy watchdog` for cadence-driven inspection and recovery nudges; do not turn the watchdog into another chat worker.',
    examples: [
      `OpenClaw workers: spawn ${workerLabel} with runtime=subagent when available and pass the emitted contract as the bounded handoff.`,
      'Codex CLI workers: use a PTY-backed one-shot `codex exec --full-auto` invocation for the emitted contract.',
      'Claude Code workers: use a non-PTY one-shot `claude --permission-mode bypassPermissions --print` invocation for the emitted contract.',
      'Local watchdog: run `laizy watchdog` on a cadence against the same snapshot/out-dir instead of inventing a chat-only loop.',
    ],
  };
}

export function createSessionSpawnAdapter(
  snapshot: RunSnapshot,
  options: {
    worker?: WorkerRole;
    milestoneId?: string;
    runtime?: string;
    healthOptions?: { now?: string; stallThresholdMinutes?: number };
    runtimeProfile?: ReturnType<typeof selectSupervisorRuntimeProfile>;
    backendCheck?: BackendCheckResultDocument;
  } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'implementer');
  const milestone = resolveMilestone(snapshot, options.milestoneId);
  const runtime = options.runtime ?? 'subagent';
  const decision = inferDecisionName(snapshot, worker.role);
  const runtimeProfile = options.runtimeProfile ?? selectSupervisorRuntimeProfile(snapshot, decision, milestone);
  const backendConfiguration = resolveBackendConfiguration(snapshot)[worker.role];
  const backendCheck = options.backendCheck ?? createBackendCheckResult(snapshot, worker.role);
  const contract = worker.role === 'implementer'
    ? createImplementerContract(snapshot, milestone)
    : null;
  const plannerRequest = worker.role === 'planner'
    ? createPlannerRequest(snapshot, {
        requestedMode: decision === 'replan' ? 'replan' : 'plan',
        triggerReason: decision === 'replan'
          ? 'The current repo-native control-loop state requires bounded plan repair before implementation can continue.'
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
      configuredBackend: backendConfiguration,
      backendCheck,
      backendPreflight: createBackendPreflightSummary(backendCheck),
      runtimeProfile,
      operatorGuidance: createOpenClawOperatorGuidance(runtimeProfile, worker.label),
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
    backendCheck?: BackendCheckResultDocument;
  } = {},
) {
  const worker = resolveWorker(snapshot, options.worker ?? 'watchdog');
  const mode = options.mode ?? 'ensure';
  const schedule = options.schedule ?? '*/5 * * * *';
  const backendConfiguration = resolveBackendConfiguration(snapshot)[worker.role];
  const backendCheck = options.backendCheck ?? createBackendCheckResult(snapshot, worker.role);
  const runtimeProfile = selectSupervisorRuntimeProfile(snapshot, worker.role === 'planner' ? 'plan' : 'recover', resolveMilestone(snapshot));
  const prompt = options.prompt
    ?? `Inspect ${snapshot.workers.implementer} for repo-native control-loop milestone progress or stalls in ${path.basename(snapshot.repoPath)}.`;

  return createAdapterEnvelope({
    operation: 'cron',
    snapshot,
    worker,
    runtimeProfile,
    payload: {
      adapter: 'cron',
      mode,
      jobLabel: options.jobLabel ?? `${snapshot.runId}-${worker.label}`,
      schedule,
      targetWorker: worker.label,
      prompt,
      configuredBackend: backendConfiguration,
      backendCheck,
      backendPreflight: createBackendPreflightSummary(backendCheck),
      requestedRuntimeProfile: runtimeProfile,
      operatorGuidance: createOpenClawOperatorGuidance(runtimeProfile, worker.label),
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
