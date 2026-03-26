import { selectNextActionableMilestone } from './contracts.js';

import type { RunSnapshot, SnapshotMilestone, SupervisorDecisionName, SupervisorRuntimeProfile, SupervisorScopeClassification } from './types.js';

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function collectScopeText(milestone: SnapshotMilestone | null): string {
  if (!milestone) {
    return '';
  }

  return [milestone.title, ...(milestone.details ?? [])]
    .map((entry) => normalizeText(entry))
    .join('\n');
}

export function classifyMilestoneScope(milestone: SnapshotMilestone | null): SupervisorScopeClassification {
  if (!milestone) {
    return 'none';
  }

  const scopeText = collectScopeText(milestone);

  if (/(readme|docs?|documentation)/u.test(scopeText)) {
    return 'docs';
  }

  if (/(runtime|supervisor|orchestration|adapter|event log|run state|health|recovery|core)/u.test(scopeText)) {
    return 'core-runtime';
  }

  if (/(verify|verification|review|reviewer|build-check|test|smoke)/u.test(scopeText)) {
    return 'verification';
  }

  return 'implementation';
}

export function selectSupervisorRuntimeProfile(
  snapshot: RunSnapshot,
  decision: SupervisorDecisionName,
  milestone: SnapshotMilestone | null = selectNextActionableMilestone(snapshot),
): SupervisorRuntimeProfile {
  const scope = classifyMilestoneScope(milestone);

  if (decision === 'closeout') {
    return {
      model: 'openai-codex/gpt-5.4-mini',
      thinking: 'low',
      reasoningMode: 'hidden',
      scope,
    };
  }

  if (decision === 'plan' || decision === 'replan') {
    return {
      model: 'openai-codex/gpt-5.4',
      thinking: 'high',
      reasoningMode: 'hidden',
      scope,
    };
  }

  if (decision === 'recover') {
    return {
      model: 'openai-codex/gpt-5.4',
      thinking: 'high',
      reasoningMode: 'hidden',
      scope,
    };
  }

  if (decision === 'verify') {
    return {
      model: 'openai-codex/gpt-5.4',
      thinking: scope === 'verification' ? 'medium' : 'high',
      reasoningMode: 'hidden',
      scope,
    };
  }

  if (scope === 'docs') {
    return {
      model: 'openai-codex/gpt-5.4-mini',
      thinking: 'low',
      reasoningMode: 'hidden',
      scope,
    };
  }

  if (scope === 'core-runtime') {
    return {
      model: 'openai-codex/gpt-5.4',
      thinking: 'high',
      reasoningMode: 'hidden',
      scope,
    };
  }

  return {
    model: 'openai-codex/gpt-5.4',
    thinking: 'low',
    reasoningMode: 'hidden',
    scope,
  };
}
