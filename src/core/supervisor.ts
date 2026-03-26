import path from 'node:path';

import { createImplementerContract, createPlannerRequest, selectNextActionableMilestone, writeContractDocument } from './contracts.js';
import { evaluateRunHealth } from './health.js';
import { createCronAdapter, createSessionSpawnAdapter, writeOpenClawAdapter } from './openclaw.js';
import { createRecoveryPlan, writeRecoveryPlan } from './recovery.js';
import { selectSupervisorRuntimeProfile } from './runtime-profile.js';
import { createVerificationCommand, writeVerificationDocument } from './verification.js';

import type { RunSnapshot, SupervisorAction, SupervisorDecision, SupervisorDecisionName } from './types.js';

function sanitizeSegment(value: string | null | undefined, fallback: string): string {
  return (value ?? fallback).replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || fallback;
}

function bundleBaseName(snapshot: RunSnapshot): string {
  return sanitizeSegment(snapshot.currentMilestoneId ?? snapshot.runId, 'run');
}

export function createSupervisorDecision(
  snapshot: RunSnapshot,
  options: { now?: string; stallThresholdMinutes?: number; verificationCommand?: string } = {},
): SupervisorDecision {
  const healthReport = evaluateRunHealth(snapshot, {
    now: options.now,
    stallThresholdMinutes: options.stallThresholdMinutes,
  });
  const activeMilestone = selectNextActionableMilestone(snapshot);
  const actions: SupervisorAction[] = [];

  const buildDecision = (decision: SupervisorDecisionName, reason: string): SupervisorDecision => {
    const runtimeProfile = selectSupervisorRuntimeProfile(snapshot, decision, activeMilestone);

    return {
      schemaVersion: 1,
      kind: 'supervisor.decision',
      generatedAt: new Date().toISOString(),
      runId: snapshot.runId,
      snapshotPath: snapshot.snapshotPath ?? null,
      eventLogPath: snapshot.eventLogPath ?? null,
      overallStatus: healthReport.overallStatus,
      runStatus: snapshot.status,
      activeMilestoneId: decision === 'closeout' ? null : activeMilestone?.id ?? null,
      decision,
      runtimeProfile,
      reason,
      actions: actions.map((action) => ({
        ...action,
        runtimeProfile: action.runtimeProfile ?? runtimeProfile,
      })),
    };
  };

  if (snapshot.planState.status === 'needs-plan') {
    actions.push({
      id: 'planner-bootstrap',
      kind: 'planner.request',
      title: 'Request bounded planning before implementation starts',
      worker: snapshot.workers.planner,
      requiresExternalExecution: true,
      documentPath: null,
      documentKind: 'planner.request',
      summary: snapshot.planState.reason,
      runtimeProfile: null,
    });

    return buildDecision('plan', snapshot.planState.reason);
  }

  if (snapshot.status === 'completed') {
    actions.push({
      id: 'disable-watchdog',
      kind: 'openclaw.cron',
      title: 'Disable the watchdog cron for the completed run',
      worker: snapshot.workers.watchdog,
      requiresExternalExecution: true,
      documentPath: null,
      documentKind: 'openclaw.cron',
      summary: 'The run is complete; disable the watchdog cadence and stop supervisory nudges.',
      runtimeProfile: null,
    });

    return buildDecision('closeout', 'All milestones are completed; only run closeout remains.');
  }

  if (snapshot.status === 'blocked' && activeMilestone?.status === 'blocked') {
    actions.push({
      id: 'planner-repair',
      kind: 'planner.request',
      title: 'Request bounded replanning for the blocked milestone',
      worker: snapshot.workers.planner,
      requiresExternalExecution: true,
      documentPath: null,
      documentKind: 'planner.request',
      summary: activeMilestone.lastNote ?? 'The current milestone is blocked and requires plan repair.',
      runtimeProfile: null,
    });

    return buildDecision('replan', activeMilestone.lastNote ?? 'The current milestone is blocked and requires plan repair.');
  }

  if (snapshot.status === 'blocked' || (snapshot.status !== 'planned' && healthReport.recoveryRecommendation.action !== 'none')) {
    actions.push({
      id: 'bounded-recovery',
      kind: 'recovery.plan',
      title: 'Hand off bounded recovery work',
      worker: snapshot.workers.recovery,
      requiresExternalExecution: true,
      documentPath: null,
      documentKind: 'recovery.plan',
      summary: healthReport.recoveryRecommendation.reason,
      runtimeProfile: null,
    });

    return buildDecision('recover', healthReport.recoveryRecommendation.reason);
  }

  if (snapshot.status === 'verifying') {
    actions.push({
      id: 'run-verification',
      kind: 'verification.command',
      title: 'Run milestone verification',
      worker: snapshot.workers.verifier,
      requiresExternalExecution: true,
      documentPath: null,
      documentKind: 'verification.command',
      summary: `Run verification for milestone ${activeMilestone?.id ?? 'unknown'} before completion.`,
      runtimeProfile: null,
    });

    return buildDecision('verify', 'The active milestone is in verifying state and needs an explicit verification result.');
  }

  actions.push({
    id: 'continue-implementer',
    kind: 'implementer.contract',
    title: snapshot.status === 'planned' ? 'Start the next milestone' : 'Continue the active milestone',
    worker: snapshot.workers.implementer,
    requiresExternalExecution: true,
    documentPath: null,
    documentKind: 'implementer.contract',
    summary: snapshot.status === 'planned'
      ? `Start milestone ${activeMilestone?.id ?? 'unknown'} with a bounded implementer contract.`
      : `Continue milestone ${activeMilestone?.id ?? 'unknown'} without widening scope.`,
    runtimeProfile: null,
  });

  return buildDecision(
    'continue',
    snapshot.status === 'planned'
      ? 'The run has an actionable milestone and no active implementer progress yet.'
      : 'The active milestone remains healthy and should continue under the bounded contract.',
  );
}

