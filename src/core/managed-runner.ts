import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createClaudeCodeExecAdapter, createCodexCliExecAdapter, writeBackendAdapter } from './backends.js';
import { resolveBackendConfiguration } from './backend-preflight.js';
import { createImplementerContract, createPlannerRequest, writeContractDocument } from './contracts.js';
import { evaluateRunHealth } from './health.js';
import { createSessionSpawnAdapter, writeOpenClawAdapter } from './openclaw.js';
import { createRecoveryPlan, writeRecoveryPlan } from './recovery.js';
import { selectSupervisorRuntimeProfile } from './runtime-profile.js';
import { createVerificationCommand, writeVerificationDocument } from './verification.js';

import type {
  BackendCheckResultDocument,
  BackendKind,
  ManagedRunnerAdapterKind,
  ManagedRunnerArtifactReference,
  ManagedRunnerContractKind,
  ManagedRunnerLaunchArtifact,
  ManagedRunnerLaunchRequest,
  ManagedRunnerOutcome,
  ManagedRunnerProvider,
  ManagedRunnerResultArtifact,
  ManagedRunnerTrackingHandle,
  ManagedRunnerWorkerRole,
  RunSnapshot,
  SupervisorDecisionName,
  SupervisorRuntimeProfile,
  WorkerRole,
} from './types.js';

type ManagedRunnerAdapterDocument = {
  kind: ManagedRunnerAdapterKind;
};

type ManagedRunnerLaunchBundle = {
  launchRequest: ManagedRunnerLaunchRequest;
  launchRequestPath: string;
  launchArtifact: ManagedRunnerLaunchArtifact;
  launchArtifactPath: string;
  providerAdapterPath: string;
  contractPath: string;
  resultArtifactPath: string;
};

function sanitizeSegment(value: string | null | undefined, fallback: string): string {
  return (value ?? fallback).replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || fallback;
}

function resolveMilestone(snapshot: RunSnapshot, milestoneId: string | null = snapshot.currentMilestoneId) {
  if (!milestoneId) {
    return null;
  }

  return snapshot.milestones.find((candidate) => candidate.id === milestoneId) ?? null;
}

