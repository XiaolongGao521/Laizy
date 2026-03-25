import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const VALID_MILESTONE_STATUSES = new Set([
  'planned',
  'implementing',
  'verifying',
  'completed',
  'blocked',
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureMilestoneStatus(status) {
  if (!VALID_MILESTONE_STATUSES.has(status)) {
    throw new Error(`Invalid milestone status: ${status}`);
  }
}

export function eventLogPathForSnapshot(snapshotPath) {
  const resolved = path.resolve(snapshotPath);
  return resolved.endsWith('.json')
    ? resolved.replace(/\.json$/u, '.events.jsonl')
    : `${resolved}.events.jsonl`;
}

export function createRunInitializedEvent(runState) {
  return {
    type: 'run.initialized',
    at: runState.createdAt,
    detail: {
      run: clone(runState),
    },
  };
}

export function createMilestoneTransitionEvent({ milestoneId, status, note }) {
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

export function appendRunEvent(eventLogPath, event) {
  const resolvedPath = path.resolve(eventLogPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  appendFileSync(resolvedPath, `${JSON.stringify(event)}\n`, 'utf8');
  return resolvedPath;
}

export function loadRunEvents(eventLogPath) {
  const resolvedPath = path.resolve(eventLogPath);

  if (!existsSync(resolvedPath)) {
    return [];
  }

  const lines = readFileSync(resolvedPath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => JSON.parse(line));
}

export function writeSnapshot(snapshotPath, snapshot) {
  const resolvedPath = path.resolve(snapshotPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return resolvedPath;
}

function deriveRunStatus(milestones) {
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

function deriveCurrentMilestoneId(milestones) {
  return milestones.find((milestone) => milestone.status !== 'completed')?.id ?? null;
}

function applyEvent(snapshot, event) {
  if (event.type === 'milestone.transition') {
    const milestone = snapshot.milestones.find(
      (candidate) => candidate.id === event.detail.milestoneId,
    );

    if (!milestone) {
      throw new Error(`Unknown milestone for transition: ${event.detail.milestoneId}`);
    }

    ensureMilestoneStatus(event.detail.status);
    milestone.status = event.detail.status;
    milestone.updatedAt = event.at;
    if (event.detail.note) {
      milestone.lastNote = event.detail.note;
    }
  }

  snapshot.updatedAt = event.at;
  snapshot.lastEventAt = event.at;
  snapshot.eventCount += 1;
  snapshot.currentMilestoneId = deriveCurrentMilestoneId(snapshot.milestones);
  snapshot.status = deriveRunStatus(snapshot.milestones);
}

export function materializeRunSnapshot(events, { snapshotPath, eventLogPath } = {}) {
  const initialized = events.find((event) => event.type === 'run.initialized');

  if (!initialized) {
    throw new Error('Missing run.initialized event in event log');
  }

  const seed = clone(initialized.detail.run);
  const snapshot = {
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

export function initializeRunArtifacts(snapshotPath, runState) {
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

export function rebuildSnapshot(snapshotPath) {
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

export function transitionMilestone(snapshotPath, { milestoneId, status, note }) {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  const resolvedEventLogPath = eventLogPathForSnapshot(resolvedSnapshotPath);
  const event = createMilestoneTransitionEvent({ milestoneId, status, note });

  appendRunEvent(resolvedEventLogPath, event);
  const rebuilt = rebuildSnapshot(resolvedSnapshotPath);

  return {
    ...rebuilt,
    event,
  };
}
