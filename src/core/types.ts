export type MilestonePlanEntry = {
  id: string;
  title: string;
  completed: boolean;
  lineNumber: number;
  details: string[];
};

export type MilestoneStatus = 'planned' | 'implementing' | 'verifying' | 'completed' | 'blocked';
export type VerificationStatus = 'pending' | 'passed' | 'failed';

// Canonical worker role names for operator-facing docs, emitted artifacts, and runtime adapters.
// Keep these values stable unless a future compatibility plan introduces aliases/migration support.
export type WorkerRole = 'planner' | 'implementer' | 'watchdog' | 'recovery' | 'verifier';

// Backend identifiers are part of emitted adapter/configuration documents.
// Prefer wording cleanup in human-facing summaries before changing any stable backend keys.
export type BackendKind = 'openclaw' | 'codex-cli' | 'claude-code' | 'laizy-watchdog';
export type BackendProbeName = 'installation' | 'invocation' | 'liveness';
export type BackendProbeStatus = 'not-run' | 'not-applicable' | 'passed' | 'failed';
export type BackendOverallStatus = 'unknown' | 'healthy' | 'unhealthy';
export type BackendCheckNextAction =
  | 'proceed-to-handoff'
  | 'install-or-expose-backend'
  | 'repair-backend-invocation'
  | 'restore-backend-liveness'
  | 'inspect-failed-probes';
export type BackendHandoffStatus = 'ready' | 'blocked';
export type WorkerBackendConfig = {
  role: WorkerRole;
  backend: BackendKind;
  supportedBackends: BackendKind[];
  preferredRuntime: string | null;
};
export type BackendConfiguration = Record<WorkerRole, WorkerBackendConfig>;
export type BackendHealthProbe = {
  name: BackendProbeName;
  status: BackendProbeStatus;
  detail: string;
  command: string | null;
  checkedAt: string;
};
export type BackendProbeSummary = {
  name: BackendProbeName;
  status: BackendProbeStatus;
  detail: string;
  outputPreview: string | null;
  command: string | null;
  nextAction: BackendCheckNextAction;
};
export type BackendCheckSummary = {
  handoffStatus: BackendHandoffStatus;
  headline: string;
  operatorMessage: string;
  nextAction: BackendCheckNextAction;
  failedProbeCount: number;
  failedProbeNames: BackendProbeName[];
  probeStatusCounts: Record<BackendProbeStatus, number>;
  probes: BackendProbeSummary[];
  failedProbes: BackendProbeSummary[];
};
export type BackendCheckResultDocument = {
  schemaVersion: number;
  kind: 'backend.check-result';
  generatedAt: string;
  runId: string;
  repoPath: string;
  planPath: string;
  snapshotPath: string | null;
  eventLogPath: string | null;
  worker: {
    role: WorkerRole;
    label: WorkerLabel;
  };
  backend: WorkerBackendConfig;
  overallStatus: BackendOverallStatus;
  probes: BackendHealthProbe[];
  summary: BackendCheckSummary;
  outputPath: string | null;
};
export type WorkerLabel =
  | 'laizy-planner'
  | 'laizy-implementer'
  | 'laizy-watchdog'
  | 'laizy-recovery'
  | 'laizy-verifier';

export type SnapshotMilestone = {
  id: string;
  title: string;
  status: MilestoneStatus;
  lineNumber: number;
  details: string[];
  updatedAt: string;
  lastNote: string | null;
};

export type WorkerHeartbeat = {
  worker: WorkerLabel;
  at: string;
  note: string | null;
  metadata: Record<string, unknown>;
};

export type RecoveryRecord = {
  action: string;
  reason: string;
  worker: WorkerLabel;
  milestoneId: string | null;
  note: string | null;
  source: string;
  at: string;
};

export type VerificationArtifactKind = 'verification.command' | 'reviewer.output';
export type VerificationEvidenceSource = 'output-path' | 'summary' | 'reviewer-output';

export type VerificationArtifactSummary = {
  schemaVersion: number;
  artifactKind: VerificationArtifactKind;
  comparisonKey: string;
  runId: string;
  worker: WorkerLabel;
  milestoneId: string;
  milestoneTitle: string;
  milestoneStatus: MilestoneStatus;
  milestoneLineNumber: number | null;
  stage: string | null;
  command: string | null;
  verdict: string | null;
  nextAction: string | null;
  findingCount: number;
};

