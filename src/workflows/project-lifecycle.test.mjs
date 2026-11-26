import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WORKFLOW_ID, WORKFLOW_STEPS } from './project-lifecycle.mjs';

describe('WORKFLOW_ID', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof WORKFLOW_ID, 'string');
    assert.ok(WORKFLOW_ID.length > 0);
  });
});

describe('WORKFLOW_STEPS', () => {
  it('is a frozen array', () => {
    assert.ok(Array.isArray(WORKFLOW_STEPS));
    assert.ok(Object.isFrozen(WORKFLOW_STEPS));
  });

  it('each step has required fields', () => {
    for (const step of WORKFLOW_STEPS) {
      assert.equal(typeof step.id, 'string', `step.id must be string in ${JSON.stringify(step)}`);
      assert.ok(step.id.length > 0, 'step.id must be non-empty');
      assert.ok(Array.isArray(step.requires), `step.requires must be array in ${step.id}`);
      assert.ok(Array.isArray(step.outputs), `step.outputs must be array in ${step.id}`);
    }
  });

  it('uses source roles instead of fixed legacy/refactored source folders', () => {
    const knowledge = WORKFLOW_STEPS.find(({ id }) => id === 'as-is-knowledge');
    assert.deepEqual(knowledge.sourceRoles, ['legacy', 'reference']);
    assert.equal(knowledge.inputs.some((input) => input.includes('/legado/') || input.includes('/refatorado/')), false);
  });

  it('step ids are unique', () => {
    const ids = WORKFLOW_STEPS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'step ids must be unique');
  });

  it('prereqs form a DAG (no cycles)', () => {
    const stepIds = new Set(WORKFLOW_STEPS.map((s) => s.id));
    for (const step of WORKFLOW_STEPS) {
      for (const req of step.requires) {
        assert.ok(stepIds.has(req), `step "${step.id}" requires unknown step "${req}"`);
      }
    }
    // Topological sort to detect cycles
    const visited = new Set();
    const visiting = new Set();
    function visit(id) {
      if (visited.has(id)) return;
      assert.ok(!visiting.has(id), `Cycle detected at step "${id}"`);
      visiting.add(id);
      const step = WORKFLOW_STEPS.find((s) => s.id === id);
      for (const req of step.requires) visit(req);
      visiting.delete(id);
      visited.add(id);
    }
    for (const step of WORKFLOW_STEPS) visit(step.id);
  });
});
