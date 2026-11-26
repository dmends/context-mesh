import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, before, after } from 'node:test';
import { statePath, createInitialNodeState, createInitialState, saveState } from './state-store.mjs';
import { StepStatus } from '../domain/status.mjs';
import { STATE_SCHEMA_VERSION } from '../config/env.mjs';
import { WORKFLOW_ID, WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';

describe('statePath', () => {
  it('returns expected path under .smith/runs/', () => {
    const result = statePath({ workspaceRoot: '/workspace', runId: 'abc-123' });
    assert.equal(result, '/workspace/.smith/runs/abc-123.json');
  });
});

describe('createInitialNodeState', () => {
  it('has all WORKFLOW_STEPS as PENDING', () => {
    const node = createInitialNodeState({ runId: 'r1', tema: 'test tema', nodeId: 'node1', createdAt: '2024-01-01T00:00:00.000Z' });
    assert.equal(node.runId, 'r1');
    assert.equal(node.tema, 'test tema');
    assert.equal(node.nodeId, 'node1');
    for (const { id } of WORKFLOW_STEPS) {
      assert.equal(node.steps[id].status, StepStatus.PENDING);
    }
  });
});

describe('createInitialState', () => {
  it('has correct schema version and workflowId', () => {
    const state = createInitialState({ runId: 'r1', createdAt: '2024-01-01T00:00:00.000Z' });
    assert.equal(state.schemaVersion, STATE_SCHEMA_VERSION);
    assert.equal(state.workflowId, WORKFLOW_ID);
    assert.equal(state.runId, 'r1');
    assert.deepEqual(state.nodes, {});
  });
});

describe('saveState', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'state-store-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('writes state atomically and reads back correctly', async () => {
    const filePath = join(dir, 'runs', 'test.json');
    const state = createInitialState({ runId: 'r1' });
    await saveState(filePath, state);
    const loaded = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(loaded.runId, 'r1');
    assert.equal(loaded.schemaVersion, STATE_SCHEMA_VERSION);
  });

  it('file ends with a newline', async () => {
    const filePath = join(dir, 'runs', 'newline.json');
    await saveState(filePath, createInitialState({ runId: 'r2' }));
    const raw = readFileSync(filePath, 'utf8');
    assert.equal(raw.at(-1), '\n');
  });

  it('overwrites existing file', async () => {
    const filePath = join(dir, 'runs', 'overwrite.json');
    await saveState(filePath, createInitialState({ runId: 'r3' }));
    const state2 = { ...createInitialState({ runId: 'r3' }), updatedAt: 'updated' };
    await saveState(filePath, state2);
    const loaded = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(loaded.updatedAt, 'updated');
  });
});