export type VerificationEvidenceSummary = {
  hasRecordedEvidence: boolean;
  sources: VerificationEvidenceSource[];
  reviewerVerdict: string | null;
  reviewerNextAction: string | null;
  findingCount: number;
};

export type ReviewerOutput = {
  schemaVersion: number;
  kind: 'reviewer.output';
  generatedAt: string;
  runId: string;
  worker: WorkerLabel;
  milestone: {
    id: string;
    title: string;
    status: MilestoneStatus;
  };
  artifactSummary: VerificationArtifactSummary;
  verdict: string;
  summary: string;
  findings: string[];
  nextAction: string;
};

export type VerificationRecord = {
  milestoneId: string;
  command: string;
  status: VerificationStatus;
  outputPath: string | null;
  summary: string | null;
  reviewerOutput: ReviewerOutput | null;
  evidence: VerificationEvidenceSummary;
  at: string;
};

export type PlanStateStatus = 'actionable' | 'needs-plan' | 'completed';

export type PlanState = {
  status: PlanStateStatus;
  reason: string;
  milestoneCount: number;
  completedMilestoneCount: number;
  pendingMilestoneCount: number;
};

// Run snapshots are durable machine-readable state.
// Preserve existing property names for compatibility with event-log rebuilds and downstream tooling.
export type RunSnapshot = {
  schemaVersion: number;
  runId: string;
  goal: string;
  repoPath: string;
  planPath: string;
  status: MilestoneStatus | 'completed';
  planState: PlanState;
  backends: BackendConfiguration;
  createdAt: string;
  updatedAt: string;
  currentMilestoneId: string | null;
  workers: Record<WorkerRole, WorkerLabel>;
  workerHeartbeats: Record<WorkerLabel, WorkerHeartbeat | null>;
  milestones: SnapshotMilestone[];
  recovery: RecoveryRecord[];
  verification: VerificationRecord[];
  managedRunners: ManagedRunnerState;
  snapshotPath?: string | null;
  eventLogPath?: string | null;
  eventCount?: number;
  lastEventAt?: string | null;
};

// Event records are append-only wire artifacts; keep event type strings stable.
export type RunEvent = {
  type:
    | 'run.initialized'
    | 'milestone.transition'
    | 'worker.heartbeat'
    | 'recovery.action'
    | 'verification.recorded'
    | 'managed-runner.launch-recorded'
    | 'managed-runner.result-recorded';
  at: string;
  detail: Record<string, unknown>;
};

export type RecoveryTrigger = 'healthy' | 'completed' | 'run-blocked' | 'planned-no-activity' | 'implementer-stalled';

export type RecoveryReasoningFact = {
  label: string;
  value: string | number | null;
  detail: string;
};

export type RecoveryScope = {
  mode: 'single-milestone' | 'run';
  milestoneId: string | null;
  milestoneTitle: string | null;
  note: string;
};

export type RecoveryRecommendation = {
  schemaVersion: number;
  kind: 'recovery.recommendation';
  generatedAt: string;
  action: string;
  summary: string;
  reason: string;
  trigger: RecoveryTrigger;
  severity: string;
  worker: WorkerLabel;
  milestoneId: string | null;
  evidence: RecoveryReasoningFact[];
  scope: RecoveryScope;
};

export type HealthReport = {
  schemaVersion: number;
  kind: 'run.health';
  checkedAt: string;
  stallThresholdMinutes: number;
  runId: string;
  runStatus: string;
  overallStatus: string;
  statusSummary: string;
  activeMilestoneId: string | null;
  implementerHeartbeatAt: string | null;
  milestoneUpdatedAt: string | null;
  lastProgressAt: string | null;
  lastProgressSource: 'implementer-heartbeat' | 'milestone-update' | 'none';
  idleMinutes: number | null;
  recoveryRecommendation: RecoveryRecommendation;
};

export type ManagedRunnerProvider = 'codex' | 'claude-code' | 'openclaw';
export type ManagedRunnerWorkerRole = Exclude<WorkerRole, 'watchdog'>;
export type ManagedRunnerLifecycleStatus = 'launching' | 'running' | 'finished';
export type ManagedRunnerOutcome = 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'launch_failed' | 'unknown';
export type ManagedRunnerTrackingKind = 'pid' | 'exec-session' | 'session-key';
export type ManagedRunnerContractKind =
  | 'planner.request'
  | 'implementer.contract'
  | 'recovery.plan'
  | 'verification.command';
