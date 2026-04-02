import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import type {
  BackendCheckNextAction,
  BackendCheckResultDocument,
  BackendConfiguration,
  BackendHealthProbe,
  BackendKind,
  BackendProbeStatus,
  RunSnapshot,
  WorkerBackendConfig,
  WorkerRole,
} from './types.js';

const DEFAULT_SUPPORTED_BACKENDS: Record<WorkerRole, BackendKind[]> = {
  planner: ['openclaw', 'codex-cli', 'claude-code'],
  implementer: ['openclaw', 'codex-cli', 'claude-code'],
  recovery: ['openclaw', 'codex-cli', 'claude-code'],
  verifier: ['openclaw', 'codex-cli', 'claude-code'],
  watchdog: ['openclaw', 'laizy-watchdog'],
};

const backendCheckCache = new Map<string, BackendCheckResultDocument>();

type BackendConfigurationOverride = Partial<Record<WorkerRole, BackendKind | Partial<WorkerBackendConfig>>>;

function defaultBackendKindForRole(role: WorkerRole): BackendKind {
  return role === 'watchdog' ? 'laizy-watchdog' : 'openclaw';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertBackendKind(role: WorkerRole, backend: string): asserts backend is BackendKind {
  if (!DEFAULT_SUPPORTED_BACKENDS[role].includes(backend as BackendKind)) {
    throw new Error(`Unsupported backend ${backend} for role ${role}. Supported backends: ${DEFAULT_SUPPORTED_BACKENDS[role].join(', ')}`);
  }
}

function normalizeWorkerBackendConfig(
  role: WorkerRole,
  input: BackendKind | Partial<WorkerBackendConfig> | undefined,
  baseConfig: WorkerBackendConfig,
): WorkerBackendConfig {
  if (!input) {
    return clone(baseConfig);
  }

  if (typeof input === 'string') {
    assertBackendKind(role, input);
    return {
      ...clone(baseConfig),
      role,
      backend: input,
      supportedBackends: [...DEFAULT_SUPPORTED_BACKENDS[role]],
    } satisfies WorkerBackendConfig;
  }

  const backend = typeof input.backend === 'string' ? input.backend : baseConfig.backend;
  assertBackendKind(role, backend);
  const supportedBackends = Array.isArray(input.supportedBackends) && input.supportedBackends.length > 0
    ? input.supportedBackends
    : baseConfig.supportedBackends;

  for (const supportedBackend of supportedBackends) {
    assertBackendKind(role, supportedBackend);
  }

  return {
    role,
    backend,
    supportedBackends: [...supportedBackends],
    preferredRuntime: typeof input.preferredRuntime === 'string' || input.preferredRuntime === null
      ? input.preferredRuntime
      : baseConfig.preferredRuntime,
  } satisfies WorkerBackendConfig;
}

export function mergeBackendConfiguration(
  baseConfiguration: BackendConfiguration,
  overrides: BackendConfigurationOverride = {},
): BackendConfiguration {
  return {
    planner: normalizeWorkerBackendConfig('planner', overrides.planner, baseConfiguration.planner),
    implementer: normalizeWorkerBackendConfig('implementer', overrides.implementer, baseConfiguration.implementer),
    recovery: normalizeWorkerBackendConfig('recovery', overrides.recovery, baseConfiguration.recovery),
    verifier: normalizeWorkerBackendConfig('verifier', overrides.verifier, baseConfiguration.verifier),
    watchdog: normalizeWorkerBackendConfig('watchdog', overrides.watchdog, baseConfiguration.watchdog),
  } satisfies BackendConfiguration;
}

export function createDefaultBackendConfiguration(): BackendConfiguration {
  return {
    planner: {
      role: 'planner',
      backend: defaultBackendKindForRole('planner'),
      supportedBackends: DEFAULT_SUPPORTED_BACKENDS.planner,
      preferredRuntime: 'subagent',
    },
    implementer: {
      role: 'implementer',
      backend: defaultBackendKindForRole('implementer'),
      supportedBackends: DEFAULT_SUPPORTED_BACKENDS.implementer,
      preferredRuntime: 'subagent',
    },
    recovery: {
      role: 'recovery',
      backend: defaultBackendKindForRole('recovery'),
      supportedBackends: DEFAULT_SUPPORTED_BACKENDS.recovery,
      preferredRuntime: 'subagent',
    },
    verifier: {
      role: 'verifier',
      backend: defaultBackendKindForRole('verifier'),
      supportedBackends: DEFAULT_SUPPORTED_BACKENDS.verifier,
      preferredRuntime: 'subagent',
    },
    watchdog: {
      role: 'watchdog',
      backend: defaultBackendKindForRole('watchdog'),
      supportedBackends: DEFAULT_SUPPORTED_BACKENDS.watchdog,
      preferredRuntime: 'subagent',
    },
  };
}

export function resolveBackendConfiguration(
  snapshot: Pick<RunSnapshot, 'backends'>,
  overrides: BackendConfigurationOverride = {},
): BackendConfiguration {
  const baseConfiguration = snapshot.backends ?? createDefaultBackendConfiguration();
  return mergeBackendConfiguration(baseConfiguration, overrides);
}

function createProbe(name: BackendHealthProbe['name'], status: BackendHealthProbe['status'], detail: string, command: string | null) {
  return {
    name,
    status,
    detail,
    command,
    checkedAt: new Date().toISOString(),
  } satisfies BackendHealthProbe;
}

function execProbe(
  name: BackendHealthProbe['name'],
  detail: string,
  command: string,
  args: string[] = [],
  options: { timeoutMs?: number; useShell?: boolean } = {},
): BackendHealthProbe {
  const timeoutMs = Number(options.timeoutMs ?? 5000);
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const spawnOptions = {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: options.useShell ?? false,
  } as const;
  let result = spawnSync('/usr/bin/timeout', [
    '--signal=TERM',
    '--kill-after=1s',
    `${timeoutSeconds}s`,
    command,
    ...args,
  ], spawnOptions);

  const timeoutErrorCode = result.error && 'code' in result.error && typeof result.error.code === 'string'
    ? result.error.code
    : null;

  // Some restricted runtimes disallow `/usr/bin/timeout` even when the actual probe command is allowed.
  // Fall back to a direct spawn so preflight can still report the backend's real behavior.
  if (timeoutErrorCode === 'EPERM' || timeoutErrorCode === 'ENOENT') {
    result = spawnSync(command, args, spawnOptions);
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  if (result.status === 0 && !result.signal) {
    return createProbe(
      name,
      'passed',
      output ? `${detail} Output: ${output}` : detail,
      [command, ...args].join(' '),
    );
  }

  if (result.error) {
    const errorCode = 'code' in result.error && typeof result.error.code === 'string'
      ? result.error.code
      : null;
    const timeoutDetail = errorCode === 'ETIMEDOUT'
      ? ` Timed out after ${timeoutMs}ms.`
      : '';
    const errorDetail = `${detail}${timeoutDetail} ${result.error.message}`.trim();
    return createProbe(name, 'failed', output ? `${errorDetail} Output: ${output}` : errorDetail, [command, ...args].join(' '));
  }

  if (result.signal) {
    const signalDetail = `${detail} Probe exited via signal ${result.signal}${result.status === null ? ` after ${timeoutMs}ms timeout or forced termination.` : '.'}`;
    return createProbe(name, 'failed', output ? `${signalDetail} Output: ${output}` : signalDetail, [command, ...args].join(' '));
  }

  if (result.status === 124) {
    const timeoutDetail = `${detail} Timed out after ${timeoutMs}ms.`;
    return createProbe(name, 'failed', output ? `${timeoutDetail} Output: ${output}` : timeoutDetail, [command, ...args].join(' '));
  }

  return createProbe(name, 'failed', output ? `${detail} Output: ${output}` : detail, [command, ...args].join(' '));
}

function readablePathProbe(name: BackendHealthProbe['name'], detail: string, targetPath: string | null, command: string | null): BackendHealthProbe {
  if (!targetPath) {
    return createProbe(name, 'failed', `${detail} Missing required path.`, command);
  }

  try {
    accessSync(targetPath, constants.R_OK);
    return createProbe(name, 'passed', `${detail} Path is readable: ${targetPath}`, command);
  } catch (error) {
    return createProbe(
      name,
      'failed',
      `${detail} ${error instanceof Error ? error.message : String(error)}`,
      command,
    );
  }
}

const OUTPUT_MARKER = ' Output: ';

function truncateSummaryText(value: string, maxLength = 160): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1).trimEnd()}…`
    : value;
}

function summarizeProbeOutput(output: string | null): string | null {
  if (!output) {
    return null;
  }

  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const primaryLine = lines.find((line) => /[\p{L}\p{N}]/u.test(line)) ?? lines[0];
  const extraLineCount = Math.max(0, lines.length - 1);
  const preview = truncateSummaryText(primaryLine.replace(/\s+/gu, ' '));
  return extraLineCount > 0 ? `${preview} (+${extraLineCount} more lines)` : preview;
}

function summarizeProbeDetail(detail: string): { detail: string; outputPreview: string | null } {
  const outputIndex = detail.indexOf(OUTPUT_MARKER);

  if (outputIndex === -1) {
    return {
      detail: truncateSummaryText(detail.replace(/\s+/gu, ' ').trim()),
      outputPreview: null,
    };
  }

  const detailSummary = detail.slice(0, outputIndex).replace(/\s+/gu, ' ').trim();
  const output = detail.slice(outputIndex + OUTPUT_MARKER.length).trim();
  return {
    detail: truncateSummaryText(detailSummary),
    outputPreview: summarizeProbeOutput(output),
  };
}

function createOpenClawProbes(snapshot: RunSnapshot): BackendHealthProbe[] {
  return [
    execProbe('installation', 'Verified the openclaw CLI is installed.', '/usr/bin/env', ['bash', '-lc', 'command -v openclaw'], { timeoutMs: 1000 }),
    execProbe('invocation', 'Verified the openclaw CLI responds to help output.', 'openclaw', ['help'], { timeoutMs: 6000 }),
    execProbe(
      'liveness',
      'Verified the OpenClaw gateway status command responds on this machine.',
      'openclaw',
      ['gateway', 'status'],
      { timeoutMs: 5000 },
    ),
  ];
}

function createCodexCliProbes(): BackendHealthProbe[] {
  return [
    execProbe('installation', 'Verified the codex CLI is installed.', '/usr/bin/env', ['bash', '-lc', 'command -v codex'], { timeoutMs: 1000 }),
    execProbe('invocation', 'Verified the codex CLI responds to general help output.', 'codex', ['--help'], { timeoutMs: 1500 }),
    execProbe('liveness', 'Verified the codex exec entrypoint is callable.', 'codex', ['exec', '--help'], { timeoutMs: 1000 }),
  ];
}

function createClaudeCodeProbes(): BackendHealthProbe[] {
  return [
    execProbe('installation', 'Verified the claude CLI is installed.', '/usr/bin/env', ['bash', '-lc', 'command -v claude'], { timeoutMs: 1000 }),
    execProbe('invocation', 'Verified the claude CLI responds to help output.', 'claude', ['--help'], { timeoutMs: 1500 }),
    execProbe('liveness', 'Verified the claude CLI can answer a lightweight version call.', 'claude', ['--version'], { timeoutMs: 1000 }),
  ];
}

function createLaizyWatchdogProbes(snapshot: RunSnapshot): BackendHealthProbe[] {
  return [
    execProbe('installation', 'Verified the laizy CLI is installed.', '/usr/bin/env', ['bash', '-lc', 'command -v laizy'], { timeoutMs: 1000 }),
    execProbe('invocation', 'Verified the laizy CLI responds to help output.', 'laizy', ['help'], { timeoutMs: 1500 }),
    readablePathProbe(
      'liveness',
      'Verified the watchdog can resolve the active run snapshot path.',
      snapshot.snapshotPath ?? null,
      snapshot.snapshotPath ? `test -r ${JSON.stringify(snapshot.snapshotPath)}` : null,
    ),
  ];
}

function createBackendProbes(snapshot: RunSnapshot, backend: BackendKind): BackendHealthProbe[] {
  if (backend === 'openclaw') {
    return createOpenClawProbes(snapshot);
  }

  if (backend === 'codex-cli') {
    return createCodexCliProbes();
  }

  if (backend === 'claude-code') {
    return createClaudeCodeProbes();
  }

  return createLaizyWatchdogProbes(snapshot);
}

function createProbeStatusCounts(probes: BackendHealthProbe[]): Record<BackendProbeStatus, number> {
  return probes.reduce<Record<BackendProbeStatus, number>>((counts, probe) => {
    counts[probe.status] += 1;
    return counts;
  }, {
    'not-run': 0,
    'not-applicable': 0,
    passed: 0,
    failed: 0,
  });
}

function nextActionForProbe(probe: BackendHealthProbe): BackendCheckNextAction {
  if (probe.name === 'installation') {
    return 'install-or-expose-backend';
  }

  if (probe.name === 'invocation') {
    return 'repair-backend-invocation';
  }

  if (probe.name === 'liveness') {
    return 'restore-backend-liveness';
  }

  return 'inspect-failed-probes';
}

function nextActionForFailedProbes(failedProbes: BackendHealthProbe[]): BackendCheckNextAction {
  if (failedProbes.length === 0) {
    return 'proceed-to-handoff';
  }

  if (failedProbes.some((probe) => probe.name === 'installation')) {
    return 'install-or-expose-backend';
  }

  if (failedProbes.some((probe) => probe.name === 'invocation')) {
    return 'repair-backend-invocation';
  }

  if (failedProbes.some((probe) => probe.name === 'liveness')) {
    return 'restore-backend-liveness';
  }

  return 'inspect-failed-probes';
}

function createBackendCheckSummary(
  snapshot: RunSnapshot,
  role: WorkerRole,
  configuration: WorkerBackendConfig,
  probes: BackendHealthProbe[],
  overallStatus: BackendCheckResultDocument['overallStatus'],
): BackendCheckResultDocument['summary'] {
  const workerLabel = snapshot.workers[role];
  const failedProbes = probes.filter((probe) => probe.status === 'failed');
  const failedProbeNames = failedProbes.map((probe) => probe.name);
  const nextAction = nextActionForFailedProbes(failedProbes);
  const handoffStatus = overallStatus === 'healthy' ? 'ready' : 'blocked';
  const failedProbeList = failedProbeNames.length > 0 ? failedProbeNames.join(', ') : 'none';
  const probeStatusCounts = createProbeStatusCounts(probes);
  const probeSummaries = probes.map((probe) => {
    const summarizedDetail = summarizeProbeDetail(probe.detail);
    return {
      name: probe.name,
      status: probe.status,
      detail: summarizedDetail.detail,
      outputPreview: summarizedDetail.outputPreview,
      command: probe.command,
      nextAction: probe.status === 'failed' ? nextActionForProbe(probe) : 'proceed-to-handoff',
    };
  });

  const operatorMessage = failedProbes.length === 0
    ? `Backend preflight passed for ${role} worker ${workerLabel} using ${configuration.backend}. Safe to hand off bounded work.`
    : `Backend preflight blocked ${role} worker ${workerLabel} using ${configuration.backend}. Failed probes: ${failedProbeList}. Fix the reported backend issue before worker handoff.`;
  const headline = failedProbes.length === 0
    ? `${workerLabel} (${role}) is ready on ${configuration.backend}; ${probeStatusCounts.passed}/${probes.length} probes passed.`
    : `${workerLabel} (${role}) is blocked on ${configuration.backend}; failed probes: ${failedProbeList}.`;

  return {
    handoffStatus,
    headline,
    operatorMessage,
    nextAction,
    failedProbeCount: failedProbes.length,
    failedProbeNames,
    probeStatusCounts,
    probes: probeSummaries,
    failedProbes: probeSummaries.filter((probe) => probe.status === 'failed'),
  };
}

export function createBackendCheckResult(
  snapshot: RunSnapshot,
  role: WorkerRole,
  options: { outputPath?: string } = {},
): BackendCheckResultDocument {
  const configuration = resolveBackendConfiguration(snapshot)[role];
  const cacheKey = JSON.stringify({
    runId: snapshot.runId,
    role,
    backend: configuration.backend,
    snapshotPath: snapshot.snapshotPath ?? null,
    updatedAt: snapshot.updatedAt,
  });
  const cached = backendCheckCache.get(cacheKey);

  if (cached) {
    const cachedDocument = clone(cached);
    cachedDocument.outputPath = options.outputPath ?? null;
    return cachedDocument;
  }

  const probes = createBackendProbes(snapshot, configuration.backend);
  const overallStatus = probes.every((probe) => probe.status === 'passed' || probe.status === 'not-applicable')
    ? 'healthy'
    : probes.some((probe) => probe.status === 'failed')
      ? 'unhealthy'
      : 'unknown';

  const document = {
    schemaVersion: 1,
    kind: 'backend.check-result',
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    repoPath: snapshot.repoPath,
    planPath: snapshot.planPath,
    snapshotPath: snapshot.snapshotPath ?? null,
    eventLogPath: snapshot.eventLogPath ?? null,
    worker: {
      role,
      label: snapshot.workers[role],
    },
    backend: configuration,
    overallStatus,
    probes,
    summary: createBackendCheckSummary(snapshot, role, configuration, probes, overallStatus),
    outputPath: options.outputPath ?? null,
  } satisfies BackendCheckResultDocument;

  backendCheckCache.set(cacheKey, clone({ ...document, outputPath: null }));
  return document;
}

export function summarizeBackendCheckFailures(document: BackendCheckResultDocument): string {
  if (document.summary.failedProbes.length === 0) {
    return document.summary.headline;
  }

  return document.summary.failedProbes
    .map((probe) => {
      const preview = probe.outputPreview ? ` outputPreview=${JSON.stringify(probe.outputPreview)}` : '';
      return `${probe.name}: ${probe.detail}${preview} (nextAction=${probe.nextAction})`;
    })
    .join(' | ');
}

export function assertHealthyBackendCheck(document: BackendCheckResultDocument, options: { context?: string } = {}): BackendCheckResultDocument {
  if (document.overallStatus === 'healthy') {
    return document;
  }

  const context = options.context ? `${options.context}: ` : '';
  throw new Error(
    `${context}${document.summary.operatorMessage} Primary next action: ${document.summary.nextAction}. Artifact: ${document.outputPath ?? 'no output path'}. ${summarizeBackendCheckFailures(document)}`,
  );
}

export function writeBackendCheckResult(outputPath: string, document: BackendCheckResultDocument): string {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
