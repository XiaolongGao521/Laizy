import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { selectSupervisorRuntimeProfile } from './runtime-profile.js';

import type {
  ReviewerOutput,
  RunSnapshot,
  SnapshotMilestone,
  VerificationArtifactKind,
  VerificationArtifactSummary,
  VerificationEvidenceSummary,
  VerificationStatus,
} from './types.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findMilestone(snapshot: RunSnapshot, milestoneId: string): SnapshotMilestone {
  const milestone = snapshot.milestones.find((candidate) => candidate.id === milestoneId);

  if (!milestone) {
    throw new Error(`Unknown milestone: ${milestoneId}`);
  }

  return milestone;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function createVerificationArtifactSummary(
  snapshot: RunSnapshot,
  milestone: SnapshotMilestone,
  {
    artifactKind,
    stage,
    command,
    verdict,
    nextAction,
    findingCount,
  }: {
    artifactKind: VerificationArtifactKind;
    stage?: string | null;
    command?: string | null;
    verdict?: string | null;
    nextAction?: string | null;
    findingCount?: number;
  },
): VerificationArtifactSummary {
  return {
    schemaVersion: 1,
    artifactKind,
    comparisonKey: `${snapshot.runId}:${milestone.id}`,
    runId: snapshot.runId,
    worker: snapshot.workers.verifier,
    milestoneId: milestone.id,
    milestoneTitle: milestone.title,
    milestoneStatus: milestone.status,
    milestoneLineNumber: milestone.lineNumber,
    stage: normalizeOptionalText(stage),
    command: normalizeOptionalText(command),
    verdict: normalizeOptionalText(verdict),
    nextAction: normalizeOptionalText(nextAction),
    findingCount: Math.max(0, findingCount ?? 0),
  };
}

export function createVerificationEvidenceSummary({
  outputPath,
  summary,
  reviewerOutput,
}: {
  outputPath?: string | null;
  summary?: string | null;
  reviewerOutput?: ReviewerOutput | null;
}): VerificationEvidenceSummary {
  const normalizedOutputPath = normalizeOptionalText(outputPath);
  const normalizedSummary = normalizeOptionalText(summary);
  const sources: VerificationEvidenceSummary['sources'] = [];

  if (normalizedOutputPath) {
    sources.push('output-path');
  }

  if (normalizedSummary) {
    sources.push('summary');
  }

  if (reviewerOutput) {
    sources.push('reviewer-output');
  }

  return {
    hasRecordedEvidence: sources.length > 0,
    sources,
    reviewerVerdict: reviewerOutput ? normalizeOptionalText(reviewerOutput.verdict) : null,
    reviewerNextAction: reviewerOutput ? normalizeOptionalText(reviewerOutput.nextAction) : null,
    findingCount: reviewerOutput ? reviewerOutput.findings.length : 0,
  };
}

export function hasRecordedVerificationEvidence({
  outputPath,
  summary,
  reviewerOutput,
  evidence,
}: {
  outputPath?: string | null;
  summary?: string | null;
  reviewerOutput?: ReviewerOutput | null;
  evidence?: VerificationEvidenceSummary | null;
}): boolean {
  return (evidence ?? createVerificationEvidenceSummary({ outputPath, summary, reviewerOutput })).hasRecordedEvidence;
}

export function createVerificationCommand(
  snapshot: RunSnapshot,
  options: { milestoneId?: string; command?: string; stage?: string } = {},
) {
  const milestone = findMilestone(snapshot, options.milestoneId ?? snapshot.currentMilestoneId!);
  const runtimeProfile = selectSupervisorRuntimeProfile(snapshot, 'verify', milestone);
  const command = options.command ?? 'npm run build';
  const stage = options.stage ?? 'post-implementation';

  return {
    schemaVersion: 1,
    kind: 'verification.command',
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    repoPath: snapshot.repoPath,
    planPath: snapshot.planPath,
    worker: snapshot.workers.verifier,
    runtimeProfile,
    milestone: {
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      lineNumber: milestone.lineNumber,
      details: clone(milestone.details ?? []),
    },
    artifactSummary: createVerificationArtifactSummary(snapshot, milestone, {
      artifactKind: 'verification.command',
      stage,
      command,
    }),
    command,
    stage,
    instructions: [
      'Run the verification command exactly as written unless explicitly overridden.',
      'Record the verification result and supporting evidence before milestone completion is declared.',
      'Do not mark the milestone completed unless verification status is passed and evidence is recorded.',
    ],
  };
}

export function createReviewerOutput(
  snapshot: RunSnapshot,
  options: { milestoneId?: string; verdict?: string; summary?: string; findings?: string[]; nextAction?: string } = {},
): ReviewerOutput {
  const milestone = findMilestone(snapshot, options.milestoneId ?? snapshot.currentMilestoneId!);
  const verdict = options.verdict ?? 'needs-review';
  const findings = clone(options.findings ?? []);
  const nextAction = options.nextAction ?? 'address-findings';

  return {
    schemaVersion: 1,
    kind: 'reviewer.output',
    generatedAt: new Date().toISOString(),
    runId: snapshot.runId,
    worker: snapshot.workers.verifier,
    milestone: {
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
    },
    artifactSummary: createVerificationArtifactSummary(snapshot, milestone, {
      artifactKind: 'reviewer.output',
      verdict,
      nextAction,
      findingCount: findings.length,
    }),
    verdict,
    summary: options.summary ?? '',
    findings,
    nextAction,
  };
}

export function createVerificationResultRecord({
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
  outputPath?: string | null;
  summary?: string | null;
  reviewerOutput?: ReviewerOutput | null;
}) {
  const normalizedOutputPath = normalizeOptionalText(outputPath);
  const normalizedSummary = normalizeOptionalText(summary);
  const normalizedReviewerOutput = reviewerOutput ?? null;

  return {
    milestoneId,
    command,
    status,
    outputPath: normalizedOutputPath,
    summary: normalizedSummary,
    reviewerOutput: normalizedReviewerOutput,
    evidence: createVerificationEvidenceSummary({
      outputPath: normalizedOutputPath,
      summary: normalizedSummary,
      reviewerOutput: normalizedReviewerOutput,
    }),
  };
}

export function writeVerificationDocument(outputPath: string, document: object): string {
  const resolvedOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return resolvedOutputPath;
}
