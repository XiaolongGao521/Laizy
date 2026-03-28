import path from 'node:path';

import {
  assertHealthyBackendCheck,
  createBackendCheckResult,
  writeBackendCheckResult,
} from './backend-preflight.js';
import { summarizeEventDerivedState } from './events.js';
import { createImplementerContract, createPlannerRequest, selectNextActionableMilestone, writeContractDocument } from './contracts.js';
import {
  createClaudeCodeExecAdapter,
  createCodexCliExecAdapter,
  createLaizyWatchdogAdapter,
  writeBackendAdapter,
} from './backends.js';
import { evaluateRunHealth } from './health.js';
import { createCronAdapter, createSessionSpawnAdapter, writeOpenClawAdapter } from './openclaw.js';
import { createRecoveryPlan, writeRecoveryPlan } from './recovery.js';
import { selectSupervisorRuntimeProfile } from './runtime-profile.js';
import { createVerificationCommand, writeVerificationDocument } from './verification.js';

import type {
  BackendCheckResultDocument,
  RunSnapshot,
  SupervisorAction,
  SupervisorDecision,
  SupervisorDecisionName,
  WorkerRole,
} from './types.js';

function sanitizeSegment(value: string | null | undefined, fallback: string): string {
  return (value ?? fallback).replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || fallback;
}

function bundleBaseName(snapshot: RunSnapshot): string {
  return sanitizeSegment(snapshot.currentMilestoneId ?? snapshot.runId, 'run');
}

function requiredPreflightRole(decision: SupervisorDecisionName): WorkerRole | null {
  if (decision === 'plan' || decision === 'replan') {
    return 'planner';
  }

  if (decision === 'continue') {
    return 'implementer';
  }

  if (decision === 'recover') {
    return 'recovery';
  }

  if (decision === 'verify') {
    return 'verifier';
  }

  return null;
}