export type ManagedRunnerAdapterKind = 'openclaw.sessions_spawn' | 'codex-cli.exec' | 'claude-code.exec';

export type ManagedRunnerTrackingHandle = {
  kind: ManagedRunnerTrackingKind;
  id: string;
};

export type ManagedRunnerArtifactReference = {
  label: string;
  path: string;
};

export type ManagedRunnerLaunchArtifact = {
  schemaVersion: number;
  kind: 'managed-runner.launch';
  artifactPath: string | null;
  launchId: string;
  runId: string;
  milestoneId: string | null;
  provider: ManagedRunnerProvider;
  worker: {
    role: ManagedRunnerWorkerRole;
    label: WorkerLabel;
  };
  status: ManagedRunnerLifecycleStatus;
  outcome: ManagedRunnerOutcome | null;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  tracking: ManagedRunnerTrackingHandle | null;
  contract: {
    kind: ManagedRunnerContractKind;
    path: string | null;
  };
  adapter: {
    kind: ManagedRunnerAdapterKind;
    path: string | null;
  };
  resultPath: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  runtimeProfile: SupervisorRuntimeProfile | null;
  summary: string | null;
  artifacts: ManagedRunnerArtifactReference[];
  metadata: Record<string, unknown>;
};

export type ManagedRunnerResultArtifact = {
  schemaVersion: number;
  kind: 'managed-runner.result';
  artifactPath: string | null;
  launchId: string;
  runId: string;
  milestoneId: string | null;
  provider: ManagedRunnerProvider;
  worker: {
    role: ManagedRunnerWorkerRole;
    label: WorkerLabel;
  };
  status: ManagedRunnerLifecycleStatus;
  outcome: ManagedRunnerOutcome;
  exitCode: number | null;
  startedAt: string | null;
  endedAt: string | null;
  tracking: ManagedRunnerTrackingHandle | null;
  launchPath: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  summary: string | null;
  artifacts: ManagedRunnerArtifactReference[];
  metadata: Record<string, unknown>;
};

export type ManagedRunnerLaunchRequest = {
  schemaVersion: number;
  kind: 'managed-runner.launch-request';
  generatedAt: string;
  launchId: string;
  runId: string;
  milestoneId: string | null;
  provider: ManagedRunnerProvider;
  worker: {
    role: ManagedRunnerWorkerRole;
    label: WorkerLabel;
  };
  runtimeProfile: SupervisorRuntimeProfile | null;
  launchArtifactPath: string;
  resultArtifactPath: string;
  contract: {
    kind: ManagedRunnerContractKind;
    path: string;
  };
  adapter: {
    kind: ManagedRunnerAdapterKind;
    path: string;
  };
  instructions: string[];
};

export type ManagedRunnerState = {
  launches: ManagedRunnerLaunchArtifact[];
  results: ManagedRunnerResultArtifact[];
};

export type PlannerRequest = {
  schemaVersion: number;
  kind: 'planner.request';
  generatedAt: string;
  runId: string;
  goal: string;
  repoPath: string;
  planPath: string;
  worker: WorkerLabel;
  targetWorker: WorkerLabel;
  requestedMode: 'plan' | 'replan';
  triggerReason: string;
  currentPlanState: PlanState & {
    actionableMilestoneId: string | null;
  };
};

export type PlannerIntent = {
  schemaVersion: number;
  kind: 'planner.intent';
  generatedAt: string;
  runId: string;
  runStatus: string;
  repoPath: string;
  planPath: string;
  worker: WorkerLabel;
  targetWorker: WorkerLabel;
  selectedMilestone: {
    id: string;
    title: string;
    status: MilestoneStatus;
    lineNumber: number;
    details: string[];
    lastNote: string | null;
  } | null;
  scope: {
    mode: 'single-milestone' | 'none';
    milestoneCount: number;
  };
  constraints: string[];
};

export type ImplementerContract = {
  schemaVersion: number;
  kind: 'implementer.contract';
  generatedAt: string;
  runId: string;
  repoPath: string;
  planPath: string;
  snapshotPath: string | null;
  eventLogPath: string | null;
  worker: WorkerLabel;
  plannerIntent: PlannerIntent;
  milestone: PlannerIntent['selectedMilestone'];
  instructions: string[];
};

