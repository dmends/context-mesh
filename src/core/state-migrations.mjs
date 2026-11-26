import { STATE_SCHEMA_VERSION } from '../config/env.mjs';
import { WORKFLOW_ID } from '../workflows/project-lifecycle.mjs';
import { StepStatus } from '../domain/status.mjs';
import { WorkflowError } from '../domain/errors.mjs';
import { createInitialState } from './state-store.mjs';

export function migrateState(initiativeState, context, filePath) {
  let migrated = false;
  let state = initiativeState;

  if (state.schemaVersion === 1 && state.steps) {
    if (state.workflowId !== WORKFLOW_ID || state.runId !== context.runId) {
      throw new WorkflowError('SCHEMA_MIGRATION_FAILED', `Workflow state has an unsupported or invalid structure: ${filePath}`);
    }
    const legacyNode = {
      ...state,
      tema: context.tema,
      nodeId: context.nodeId,
      legacyOutputPaths: true,
    };
    delete legacyNode.schemaVersion;
    delete legacyNode.workflowId;
    state = createInitialState({ runId: context.runId, createdAt: state.createdAt });
    state.nodes[context.nodeId] = legacyNode;
    state.schemaVersion = 2;
    migrated = true;
  }

  if (state.schemaVersion === 2) {
    for (const node of Object.values(state.nodes ?? {})) {
      if (node.steps?.['as-is-knowledge']?.status === StepStatus.COMPLETED) {
        node.steps['as-is-knowledge'].status = StepStatus.ACCUMULATING;
      }
    }
    state.schemaVersion = 3;
    migrated = true;
  }

  if (state.schemaVersion === 3) {
    for (const node of Object.values(state.nodes ?? {})) {
      const aik = node.steps?.['as-is-knowledge'];
      if (!aik || aik.status === StepStatus.PENDING || aik.status === StepStatus.FAILED) continue;

      let knowledgePath = '';
      if (Array.isArray(aik.artifacts)) {
        knowledgePath = aik.artifacts[0]?.knowledge?.path ?? '';
      } else {
        knowledgePath = aik.artifacts?.knowledge?.path ?? '';
      }
      if (knowledgePath.startsWith('workspace/.knowledge/')) {
        node.legacyOutputPaths = true;
      }
    }
    state.schemaVersion = 4;
    migrated = true;
  }

  if (
    state.schemaVersion !== STATE_SCHEMA_VERSION ||
    state.workflowId !== WORKFLOW_ID ||
    state.runId !== context.runId ||
    !state.nodes ||
    typeof state.nodes !== 'object'
  ) {
    throw new WorkflowError('SCHEMA_MIGRATION_FAILED', `Workflow state has an unsupported or invalid structure: ${filePath}`);
  }

  return { state, migrated };
}
