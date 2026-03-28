import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  createVerificationResultRecord,
  hasRecordedVerificationEvidence,
} from './verification.js';

import type {
  ReviewerOutput,
  RunEvent,
  RunSnapshot,
  VerificationStatus,
  WorkerLabel,
  MilestoneStatus,
} from './types.js';

const VALID_MILESTONE_STATUSES = new Set<MilestoneStatus>([
  'planned',
  'implementing',
  'verifying',
  'completed',
  'blocked',
]);

const VALID_WORKER_NAMES = new Set<WorkerLabel>([
  'laizy-planner',
  'laizy-implementer',
  'laizy-watchdog',
  'laizy-recovery',
  'laizy-verifier',
]);

const VALID_VERIFICATION_STATUSES = new Set<VerificationStatus>([
  'pending',
  'passed',
  'failed',
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureMilestoneStatus(status: string): asserts status is MilestoneStatus {
  if (!VALID_MILESTONE_STATUSES.has(status as MilestoneStatus)) {
    throw new Error(`Invalid milestone status: ${status}`);
  }
}

function ensureWorkerName(worker: string): asserts worker is WorkerLabel {
  if (!VALID_WORKER_NAMES.has(worker as WorkerLabel)) {
    throw new Error(`Invalid worker name: ${worker}`);
  }
}

function ensureVerificationStatus(status: string): asserts status is VerificationStatus {
  if (!VALID_VERIFICATION_STATUSES.has(status as VerificationStatus)) {
    throw new Error(`Invalid verification status: ${status}`);
  }
}

function getLatestVerification(snapshot: RunSnapshot, milestoneId: string) {
  return [...snapshot.verification]
    .reverse()
    .find((record) => record.milestoneId === milestoneId) ?? null;
}

function normalizeVerificationRecord(record: RunSnapshot['verification'][number]) {
  return record.evidence
    ? record
    : {
      ...record,
      evidence: createVerificationResultRecord({
        milestoneId: record.milestoneId,
        command: record.command,
        status: record.status,
        outputPath: record.outputPath ?? undefined,
        summary: record.summary ?? undefined,
        reviewerOutput: record.reviewerOutput,
      }).evidence,
    };
}

export function summarizeEventDerivedState(snapshot: RunSnapshot) {
  const activeMilestone = snapshot.milestones.find((milestone) => milestone.id === snapshot.currentMilestoneId) ?? null;
  const latestVerification = activeMilestone ? getLatestVerification(snapshot, activeMilestone.id) : null;
  const latestRecovery = snapshot.recovery.length > 0 ? snapshot.recovery[snapshot.recovery.length - 1] : null;

  const normalizedLatestVerification = latestVerification ? normalizeVerificationRecord(latestVerification) : null;

  return {
    source: 'snapshot' as const,
    eventCount: snapshot.eventCount ?? 0,
    lastEventAt: snapshot.lastEventAt ?? null,
    activeMilestone: activeMilestone
      ? {
        id: activeMilestone.id,
        title: activeMilestone.title,
        status: activeMilestone.status,
        updatedAt: activeMilestone.updatedAt,
        lastNote: activeMilestone.lastNote,
      }
      : null,
    latestVerification: normalizedLatestVerification
      ? {
        milestoneId: normalizedLatestVerification.milestoneId,
        command: normalizedLatestVerification.command,
        status: normalizedLatestVerification.status,
        at: normalizedLatestVerification.at,
        summary: normalizedLatestVerification.summary,
        evidence: normalizedLatestVerification.evidence,
      }
      : null,
    latestRecovery: latestRecovery
      ? {
        action: latestRecovery.action,
        worker: latestRecovery.worker,
        at: latestRecovery.at,
        reason: latestRecovery.reason,
        milestoneId: latestRecovery.milestoneId,
      }
      : null,
  };
}

export function eventLogPathForSnapshot(snapshotPath: string): string {
  const resolved = path.resolve(snapshotPath);
  return resolved.endsWith('.json')
    ? resolved.replace(/\.json$/u, '.events.jsonl')
    : `${resolved}.events.jsonl`;
}

export function createRunInitializedEvent(runState: RunSnapshot): RunEvent {
  return {
    type: 'run.initialized',
    at: runState.createdAt,
    detail: {
      run: clone(runState),
    },
  };
}

export function createMilestoneTransitionEvent({ milestoneId, status, note }: { milestoneId: string; status: MilestoneStatus; note?: string }): RunEvent {
  ensureMilestoneStatus(status);

  return {
    type: 'milestone.transition',
    at: new Date().toISOString(),
    detail: {
      milestoneId,
      status,
      note: note ?? null,
    },
  };
}

export function createWorkerHeartbeatEvent({ worker, note, metadata }: { worker: WorkerLabel; note?: string; metadata?: Record<string, unknown> }): RunEvent {
  ensureWorkerName(worker);

  return {
    type: 'worker.heartbeat',
    at: new Date().toISOString(),
    detail: {
      worker,
      note: note ?? null,
      metadata: metadata ?? {},
    },
  };
}

export function createRecoveryActionEvent({
  action,
  reason,
  worker,
  milestoneId,
  note,
  source,
}: {
  action: string;
  reason: string;
  worker: WorkerLabel;
  milestoneId?: string;
  note?: string;
  source?: string;
}): RunEvent {
  ensureWorkerName(worker);

  return {
    type: 'recovery.action',
    at: new Date().toISOString(),
    detail: {
      action,
      reason,
      worker,
      milestoneId: milestoneId ?? null,
      note: note ?? null,
      source: source ?? 'manual',
    },
  };
}

export function createVerificationRecordedEvent({
  milestoneId,
  command,
  status,
  outputPath,
  summary,
  reviewerOutput,
}: {
  milestoneId: string;
  command: string;
  status: VerificationStatus;
  outputPath?: string;
  summary?: string;
  reviewerOutput?: ReviewerOutput | null;
}): RunEvent {
  ensureVerificationStatus(status);
  const record = createVerificationResultRecord({
    milestoneId,
    command,
    status,
    outputPath,
    summary,
    reviewerOutput,
  });

  return {
    type: 'verification.recorded',
    at: new Date().toISOString(),
    detail: record,
  };
}

export function appendRunEvent(eventLogPath: string, event: RunEvent): string {
  const resolvedPath = path.resolve(eventLogPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  appendFileSync(resolvedPath, `${JSON.stringify(event)}\n`, 'utf8');
  return resolvedPath;
}

export function loadRunEvents(eventLogPath: string): RunEvent[] {
  const resolvedPath = path.resolve(eventLogPath);

  if (!existsSync(resolvedPath)) {
    return [];
  }

  const lines = readFileSync(resolvedPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => JSON.parse(line) as RunEvent);
}

export function writeSnapshot(snapshotPath: string, snapshot: RunSnapshot): string {
  const resolvedPath = path.resolve(snapshotPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return resolvedPath;
}

function derivePlanState(snapshot: RunSnapshot): RunSnapshot['planState'] {
  const milestoneCount = snapshot.milestones.length;
  const completedMilestoneCount = snapshot.milestones.filter((milestone) => milestone.status === 'completed').length;
  const pendingMilestoneCount = milestoneCount - completedMilestoneCount;

  if (milestoneCount === 0) {
    return {
      status: 'needs-plan',
      reason: 'The implementation plan does not contain any actionable milestones yet.',
      milestoneCount,
      completedMilestoneCount,
      pendingMilestoneCount,
    };
  }

  if (pendingMilestoneCount === 0) {
    return {
      status: 'completed',
      reason: 'All implementation plan milestones are already completed.',
      milestoneCount,
      completedMilestoneCount,
      pendingMilestoneCount,
    };
  }

  return {
    status: 'actionable',
    reason: 'The implementation plan contains at least one incomplete milestone.',
    milestoneCount,
    completedMilestoneCount,
    pendingMilestoneCount,
  };
}

function deriveRunStatus(milestones: RunSnapshot['milestones']): RunSnapshot['status'] {
  if (milestones.every((milestone) => milestone.status === 'completed')) {
    return 'completed';
  }

  if (milestones.some((milestone) => milestone.status === 'blocked')) {
    return 'blocked';
  }

  if (milestones.some((milestone) => milestone.status === 'verifying')) {
    return 'verifying';
  }

  if (milestones.some((milestone) => milestone.status === 'implementing')) {
    return 'implementing';
  }

  return 'planned';
}

function deriveCurrentMilestoneId(milestones: RunSnapshot['milestones']): string | null {
  return milestones.find((milestone) => milestone.status !== 'completed')?.id ?? null;
}

function applyEvent(snapshot: RunSnapshot & { eventCount: number; lastEventAt: string | null }, event: RunEvent): void {
  if (event.type === 'milestone.transition') {
    const milestone = snapshot.milestones.find(
      (candidate) => candidate.id === event.detail.milestoneId,
    );

    if (!milestone) {
      throw new Error(`Unknown milestone for transition: ${String(event.detail.milestoneId)}`);
    }

    const status = String(event.detail.status);
    ensureMilestoneStatus(status);
    if (status === 'completed') {
      const latestVerification = getLatestVerification(snapshot, milestone.id);
      if (!latestVerification || latestVerification.status !== 'passed' || !hasRecordedVerificationEvidence(latestVerification)) {
        throw new Error(`Cannot complete milestone ${milestone.id} without a passed verification result and recorded evidence`);
      }
    }

    milestone.status = status;
    milestone.updatedAt = event.at;
    if (event.detail.note) {
      milestone.lastNote = String(event.detail.note);
    }
  }

  if (event.type === 'worker.heartbeat') {
    const worker = String(event.detail.worker);
    ensureWorkerName(worker);
    snapshot.workerHeartbeats[worker] = {
      worker,
      at: event.at,
      note: typeof event.detail.note === 'string' ? event.detail.note : null,
      metadata: clone((event.detail.metadata as Record<string, unknown> | undefined) ?? {}),
    };
  }

  if (event.type === 'recovery.action') {
    const worker = String(event.detail.worker);
    ensureWorkerName(worker);
    snapshot.recovery.push({
      action: String(event.detail.action),
      reason: String(event.detail.reason),
      worker,
      milestoneId: typeof event.detail.milestoneId === 'string' ? event.detail.milestoneId : null,
      note: typeof event.detail.note === 'string' ? event.detail.note : null,
      source: typeof event.detail.source === 'string' ? event.detail.source : 'manual',
      at: event.at,
    });
  }

  if (event.type === 'verification.recorded') {
    const status = String(event.detail.status);
    ensureVerificationStatus(status);
    snapshot.verification.push({
      ...createVerificationResultRecord({
        milestoneId: String(event.detail.milestoneId),
        command: String(event.detail.command),
        status,
        outputPath: typeof event.detail.outputPath === 'string' ? event.detail.outputPath : null,
        summary: typeof event.detail.summary === 'string' ? event.detail.summary : null,
        reviewerOutput: clone((event.detail.reviewerOutput as ReviewerOutput | null | undefined) ?? null),
      }),
      at: event.at,
    });
  }

  snapshot.updatedAt = event.at;
  snapshot.lastEventAt = event.at;
  snapshot.eventCount += 1;
  snapshot.currentMilestoneId = deriveCurrentMilestoneId(snapshot.milestones);
  snapshot.status = deriveRunStatus(snapshot.milestones);
  snapshot.planState = derivePlanState(snapshot);
}

export function materializeRunSnapshot(
  events: RunEvent[],
  { snapshotPath, eventLogPath }: { snapshotPath?: string; eventLogPath?: string } = {},
): RunSnapshot & { eventCount: number; lastEventAt: string | null } {
  const initialized = events.find((event) => event.type === 'run.initialized');

  if (!initialized) {
    throw new Error('Missing run.initialized event in event log');
  }

  const seed = clone(initialized.detail.run as RunSnapshot);
  const snapshot: RunSnapshot & { eventCount: number; lastEventAt: string | null } = {
    ...seed,
    snapshotPath: snapshotPath ? path.resolve(snapshotPath) : null,
    eventLogPath: eventLogPath ? path.resolve(eventLogPath) : null,
    eventCount: 0,
    lastEventAt: null,
  };

  for (const event of events) {
    applyEvent(snapshot, event);
  }

  return snapshot;
}

export function initializeRunArtifacts(snapshotPath: string, runState: RunSnapshot) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedEventLogPath = eventLogPathForSnapshot(resolvedSnapshotPath);
  const initializedEvent = createRunInitializedEvent(runState);

  appendRunEvent(resolvedEventLogPath, initializedEvent);
  const snapshot = materializeRunSnapshot([initializedEvent], {
    snapshotPath: resolvedSnapshotPath,
    eventLogPath: resolvedEventLogPath,
  });
  writeSnapshot(resolvedSnapshotPath, snapshot);

  return {
    snapshotPath: resolvedSnapshotPath,
    eventLogPath: resolvedEventLogPath,
    snapshot,
  };
}

export function rebuildSnapshot(snapshotPath: string) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedEventLogPath = eventLogPathForSnapshot(resolvedSnapshotPath);
  const events = loadRunEvents(resolvedEventLogPath);
  const snapshot = materializeRunSnapshot(events, {
    snapshotPath: resolvedSnapshotPath,
    eventLogPath: resolvedEventLogPath,
  });
  writeSnapshot(resolvedSnapshotPath, snapshot);

  return {
    snapshotPath: resolvedSnapshotPath,
    eventLogPath: resolvedEventLogPath,
    snapshot,
    events,
  };
}

export function transitionMilestone(snapshotPath: string, { milestoneId, status, note }: { milestoneId: string; status: MilestoneStatus; note?: string }) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedEventLogPath = eventLogPathForSnapshot(resolvedSnapshotPath);
  const rebuiltBeforeAppend = rebuildSnapshot(resolvedSnapshotPath);

  if (status === 'completed') {
    const latestVerification = getLatestVerification(rebuiltBeforeAppend.snapshot, milestoneId);
    if (!latestVerification || latestVerification.status !== 'passed' || !hasRecordedVerificationEvidence(latestVerification)) {
      throw new Error(`Cannot complete milestone ${milestoneId} without a passed verification result and recorded evidence`);
    }
  }

  const event = createMilestoneTransitionEvent({ milestoneId, status, note });
  appendRunEvent(resolvedEventLogPath, event);
  const rebuilt = rebuildSnapshot(resolvedSnapshotPath);

  return {
    ...rebuilt,
    event,
  };
}

export function recordWorkerHeartbeat(snapshotPath: string, { worker, note, metadata }: { worker: WorkerLabel; note?: string; metadata?: Record<string, unknown> }) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedEventLogPath = eventLogPathForSnapshot(resolvedSnapshotPath);
  const event = createWorkerHeartbeatEvent({ worker, note, metadata });

  appendRunEvent(resolvedEventLogPath, event);
  const rebuilt = rebuildSnapshot(resolvedSnapshotPath);

  return {
    ...rebuilt,
    event,
  };
}