export type RecoveryPlan = {
  schemaVersion: number;
  kind: 'recovery.plan';
  generatedAt: string;
  runId: string;
  basedOnHealthReport: {
    checkedAt: string;
    overallStatus: string;
    action: string;
    summary: string;
    reason: string;
  };
  action: string;
  worker: WorkerLabel;
  milestoneId: string | null;
  reason: string;
  severity: string;
  activeMilestone: {
    id: string;
    title: string;
    status: MilestoneStatus;
  } | null;
  scope: RecoveryScope;
  recommendationBasis: {
    trigger: RecoveryTrigger;
    summary: string;
    evidence: RecoveryReasoningFact[];
  };
  recoveryPath: {
    mode: 'none' | 'resume-active-milestone' | 'blocked-escalation';
    summary: string;
    scope: RecoveryScope;
    targetMilestone: {
      id: string;
      title: string;
      status: MilestoneStatus;
    } | null;
    steps: string[];
  };
  resumeContract: ImplementerContract | null;
  escalation: {
    targetWorker: WorkerLabel;
    targetMilestoneId: string | null;
    mode: string;
  } | null;
};

export type SupervisorAction = {
  id: string;
  kind: string;
  title: string;
  worker: WorkerLabel | null;
  requiresExternalExecution: boolean;
  documentPath: string | null;
  documentKind: string | null;
  summary: string;
  runtimeProfile: SupervisorRuntimeProfile | null;
};

export type SupervisorDecisionName = 'plan' | 'replan' | 'continue' | 'recover' | 'verify' | 'closeout';
export type SupervisorScopeClassification = 'none' | 'docs' | 'verification' | 'core-runtime' | 'implementation';
export type SupervisorRuntimeModel = 'openai-codex/gpt-5.4' | 'openai-codex/gpt-5.4-mini';
export type SupervisorThinkingEffort = 'low' | 'medium' | 'high';
export type SupervisorReasoningMode = 'off' | 'hidden' | 'visible';

export type SupervisorRuntimeProfile = {
  model: SupervisorRuntimeModel;
  thinking: SupervisorThinkingEffort;
  reasoningMode: SupervisorReasoningMode;
  scope: SupervisorScopeClassification;
};

export type SupervisorDecision = {
  schemaVersion: number;
  kind: 'supervisor.decision';
  generatedAt: string;
  runId: string;
  snapshotPath: string | null;
  eventLogPath: string | null;
  overallStatus: string;
  runStatus: string;
  activeMilestoneId: string | null;
  decision: SupervisorDecisionName;
  runtimeProfile: SupervisorRuntimeProfile;
  reason: string;
  eventDerivedState: {
    source: 'snapshot';
    eventCount: number;
    lastEventAt: string | null;
    activeMilestone: {
      id: string;
      title: string;
      status: MilestoneStatus;
      updatedAt: string;
      lastNote: string | null;
    } | null;
    latestVerification: {
      milestoneId: string;
      command: string;
      status: VerificationStatus;
      at: string;
      summary: string | null;
      evidence: VerificationEvidenceSummary;
    } | null;
    latestRecovery: {
      action: string;
      worker: WorkerLabel;
      at: string;
      reason: string;
      milestoneId: string | null;
    } | null;
    latestManagedRunner: {
      launch: {
        launchId: string;
        provider: ManagedRunnerProvider;
        status: ManagedRunnerLifecycleStatus;
        tracking: ManagedRunnerTrackingHandle | null;
        requestedAt: string;
        startedAt: string | null;
        outcome: ManagedRunnerOutcome | null;
        artifactPath: string | null;
      } | null;
      result: {
        launchId: string;
        provider: ManagedRunnerProvider;
        status: ManagedRunnerLifecycleStatus;
        outcome: ManagedRunnerOutcome;
        exitCode: number | null;
        endedAt: string | null;
        artifactPath: string | null;
      } | null;
    };
  };
  continuation: {
    mode: 'none' | 'start-next-milestone' | 'continue-active-milestone' | 'resume-after-rebuild' | 'recover-before-continuing' | 'verify-active-milestone' | 'closeout';
    summary: string;
    recommendedDocumentKind: string | null;
  };
  actions: SupervisorAction[];
};