export function writeSupervisorBundle(
  outputDir: string,
  snapshot: RunSnapshot,
  options: { now?: string; stallThresholdMinutes?: number; verificationCommand?: string } = {},
) {
  const resolvedOutputDir = path.resolve(outputDir);
  const decision = createSupervisorDecision(snapshot, options);
  const baseName = bundleBaseName(snapshot);
  const documents: Record<string, string> = {};

  if (decision.decision === 'plan' || decision.decision === 'replan') {
    const plannerRequest = createPlannerRequest(snapshot, {
      requestedMode: decision.decision === 'replan' ? 'replan' : 'plan',
      triggerReason: decision.reason,
    });
    const plannerRequestPath = writeContractDocument(path.join(resolvedOutputDir, `${baseName}.planner-request.json`), plannerRequest);
    const plannerSpawnPath = writeOpenClawAdapter(
      path.join(resolvedOutputDir, `${baseName}.planner-spawn.json`),
      createSessionSpawnAdapter(snapshot, { worker: 'planner' }),
    );
    documents.plannerRequest = plannerRequestPath;
    documents.plannerSpawn = plannerSpawnPath;
    decision.actions = decision.actions.map((action) => ({
      ...action,
      documentPath: action.kind === 'planner.request' ? plannerRequestPath : action.documentPath,
    }));
  }

  if (decision.decision === 'continue') {
    const contract = createImplementerContract(snapshot);
    const contractPath = writeContractDocument(path.join(resolvedOutputDir, `${baseName}.implementer-contract.json`), contract);
    const spawnPath = writeOpenClawAdapter(
      path.join(resolvedOutputDir, `${baseName}.implementer-spawn.json`),
      createSessionSpawnAdapter(snapshot, { worker: 'implementer' }),
    );
    documents.implementerContract = contractPath;
    documents.implementerSpawn = spawnPath;
    decision.actions = decision.actions.map((action) => ({
      ...action,
      documentPath: action.kind === 'implementer.contract' ? contractPath : action.documentPath,
    }));
  }

  if (decision.decision === 'recover') {
    const recoveryPlan = createRecoveryPlan(snapshot, evaluateRunHealth(snapshot, {
      now: options.now,
      stallThresholdMinutes: options.stallThresholdMinutes,
    }));
    const recoveryPlanPath = writeRecoveryPlan(path.join(resolvedOutputDir, `${baseName}.recovery-plan.json`), recoveryPlan);
    const recoverySpawnPath = writeOpenClawAdapter(
      path.join(resolvedOutputDir, `${baseName}.recovery-spawn.json`),
      createSessionSpawnAdapter(snapshot, {
        worker: 'recovery',
        healthOptions: { stallThresholdMinutes: options.stallThresholdMinutes },
      }),
    );
    documents.recoveryPlan = recoveryPlanPath;
    documents.recoverySpawn = recoverySpawnPath;
    decision.actions = decision.actions.map((action) => ({
      ...action,
      documentPath: action.kind === 'recovery.plan' ? recoveryPlanPath : action.documentPath,
    }));
  }

  if (decision.decision === 'verify') {
    const verificationCommand = createVerificationCommand(snapshot, {
      command: options.verificationCommand,
    });
    const verificationCommandPath = writeVerificationDocument(
      path.join(resolvedOutputDir, `${baseName}.verification-command.json`),
      verificationCommand,
    );
    documents.verificationCommand = verificationCommandPath;
    decision.actions = decision.actions.map((action) => ({
      ...action,
      documentPath: action.kind === 'verification.command' ? verificationCommandPath : action.documentPath,
    }));
  }

  if (decision.decision === 'closeout') {
    const disableWatchdogPath = writeOpenClawAdapter(
      path.join(resolvedOutputDir, `${sanitizeSegment(snapshot.runId, 'run')}.watchdog-disable.json`),
      createCronAdapter(snapshot, { worker: 'watchdog', mode: 'disable' }),
    );
    documents.disableWatchdog = disableWatchdogPath;
    decision.actions = decision.actions.map((action) => ({
      ...action,
      documentPath: action.kind === 'openclaw.cron' ? disableWatchdogPath : action.documentPath,
    }));
  }

  const decisionPath = path.join(resolvedOutputDir, 'supervisor-decision.json');
  const manifestPath = path.join(resolvedOutputDir, 'supervisor-manifest.json');
  writeContractDocument(decisionPath, decision as never);
  writeContractDocument(manifestPath, {
    schemaVersion: 1,
    kind: 'supervisor.bundle',
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    snapshotPath: snapshot.snapshotPath ?? null,
    eventLogPath: snapshot.eventLogPath ?? null,
    outputDir: resolvedOutputDir,
    decision: decisionPath,
    documents,
  } as never);

  return {
    decision,
    decisionPath,
    manifestPath,
    documents,
  };
}