function inferDecisionName(snapshot: RunSnapshot, workerRole: ManagedRunnerWorkerRole): SupervisorDecisionName {
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

function resolveContractKind(workerRole: ManagedRunnerWorkerRole): ManagedRunnerContractKind {
  if (workerRole === 'planner') {
    return 'planner.request';
  }

  if (workerRole === 'recovery') {
    return 'recovery.plan';
  }

  if (workerRole === 'verifier') {
    return 'verification.command';
  }

  return 'implementer.contract';
}

function createLaunchId(runId: string, workerRole: ManagedRunnerWorkerRole, milestoneId: string | null, provider: ManagedRunnerProvider): string {
  const requestedAt = new Date().toISOString().replace(/[:.]/gu, '-').toLowerCase();
  return sanitizeSegment(`${runId}-${workerRole}-${milestoneId ?? 'run'}-${provider}-${requestedAt}`, 'managed-runner');
}

export function resolveManagedRunnerProvider(backend: BackendKind): ManagedRunnerProvider | null {
  if (backend === 'openclaw') {
    return 'openclaw';
  }

  if (backend === 'codex-cli') {
    return 'codex';
  }

  if (backend === 'claude-code') {
    return 'claude-code';
  }

  return null;
}

function getManagedRunnerProvider(snapshot: RunSnapshot, workerRole: ManagedRunnerWorkerRole, provider?: ManagedRunnerProvider): ManagedRunnerProvider {
  if (provider) {
    return provider;
  }

  const backend = resolveBackendConfiguration(snapshot)[workerRole].backend;
  const resolvedProvider = resolveManagedRunnerProvider(backend);

  if (!resolvedProvider) {
    throw new Error(`Worker role ${workerRole} uses backend ${backend}, which is not a managed-runner provider`);
  }

  return resolvedProvider;
}

function writeManagedRunnerJson<T extends object>(outputPath: string, document: T): string {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}

function withArtifactPath<T extends { artifactPath: string | null }>(document: T, artifactPath: string): T {
  return {
    ...document,
    artifactPath,
  };
}

export function writeManagedRunnerLaunchArtifact(outputPath: string, artifact: ManagedRunnerLaunchArtifact): string {
  const resolvedOutputPath = writeManagedRunnerJson(outputPath, withArtifactPath(artifact, path.resolve(outputPath)));
  return resolvedOutputPath;
}

export function readManagedRunnerLaunchArtifact(inputPath: string): ManagedRunnerLaunchArtifact {
  const resolvedInputPath = path.resolve(inputPath);
  return JSON.parse(readFileSync(resolvedInputPath, 'utf8')) as ManagedRunnerLaunchArtifact;
}

export function writeManagedRunnerResultArtifact(outputPath: string, artifact: ManagedRunnerResultArtifact): string {
  const resolvedOutputPath = writeManagedRunnerJson(outputPath, withArtifactPath(artifact, path.resolve(outputPath)));
  return resolvedOutputPath;
}

export function readManagedRunnerResultArtifact(inputPath: string): ManagedRunnerResultArtifact {
  const resolvedInputPath = path.resolve(inputPath);
  return JSON.parse(readFileSync(resolvedInputPath, 'utf8')) as ManagedRunnerResultArtifact;
}

function writeContractForWorker(
  snapshot: RunSnapshot,
  workerRole: ManagedRunnerWorkerRole,
  outputPath: string,
  options: {
    milestoneId?: string;
    verificationCommand?: string;
    healthOptions?: { now?: string; stallThresholdMinutes?: number };
  } = {},
) {
  const milestone = resolveMilestone(snapshot, options.milestoneId ?? snapshot.currentMilestoneId);

  if (workerRole === 'planner') {
    const document = createPlannerRequest(snapshot, {
      requestedMode: snapshot.planState.status === 'needs-plan' ? 'plan' : 'replan',
    });
    const contractPath = writeContractDocument(outputPath, document);
    return {
      kind: document.kind as ManagedRunnerContractKind,
      path: contractPath,
    };
  }

  if (workerRole === 'recovery') {
    const document = createRecoveryPlan(snapshot, evaluateRunHealth(snapshot, options.healthOptions));
    const contractPath = writeRecoveryPlan(outputPath, document);
    return {
      kind: document.kind as ManagedRunnerContractKind,
      path: contractPath,
    };
  }

  if (workerRole === 'verifier') {
    const document = createVerificationCommand(snapshot, {
      milestoneId: milestone?.id ?? undefined,
      command: options.verificationCommand,
    });
    const contractPath = writeVerificationDocument(outputPath, document);
    return {
      kind: document.kind as ManagedRunnerContractKind,
      path: contractPath,
    };
  }

  const document = createImplementerContract(snapshot, milestone);
  const contractPath = writeContractDocument(outputPath, document);
  return {
    kind: document.kind as ManagedRunnerContractKind,
    path: contractPath,
  };
}

function writeProviderAdapter(
  snapshot: RunSnapshot,
  provider: ManagedRunnerProvider,
  outputPath: string,
  options: {
    worker: ManagedRunnerWorkerRole;
    milestoneId?: string;
    runtime?: string;
    runtimeProfile: SupervisorRuntimeProfile;
    verificationCommand?: string;
    healthOptions?: { now?: string; stallThresholdMinutes?: number };
    backendCheck?: BackendCheckResultDocument;
  },
) {
  if (provider === 'openclaw') {
    const document = createSessionSpawnAdapter(snapshot, {
      worker: options.worker,
      milestoneId: options.milestoneId,
      runtime: options.runtime,
      runtimeProfile: options.runtimeProfile,
      healthOptions: options.healthOptions,
      backendCheck: options.backendCheck,
    });
    const providerAdapterPath = writeOpenClawAdapter(outputPath, document);
    return {
      kind: document.kind as ManagedRunnerAdapterKind,
      path: providerAdapterPath,
    };
  }

  if (provider === 'codex') {
    const document = createCodexCliExecAdapter(snapshot, {
      worker: options.worker,
      milestoneId: options.milestoneId,
      runtimeProfile: options.runtimeProfile,
      healthOptions: options.healthOptions,
      backendCheck: options.backendCheck,
    });
    const providerAdapterPath = writeBackendAdapter(outputPath, document);
    return {
      kind: document.kind as ManagedRunnerAdapterKind,
      path: providerAdapterPath,
    };
  }

  const document = createClaudeCodeExecAdapter(snapshot, {
    worker: options.worker,
    milestoneId: options.milestoneId,
    runtimeProfile: options.runtimeProfile,
    healthOptions: options.healthOptions,
    backendCheck: options.backendCheck,
  });
  const providerAdapterPath = writeBackendAdapter(outputPath, document);
  return {
    kind: document.kind as ManagedRunnerAdapterKind,
    path: providerAdapterPath,
  };
}

function createArtifactRefs(refs: Array<[label: string, pathValue: string | null]>): ManagedRunnerArtifactReference[] {
  return refs
    .filter(([, pathValue]) => Boolean(pathValue))
    .map(([label, pathValue]) => ({
      label,
      path: path.resolve(pathValue!),
    }));
}

export function createManagedRunnerLaunchArtifact(
  snapshot: RunSnapshot,
  {
    launchId,
    worker,
    provider,
    contract,
    adapter,
    resultPath,
    runtimeProfile,
    summary,
  }: {
    launchId: string;
    worker: { role: ManagedRunnerWorkerRole; label: RunSnapshot['workers'][WorkerRole] };
    provider: ManagedRunnerProvider;
    contract: { kind: ManagedRunnerContractKind; path: string };
    adapter: { kind: ManagedRunnerAdapterKind; path: string };
    resultPath: string;
    runtimeProfile: SupervisorRuntimeProfile;
    summary: string;
  },
): ManagedRunnerLaunchArtifact {
  const milestone = resolveMilestone(snapshot, snapshot.currentMilestoneId);

  return {
    schemaVersion: 1,
    kind: 'managed-runner.launch',
    artifactPath: null,
    launchId,
    runId: snapshot.runId,
    milestoneId: milestone?.id ?? null,
    provider,
    worker,
    status: 'launching',
    outcome: null,
    requestedAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    tracking: null,
    contract,
    adapter,
    resultPath: path.resolve(resultPath),
    stdoutPath: null,
    stderrPath: null,
    runtimeProfile,
    summary,
    artifacts: createArtifactRefs([
      ['contract', contract.path],
      ['provider-adapter', adapter.path],
      ['result', resultPath],
    ]),
    metadata: {
      repoPath: snapshot.repoPath,
      planPath: snapshot.planPath,
      snapshotPath: snapshot.snapshotPath ?? null,
      eventLogPath: snapshot.eventLogPath ?? null,
    },
  };
}

export function createManagedRunnerLaunchRequest(artifact: ManagedRunnerLaunchArtifact): ManagedRunnerLaunchRequest {
  if (!artifact.contract.path || !artifact.adapter.path || !artifact.resultPath) {
    throw new Error(`Managed-runner launch ${artifact.launchId} is missing required artifact paths`);
  }

  return {
    schemaVersion: 1,
    kind: 'managed-runner.launch-request',
    generatedAt: new Date().toISOString(),
    launchId: artifact.launchId,
    runId: artifact.runId,
    milestoneId: artifact.milestoneId,
    provider: artifact.provider,
    worker: artifact.worker,
    runtimeProfile: artifact.runtimeProfile,
    launchArtifactPath: artifact.artifactPath ?? '',
    resultArtifactPath: artifact.resultPath,
    contract: {
      kind: artifact.contract.kind,
      path: artifact.contract.path,
    },
    adapter: {
      kind: artifact.adapter.kind,
      path: artifact.adapter.path,
    },
    instructions: [
      `Launch exactly one ${artifact.provider} worker for ${artifact.worker.label}.`,
      'Record the tracked handle before treating the worker as running.',
      'Write the normalized terminal result when the worker completes, fails, times out, or is cancelled.',
      'Do not treat worker completion as milestone completion; verification and milestone transition remain separate.',
    ],
  };
}

export function createManagedRunnerResultArtifact(
  launchArtifact: ManagedRunnerLaunchArtifact,
  {
    outcome,
    exitCode,
    endedAt,
    status = 'finished',
    tracking,
    startedAt,
    stdoutPath,
    stderrPath,
    summary,
    artifacts = [],
  }: {
    outcome: ManagedRunnerOutcome;
    exitCode?: number | null;
    endedAt?: string;
    status?: ManagedRunnerResultArtifact['status'];
    tracking?: ManagedRunnerTrackingHandle | null;
    startedAt?: string | null;
    stdoutPath?: string | null;
    stderrPath?: string | null;
    summary?: string | null;
    artifacts?: ManagedRunnerArtifactReference[];
  },
): ManagedRunnerResultArtifact {
  return {
    schemaVersion: 1,
    kind: 'managed-runner.result',
    artifactPath: null,
    launchId: launchArtifact.launchId,
    runId: launchArtifact.runId,
    milestoneId: launchArtifact.milestoneId,
    provider: launchArtifact.provider,
    worker: launchArtifact.worker,
    status,
    outcome,
    exitCode: exitCode ?? null,
    startedAt: startedAt ?? launchArtifact.startedAt ?? launchArtifact.requestedAt,
    endedAt: endedAt ?? new Date().toISOString(),
    tracking: tracking ?? launchArtifact.tracking,
    launchPath: launchArtifact.artifactPath,
    stdoutPath: stdoutPath ?? launchArtifact.stdoutPath,
    stderrPath: stderrPath ?? launchArtifact.stderrPath,
    summary: summary ?? launchArtifact.summary,
    artifacts,
    metadata: {
      resultPath: launchArtifact.resultPath,
    },
  };
}

export function updateManagedRunnerLaunchArtifact(
  launchArtifact: ManagedRunnerLaunchArtifact,
  {
    status,
    outcome,
    tracking,
    startedAt,
    endedAt,
    stdoutPath,
    stderrPath,
    summary,
    artifacts,
  }: {
    status?: ManagedRunnerLaunchArtifact['status'];
    outcome?: ManagedRunnerLaunchArtifact['outcome'];
    tracking?: ManagedRunnerTrackingHandle | null;
    startedAt?: string | null;
    endedAt?: string | null;
    stdoutPath?: string | null;
    stderrPath?: string | null;
    summary?: string | null;
    artifacts?: ManagedRunnerArtifactReference[];
  },
): ManagedRunnerLaunchArtifact {
  return {
    ...launchArtifact,
    status: status ?? launchArtifact.status,
    outcome: outcome ?? launchArtifact.outcome,
    tracking: tracking ?? launchArtifact.tracking,
    startedAt: startedAt ?? launchArtifact.startedAt ?? (status === 'running' ? new Date().toISOString() : null),
    endedAt: endedAt ?? launchArtifact.endedAt,
    stdoutPath: stdoutPath ?? launchArtifact.stdoutPath,
    stderrPath: stderrPath ?? launchArtifact.stderrPath,
    summary: summary ?? launchArtifact.summary,
    artifacts: artifacts ?? launchArtifact.artifacts,
  };
}

export function writeManagedRunnerLaunchBundle(
  outputDir: string,
  snapshot: RunSnapshot,
  options: {
    worker?: ManagedRunnerWorkerRole;
    milestoneId?: string;
    provider?: ManagedRunnerProvider;
    runtime?: string;
    runtimeProfile?: SupervisorRuntimeProfile;
    verificationCommand?: string;
    healthOptions?: { now?: string; stallThresholdMinutes?: number };
    backendCheck?: BackendCheckResultDocument;
  } = {},
): ManagedRunnerLaunchBundle {
  const workerRole = options.worker ?? 'implementer';
  const provider = getManagedRunnerProvider(snapshot, workerRole, options.provider);
  const milestone = resolveMilestone(snapshot, options.milestoneId ?? snapshot.currentMilestoneId);
  const runtimeProfile = options.runtimeProfile ?? selectSupervisorRuntimeProfile(snapshot, inferDecisionName(snapshot, workerRole), milestone);
  const resolvedOutputDir = path.resolve(outputDir);
  const launchId = createLaunchId(snapshot.runId, workerRole, milestone?.id ?? null, provider);
  const baseName = sanitizeSegment(`${launchId}`, 'managed-runner');
  const contractKind = resolveContractKind(workerRole);
  const contractExtension = contractKind.replace(/\./gu, '-');
  const providerBaseName = provider === 'codex' ? 'codex' : provider;
  const contractPath = path.join(resolvedOutputDir, `${baseName}.${contractExtension}.json`);
  const providerAdapterPath = path.join(resolvedOutputDir, `${baseName}.${providerBaseName}.adapter.json`);
  const launchArtifactPath = path.join(resolvedOutputDir, `${baseName}.managed-runner-launch.json`);
  const resultArtifactPath = path.join(resolvedOutputDir, `${baseName}.managed-runner-result.json`);
  const launchRequestPath = path.join(resolvedOutputDir, `${baseName}.managed-runner-request.json`);
  const contract = writeContractForWorker(snapshot, workerRole, contractPath, {
    milestoneId: milestone?.id ?? undefined,
    verificationCommand: options.verificationCommand,
    healthOptions: options.healthOptions,
  });
  const adapter = writeProviderAdapter(snapshot, provider, providerAdapterPath, {
    worker: workerRole,
    milestoneId: milestone?.id ?? undefined,
    runtime: options.runtime,
    runtimeProfile,
    verificationCommand: options.verificationCommand,
    healthOptions: options.healthOptions,
    backendCheck: options.backendCheck,
  });
  const summary = milestone
    ? `Launch ${workerRole} work for milestone ${milestone.id} through the ${provider} managed runner.`
    : `Launch ${workerRole} work through the ${provider} managed runner.`;
  const launchArtifact = createManagedRunnerLaunchArtifact(snapshot, {
    launchId,
    worker: {
      role: workerRole,
      label: snapshot.workers[workerRole],
    },
    provider,
    contract,
    adapter,
    resultPath: resultArtifactPath,
    runtimeProfile,
    summary,
  });
  const writtenLaunchArtifactPath = writeManagedRunnerLaunchArtifact(launchArtifactPath, launchArtifact);
  const launchRequest = createManagedRunnerLaunchRequest({
    ...launchArtifact,
    artifactPath: writtenLaunchArtifactPath,
  });
  const writtenLaunchRequestPath = writeManagedRunnerJson(launchRequestPath, launchRequest);

  return {
    launchRequest,
    launchRequestPath: writtenLaunchRequestPath,
    launchArtifact: {
      ...launchArtifact,
      artifactPath: writtenLaunchArtifactPath,
    },
    launchArtifactPath: writtenLaunchArtifactPath,
    providerAdapterPath: adapter.path,
    contractPath: contract.path,
    resultArtifactPath: path.resolve(resultArtifactPath),
  };
}

export function getLatestManagedRunnerLaunch(snapshot: RunSnapshot, workerRole?: ManagedRunnerWorkerRole, milestoneId?: string | null) {
  return [...snapshot.managedRunners.launches]
    .reverse()
    .find((launch) => (workerRole ? launch.worker.role === workerRole : true) && (milestoneId === undefined ? true : launch.milestoneId === milestoneId)) ?? null;
}

export function getLatestManagedRunnerResult(snapshot: RunSnapshot, workerRole?: ManagedRunnerWorkerRole, milestoneId?: string | null) {
  return [...snapshot.managedRunners.results]
    .reverse()
    .find((result) => (workerRole ? result.worker.role === workerRole : true) && (milestoneId === undefined ? true : result.milestoneId === milestoneId)) ?? null;
}

export function getActiveManagedRunnerLaunch(snapshot: RunSnapshot, workerRole?: ManagedRunnerWorkerRole, milestoneId?: string | null) {
  return [...snapshot.managedRunners.launches]
    .reverse()
    .find((launch) => {
      if (workerRole && launch.worker.role !== workerRole) {
        return false;
      }

      if (milestoneId !== undefined && launch.milestoneId !== milestoneId) {
        return false;
      }

      const matchingResult = snapshot.managedRunners.results.find((result) => result.launchId === launch.launchId);
      return !matchingResult && launch.status !== 'finished';
    }) ?? null;
}

export function summarizeManagedRunnerState(snapshot: RunSnapshot, workerRole: ManagedRunnerWorkerRole, milestoneId: string | null = snapshot.currentMilestoneId) {
  const launch = getLatestManagedRunnerLaunch(snapshot, workerRole, milestoneId);
  const result = getLatestManagedRunnerResult(snapshot, workerRole, milestoneId);

  return {
    launch,
    result,
  };
}