function writeDecisionBackendCheck(
  resolvedOutputDir: string,
  baseName: string,
  snapshot: RunSnapshot,
  role: WorkerRole,
): { document: BackendCheckResultDocument; path: string } {
  const document = createBackendCheckResult(snapshot, role);
  const outputPath = writeBackendCheckResult(
    path.join(resolvedOutputDir, `${baseName}.${role}.backend-check.json`),
    {
      ...document,
      outputPath: path.join(resolvedOutputDir, `${baseName}.${role}.backend-check.json`),
    },
  );

  return {
    document: {
      ...document,
      outputPath,
    },
    path: outputPath,
  };
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
  const eventDerivedState = summarizeEventDerivedState(snapshot);

  const buildContinuation = (decision: SupervisorDecisionName): SupervisorDecision['continuation'] => {
    if (decision === 'closeout') {
      return {
        mode: 'closeout',
        summary: 'All milestones are complete; only watchdog/control-loop shutdown remains.',
        recommendedDocumentKind: 'openclaw.cron',
      };
    }

    if (decision === 'verify') {
      return {
        mode: 'verify-active-milestone',
        summary: `Active milestone ${activeMilestone?.id ?? 'unknown'} is waiting on an explicit verification result with recorded evidence.`,
        recommendedDocumentKind: 'verification.command',
      };
    }

    if (decision === 'recover') {
      return {
        mode: 'recover-before-continuing',
        summary: healthReport.recoveryRecommendation.summary,
        recommendedDocumentKind: 'recovery.plan',
      };
    }

    if (decision === 'continue') {
      const isResume = snapshot.status === 'implementing' && eventDerivedState.eventCount > 1;
      return {
        mode: isResume ? 'resume-after-rebuild' : snapshot.status === 'planned' ? 'start-next-milestone' : 'continue-active-milestone',
        summary: snapshot.status === 'planned'
          ? `Start milestone ${activeMilestone?.id ?? 'unknown'} using the emitted implementer contract.`
          : isResume
            ? `Resume milestone ${activeMilestone?.id ?? 'unknown'} from the current snapshot/event-log state using the emitted implementer contract.`
            : `Continue milestone ${activeMilestone?.id ?? 'unknown'} using the emitted implementer contract.`,
        recommendedDocumentKind: 'implementer.contract',
      };
    }

    return {
      mode: 'none',
      summary: decision === 'plan'
        ? 'Create the initial bounded plan request before starting implementation.'
        : 'Repair the bounded plan for the blocked milestone before continuing.',
      recommendedDocumentKind: 'planner.request',
    };
  };

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
      eventDerivedState,
      continuation: buildContinuation(decision),
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
      title: 'Request bounded planning before the repo-native control loop starts',
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
    actions.push(
      {
        id: 'disable-watchdog-cron',
        kind: 'openclaw.cron',
        title: 'Disable the OpenClaw watchdog cron for the completed repo-native control loop',
        worker: snapshot.workers.watchdog,
        requiresExternalExecution: true,
        documentPath: null,
        documentKind: 'openclaw.cron',
        summary: 'The repo-native control loop is complete; disable the OpenClaw watchdog cadence and stop supervisor nudges.',
        runtimeProfile: null,
      },
      {
        id: 'disable-laizy-watchdog',
        kind: 'laizy.watchdog',
        title: 'Disable the local laizy watchdog loop for the completed repo-native control loop',
        worker: snapshot.workers.watchdog,
        requiresExternalExecution: true,
        documentPath: null,
        documentKind: 'laizy.watchdog',
        summary: 'If a local laizy watchdog loop is running, stop it as part of repo-native control-loop closeout.',
        runtimeProfile: null,
      },
    );

    return buildDecision('closeout', 'All verification-gated milestones are completed; only control-loop closeout remains.');
  }

  if (snapshot.status === 'blocked' && activeMilestone?.status === 'blocked') {
    actions.push({
      id: 'planner-repair',
      kind: 'planner.request',
      title: 'Request bounded replanning for the blocked verification-gated milestone',
      worker: snapshot.workers.planner,
      requiresExternalExecution: true,
      documentPath: null,
      documentKind: 'planner.request',
      summary: activeMilestone.lastNote ?? 'The current verification-gated milestone is blocked and requires bounded plan repair.',
      runtimeProfile: null,
    });

    return buildDecision('replan', activeMilestone.lastNote ?? 'The current verification-gated milestone is blocked and requires bounded plan repair.');
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
      summary: healthReport.recoveryRecommendation.summary,
      runtimeProfile: null,
    });

    return buildDecision('recover', healthReport.recoveryRecommendation.reason);
  }

  if (snapshot.status === 'verifying') {
    actions.push({
      id: 'run-verification',
      kind: 'verification.command',
      title: 'Run verification for the active verification-gated milestone',
      worker: snapshot.workers.verifier,
      requiresExternalExecution: true,
      documentPath: null,
      documentKind: 'verification.command',
      summary: `Run verification for milestone ${activeMilestone?.id ?? 'unknown'} and record evidence before completing the verification-gated milestone.`,
      runtimeProfile: null,
    });

    return buildDecision('verify', 'The active verification-gated milestone is in verifying state and needs an explicit verification result with recorded evidence.');
  }

  actions.push({
    id: 'continue-implementer',
    kind: 'implementer.contract',
    title: snapshot.status === 'planned' ? 'Start the next verification-gated milestone' : 'Continue the active verification-gated milestone',
    worker: snapshot.workers.implementer,
    requiresExternalExecution: true,
    documentPath: null,
    documentKind: 'implementer.contract',
    summary: snapshot.status === 'planned'
      ? `Start milestone ${activeMilestone?.id ?? 'unknown'} as the next bounded step in the repo-native control loop.`
      : `Continue milestone ${activeMilestone?.id ?? 'unknown'} as a bounded step in the repo-native control loop without widening scope.`,
    runtimeProfile: null,
  });

  return buildDecision(
    'continue',
    snapshot.status === 'planned'
      ? 'The repo-native control loop has an actionable milestone and no active implementer progress yet.'
      : 'The active verification-gated milestone remains healthy and should continue under the bounded contract.',
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
  const preflightRole = requiredPreflightRole(decision.decision);
  let preflightCheck: BackendCheckResultDocument | null = null;

  if (preflightRole) {
    const writtenPreflight = writeDecisionBackendCheck(resolvedOutputDir, baseName, snapshot, preflightRole);
    preflightCheck = writtenPreflight.document;
    const documentKey = `${preflightRole}BackendCheck`;
    documents[documentKey] = writtenPreflight.path;
    assertHealthyBackendCheck(writtenPreflight.document, {
      context: `supervisor-tick cannot emit ${decision.decision} adapters`,
    });
  }

  if (decision.decision === 'plan' || decision.decision === 'replan') {
    const plannerRequest = createPlannerRequest(snapshot, {
      requestedMode: decision.decision === 'replan' ? 'replan' : 'plan',
      triggerReason: decision.reason,
    });
    const plannerRequestPath = writeContractDocument(path.join(resolvedOutputDir, `${baseName}.planner-request.json`), plannerRequest);
    const plannerSpawnPath = writeOpenClawAdapter(
      path.join(resolvedOutputDir, `${baseName}.planner-spawn.json`),
      createSessionSpawnAdapter(snapshot, {
        worker: 'planner',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    const codexPlannerExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.codex-cli-planner-exec.json`),
      createCodexCliExecAdapter(snapshot, {
        worker: 'planner',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    const claudePlannerExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.claude-code-planner-exec.json`),
      createClaudeCodeExecAdapter(snapshot, {
        worker: 'planner',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    documents.plannerRequest = plannerRequestPath;
    documents.plannerSpawn = plannerSpawnPath;
    documents.codexPlannerExec = codexPlannerExecPath;
    documents.claudePlannerExec = claudePlannerExecPath;
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
      createSessionSpawnAdapter(snapshot, {
        worker: 'implementer',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    const codexExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.codex-cli-implementer-exec.json`),
      createCodexCliExecAdapter(snapshot, {
        worker: 'implementer',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    const claudeExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.claude-code-implementer-exec.json`),
      createClaudeCodeExecAdapter(snapshot, {
        worker: 'implementer',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    documents.implementerContract = contractPath;
    documents.implementerSpawn = spawnPath;
    documents.codexImplementerExec = codexExecPath;
    documents.claudeImplementerExec = claudeExecPath;
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
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    const codexRecoveryExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.codex-cli-recovery-exec.json`),
      createCodexCliExecAdapter(snapshot, {
        worker: 'recovery',
        healthOptions: { now: options.now, stallThresholdMinutes: options.stallThresholdMinutes },
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    const claudeRecoveryExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.claude-code-recovery-exec.json`),
      createClaudeCodeExecAdapter(snapshot, {
        worker: 'recovery',
        healthOptions: { now: options.now, stallThresholdMinutes: options.stallThresholdMinutes },
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    documents.recoveryPlan = recoveryPlanPath;
    documents.recoverySpawn = recoverySpawnPath;
    documents.codexRecoveryExec = codexRecoveryExecPath;
    documents.claudeRecoveryExec = claudeRecoveryExecPath;
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
    const codexVerifierExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.codex-cli-verifier-exec.json`),
      createCodexCliExecAdapter(snapshot, {
        worker: 'verifier',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    const claudeVerifierExecPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${baseName}.claude-code-verifier-exec.json`),
      createClaudeCodeExecAdapter(snapshot, {
        worker: 'verifier',
        runtimeProfile: decision.runtimeProfile,
        backendCheck: preflightCheck ?? undefined,
      }),
    );
    documents.verificationCommand = verificationCommandPath;
    documents.codexVerifierExec = codexVerifierExecPath;
    documents.claudeVerifierExec = claudeVerifierExecPath;
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
    const disableLaizyWatchdogPath = writeBackendAdapter(
      path.join(resolvedOutputDir, `${sanitizeSegment(snapshot.runId, 'run')}.laizy-watchdog-disable.json`),
      createLaizyWatchdogAdapter(snapshot, {
        outDir: resolvedOutputDir,
        stallThresholdMinutes: options.stallThresholdMinutes,
        verificationCommand: options.verificationCommand,
        mode: 'disable',
      }),
    );
    const watchdogBackendCheckPath = writeBackendCheckResult(
      path.join(resolvedOutputDir, `${sanitizeSegment(snapshot.runId, 'run')}.watchdog.backend-check.json`),
      createBackendCheckResult(snapshot, 'watchdog'),
    );
    documents.disableWatchdog = disableWatchdogPath;
    documents.disableLaizyWatchdog = disableLaizyWatchdogPath;
    documents.watchdogBackendCheck = watchdogBackendCheckPath;
    decision.actions = decision.actions.map((action) => ({
      ...action,
      documentPath: action.kind === 'openclaw.cron'
        ? disableWatchdogPath
        : action.kind === 'laizy.watchdog'
          ? disableLaizyWatchdogPath
          : action.documentPath,
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
    decisionSummary: {
      decision: decision.decision,
      reason: decision.reason,
      continuation: decision.continuation,
      eventDerivedState: decision.eventDerivedState,
    },
    documents,
    documentOrder: [
      'supervisor-decision.json',
      ...Object.entries(documents).map(([key, documentPath]) => `${key}:${documentPath}`),
    ],
  } as never);

  return {
    decision,
    decisionPath,
    manifestPath,
    documents,
  };
}