export function recordRecoveryAction(
  snapshotPath: string,
  { action, reason, worker, milestoneId, note, source }: { action: string; reason: string; worker: WorkerLabel; milestoneId?: string; note?: string; source?: string },
) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedEventLogPath = eventLogPathForSnapshot(resolvedSnapshotPath);
  const event = createRecoveryActionEvent({ action, reason, worker, milestoneId, note, source });

  appendRunEvent(resolvedEventLogPath, event);
  const rebuilt = rebuildSnapshot(resolvedSnapshotPath);

  return {
    ...rebuilt,
    event,
  };
}

export function recordVerificationResult(
  snapshotPath: string,
  {
    milestoneId,
    command,
    status,
    outputPath,
    summary,
    reviewerOutput,
  }: {
    milestoneId: string;
    command: string;
    status: VerificationStatus;
    outputPath?: string;
    summary?: string;
    reviewerOutput?: ReviewerOutput | null;
  },
) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedEventLogPath = eventLogPathForSnapshot(resolvedSnapshotPath);
  const event = createVerificationRecordedEvent({
    milestoneId,
    command,
    status,
    outputPath,
    summary,
    reviewerOutput,
  });

  appendRunEvent(resolvedEventLogPath, event);
  const rebuilt = rebuildSnapshot(resolvedSnapshotPath);

  return {
    ...rebuilt,
    event,
  };
}
