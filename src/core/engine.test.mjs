import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, before, after } from 'node:test';
import {
  readWorkflowRun, getReadySteps, getReadyStepDetails, findNode, findStep,
  addSource, updateSource, removeSource, listSources,
} from './engine.mjs';
import { statePath } from './state-store.mjs';
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
    assert.ok(Array.isArray(state.steps), 'node steps must be an array');
    const root = JSON.parse(readFileSync(statePath(context), 'utf8'));
    assert.equal(root.schemaVersion, 1);
    assert.ok(Array.isArray(root.nodes));
    assert.ok(Array.isArray(root.sources));
    assert.equal(state.id, 'test-tema');
  });

  it('node has all WORKFLOW_STEPS as PENDING initially', async () => {
    const context = makeContext(dir, 'run-pending-check');
    const state = await readWorkflowRun(context);
    for (const [index, { id }] of WORKFLOW_STEPS.entries()) {
      assert.equal(state.steps[index]?.type, id);
      assert.equal(state.steps[index]?.status, StepStatus.PENDING, `step ${id} must be PENDING`);
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

  describe('canonical schema validation', () => {
    let dir;
    before(() => { dir = mkdtempSync(join(tmpdir(), 'engine-schema-')); });
    after(() => rmSync(dir, { recursive: true, force: true }));

    it('rejects invalid states without rewriting them', async () => {
      const context = makeContext(dir, 'run-invalid-schema');
      const file = statePath(context);
      mkdirSync(join(dir, '.smith/runs'), { recursive: true });
      const invalid = '{"schemaVersion":4,"nodes":{}}';
      writeFileSync(file, invalid);
      await assert.rejects(readWorkflowRun(context), { code: 'INVALID_RUN_STATE' });
      assert.equal(readFileSync(file, 'utf8'), invalid);
    });

    it('rejects incomplete schema 1 objects without normalizing or writing them', async () => {
      const context = makeContext(dir, 'run-incomplete-schema');
      const file = statePath(context);
      mkdirSync(join(dir, '.smith/runs'), { recursive: true });
      const invalid = JSON.stringify({
        schemaVersion: 1,
        workflowId: 'project-lifecycle',
        runId: context.runId,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        nodes: {},
        sources: [],
      });
      writeFileSync(file, invalid);
      await assert.rejects(readWorkflowRun(context), { code: 'INVALID_RUN_STATE' });
      assert.equal(readFileSync(file, 'utf8'), invalid);
    });

    it('exposes array-based node and step lookup helpers', async () => {
      const state = await readWorkflowRun(makeContext(dir, 'run-helpers'));
      assert.equal(findNode({ nodes: [state] }, state.id), state);
      assert.equal(findStep(state, 'business-epic').type, 'business-epic');
    });
  });

  describe('dynamic sources', () => {
    let dir;
    before(() => { dir = mkdtempSync(join(tmpdir(), 'engine-sources-')); });
    after(() => rmSync(dir, { recursive: true, force: true }));

    it('adds, updates, lists, and removes validated sources under a run', async () => {
      mkdirSync(join(dir, 'workspace/src/repo'), { recursive: true });
      const context = { workspaceRoot: dir, runId: 'run-sources' };
      const original = {
        id: 'legacy_repo',
        path: 'workspace/src/repo',
        kind: 'repository',
        role: 'legacy',
        stack: 'Java',
      };
      assert.deepEqual(await addSource({ ...context, source: original }), original);
      assert.equal((await listSources(context)).length, 1);
      await assert.rejects(addSource({ ...context, source: original }), { code: 'INVALID_SOURCE' });
      const updated = await updateSource({ ...context, source: { id: original.id, role: 'reference' } });
      assert.equal(updated.role, 'reference');
      assert.equal((await removeSource({ ...context, sourceId: original.id })).id, original.id);
      assert.deepEqual(await listSources(context), []);
    });

    it('rejects traversal and symlinks that escape the workspace', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'engine-outside-'));
      try {
      mkdirSync(join(dir, 'workspace/src'), { recursive: true });
      symlinkSync(outside, join(dir, 'workspace/src/outside'), 'dir');
      const context = { workspaceRoot: dir, runId: 'run-source-path' };
      const base = { id: 'bad', kind: 'repository', role: 'target' };
      await assert.rejects(addSource({ ...context, source: { ...base, path: '../outside' } }), { code: 'INVALID_SOURCE' });
      await assert.rejects(addSource({ ...context, source: { ...base, path: 'workspace/src/outside' } }), { code: 'INVALID_SOURCE' });
      mkdirSync(join(dir, 'workspace/src/repo'), { recursive: true });
      await assert.rejects(addSource({
        ...context,
        source: { ...base, id: 'bad-scope', path: 'workspace/src/repo', scope: '../outside' },
      }), { code: 'INVALID_SOURCE' });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('selects only sources whose roles are allowed for each workflow step', async () => {
      mkdirSync(join(dir, 'workspace/src/legacy'), { recursive: true });
      mkdirSync(join(dir, 'workspace/src/target'), { recursive: true });
      const context = { workspaceRoot: dir, runId: 'run-source-selection', tema: 'Catalog', inputFiles: [] };
      await addSource({
        ...context,
        source: { id: 'legacy', path: 'workspace/src/legacy', kind: 'repository', role: 'legacy' },
      });
      await addSource({
        ...context,
        source: { id: 'target', path: 'workspace/src/target', kind: 'repository', role: 'target' },
      });
      const details = await getReadyStepDetails(context);
      const asIs = details.find(({ id }) => id === 'as-is-knowledge');
      const epic = details.find(({ id }) => id === 'business-epic');
      assert.deepEqual(asIs.sources.map(({ id }) => id), ['legacy']);
      assert.deepEqual(epic.sources, []);
    });
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
