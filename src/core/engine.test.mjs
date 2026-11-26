import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, before, after } from 'node:test';
import { readWorkflowRun, getReadySteps, getReadyStepDetails } from './engine.mjs';
import { StepStatus } from '../domain/status.mjs';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';

function makeContext(dir, runId) {
  return {
    workspaceRoot: dir,
    runId,
    tema: 'Test Tema',
    inputFiles: [],
  };
}

describe('readWorkflowRun', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'engine-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('creates initial state when none exists', async () => {
    const context = makeContext(dir, 'run-read-1');
    const state = await readWorkflowRun(context);
    assert.ok(state.steps, 'state must have steps');
    assert.equal(state.runId, context.runId);
  });

  it('node has all WORKFLOW_STEPS as PENDING initially', async () => {
    const context = makeContext(dir, 'run-pending-check');
    const state = await readWorkflowRun(context);
    for (const { id } of WORKFLOW_STEPS) {
      assert.equal(state.steps[id]?.status, StepStatus.PENDING, `step ${id} must be PENDING`);
    }
  });
});

describe('getReadySteps', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'engine-ready-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns steps whose prerequisites are all met', async () => {
    const context = makeContext(dir, 'run-ready-1');
    const steps = await getReadySteps(context);
    assert.ok(Array.isArray(steps));
    const noPrereqSteps = WORKFLOW_STEPS.filter((s) => s.requires.length === 0).map((s) => s.id);
    for (const id of noPrereqSteps) {
      assert.ok(steps.includes(id), `expected "${id}" in ready steps`);
    }
  });
});

describe('getReadyStepDetails', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'engine-details-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns step detail objects with id', async () => {
    const context = makeContext(dir, 'run-details-1');
    const details = await getReadyStepDetails(context);
    assert.ok(Array.isArray(details));
    for (const detail of details) {
      assert.equal(typeof detail.id, 'string');
    }
  });
});
