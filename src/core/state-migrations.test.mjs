import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateState } from './state-migrations.mjs';
import { createInitialState } from './state-store.mjs';
import { StepStatus } from '../domain/status.mjs';
import { STATE_SCHEMA_VERSION } from '../config/env.mjs';
import { WORKFLOW_ID, WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';

function makeV1State({ runId = 'r1', tema = 'tema', nodeId = 'node1' } = {}) {
  return {
    schemaVersion: 1,
    workflowId: WORKFLOW_ID,
    runId,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    steps: Object.fromEntries(WORKFLOW_STEPS.map(({ id }) => [id, { status: StepStatus.PENDING, artifacts: {} }])),
    // v1 also had tema/nodeId at the top level
    tema,
    nodeId,
  };
}

function makeV2State({ runId = 'r1', nodeId = 'node1' } = {}) {
  const state = createInitialState({ runId, createdAt: '2024-01-01T00:00:00.000Z' });
  state.schemaVersion = 2;
  state.nodes[nodeId] = {
    runId,
    tema: 'tema',
    nodeId,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    steps: Object.fromEntries(WORKFLOW_STEPS.map(({ id }) => [id, { status: StepStatus.PENDING, artifacts: {} }])),
  };
  return state;
}

function makeV2WithCompletedAIK({ runId = 'r1', nodeId = 'node1' } = {}) {
  const state = makeV2State({ runId, nodeId });
  state.nodes[nodeId].steps['as-is-knowledge'].status = StepStatus.COMPLETED;
  return state;
}

describe('migrateState', () => {
  const context = { runId: 'r1', tema: 'tema', nodeId: 'node1' };

  it('migrates v1 to current version', () => {
    const v1 = makeV1State();
    const { state, migrated } = migrateState(v1, context, 'test.json');
    assert.equal(migrated, true);
    assert.equal(state.schemaVersion, STATE_SCHEMA_VERSION);
    assert.ok(state.nodes[context.nodeId]);
  });

  it('v2 with completed as-is-knowledge migrates status to ACCUMULATING', () => {
    const v2 = makeV2WithCompletedAIK();
    const { state, migrated } = migrateState(v2, context, 'test.json');
    assert.equal(migrated, true);
    assert.equal(state.nodes[context.nodeId].steps['as-is-knowledge'].status, StepStatus.ACCUMULATING);
  });

  it('v2 without completed as-is-knowledge leaves other statuses unchanged', () => {
    const v2 = makeV2State();
    const { state } = migrateState(v2, context, 'test.json');
    assert.equal(state.nodes[context.nodeId].steps['as-is-knowledge'].status, StepStatus.PENDING);
  });

  it('current version state passes through without migration', () => {
    const current = createInitialState({ runId: 'r1' });
    current.nodes[context.nodeId] = {};
    const { state, migrated } = migrateState(current, context, 'test.json');
    assert.equal(migrated, false);
    assert.equal(state.schemaVersion, STATE_SCHEMA_VERSION);
  });

  it('throws on unknown schema version', () => {
    const bad = { schemaVersion: 99, workflowId: WORKFLOW_ID, runId: 'r1', nodes: {} };
    assert.throws(
      () => migrateState(bad, context, 'bad.json'),
      { message: /unsupported|invalid/i },
    );
  });

  it('throws on runId mismatch', () => {
    const current = createInitialState({ runId: 'other-run' });
    current.nodes[context.nodeId] = {};
    assert.throws(
      () => migrateState(current, context, 'mismatch.json'),
      { message: /unsupported|invalid/i },
    );
  });
});
