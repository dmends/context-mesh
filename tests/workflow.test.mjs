import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const engineUrl = new URL('../src/core/engine.mjs', import.meta.url);
const cliPath = fileURLToPath(new URL('../src/core/cli.mjs', import.meta.url));
const workflowUrl = new URL('../src/workflows/project-lifecycle.mjs', import.meta.url);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

async function loadEngine() {
  assert.ok(existsSync(fileURLToPath(engineUrl)), 'Dynamic Workflow engine must exist');
  return import(engineUrl.href);
}

function createWorkspace(t) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'plugin-workflow-'));
  mkdirSync(path.join(workspaceRoot, 'workspace/.discovery/test-topic/results/business-epic'), { recursive: true });
  writeFileSync(path.join(workspaceRoot, 'workspace/.discovery/test-topic/results/business-epic/story.md'), 'story version one');
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function stepState(node, type) {
  return node.steps.find((step) => step.type === type);
}

function artifactReference(node, stepType, name) {
  return stepState(node, stepType).artifacts.find((artifact) => artifact.name === name);
}

function artifact(workspaceRoot, relativePath, content) {
  const absolutePath = path.join(workspaceRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);

  return {
    path: relativePath,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

async function completeStep(engine, context, stepId, artifacts) {
  return engine.runWorkflowStep({
    ...context,
    stepId,
    execute: async ({ workspaceRoot }) => ({
      artifacts: Object.fromEntries(
        Object.entries(artifacts).map(([name, relativePath]) => [
          name,
          artifact(workspaceRoot, relativePath, `${stepId}:${name}`),
        ]),
      ),
    }),
  });
}

async function completeUpstream(engine, context) {
  const initiative = context.tema ? context.runId : 'test-topic';
  await completeStep(engine, context, 'business-epic', {
    'business-epic': `workspace/.discovery/${initiative}/results/business-epic/001-epic.md`,
  });
  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: `workspace/.discovery/${initiative}/results/as-is-knowledge/001-knowledge.md`,
  });
  await completeStep(engine, context, 'discovery-consolidation', {
    'discovery-consolidation': `workspace/.discovery/${initiative}/results/discovery-consolidation/001-consolidation.md`,
  });
  await completeStep(engine, context, 'tech-solution-specification', {
    'tech-solution-specification': `workspace/.discovery/${initiative}/results/tech-solution-specification/001-spec.md`,
  });
  await completeStep(engine, context, 'decision-record', {
    'decision-record': `workspace/.discovery/${initiative}/results/decision-record/001-decision.md`,
  });
}

async function approveGate(engine, context) {
  const gate = (await engine.getReadyStepDetails(context)).find(
    ({ id }) => id === 'validation-gate',
  );
  return engine.approveValidationGate({
    ...context,
    confirmation: 'APPROVE',
    approvalFingerprint: gate.approvalFingerprint,
  });
}

function getApprovalFingerprint(workspaceRoot, runId) {
  const ready = spawnSync(
    process.execPath,
    [
      cliPath,
      'ready',
      '--workspace',
      workspaceRoot,
      '--run-id',
      runId,
      '--tema',
      'test-topic',
      '--input',
      'workspace/.discovery/test-topic/results/business-epic/story.md',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(ready.status, 0, ready.stderr);
  const gate = JSON.parse(ready.stdout).readyStepDetails.find(
    ({ id }) => id === 'validation-gate',
  );
  assert.match(gate?.approvalFingerprint, /^[a-f0-9]{64}$/);
  return gate.approvalFingerprint;
}

function runApprovalCli(workspaceRoot, runId, confirmation, approvalFingerprint) {
  const args = [
    cliPath,
    'approve',
    '--workspace',
    workspaceRoot,
    '--run-id',
    runId,
    '--tema',
    'test-topic',
    '--input',
    'workspace/.discovery/test-topic/results/business-epic/story.md',
  ];
  if (confirmation !== undefined) {
    args.push('--confirmation', confirmation);
  }
  if (approvalFingerprint !== undefined) {
    args.push('--approval-fingerprint', approvalFingerprint);
  }
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('eight workflow stages declare input, output, and template contracts', async () => {
  const { WORKFLOW_STEPS } = await import(workflowUrl.href);

  assert.equal(WORKFLOW_STEPS.length, 8);
  assert.deepEqual(
    WORKFLOW_STEPS.map(({ id }) => id),
    [
      'business-epic',
      'as-is-knowledge',
      'discovery-consolidation',
      'tech-solution-specification',
      'decision-record',
      'validation-gate',
      'story-task-breakdown',
      'technical-refinement',
    ],
  );
  for (const step of WORKFLOW_STEPS) {
    assert.ok(Array.isArray(step.inputs), `${step.id} must declare inputs`);
    assert.ok(Array.isArray(step.outputs), `${step.id} must declare outputs`);
    assert.ok(Array.isArray(step.templates), `${step.id} must declare templates`);
  }
  assert.ok(Array.isArray(WORKFLOW_STEPS[0].sourceRoles));
  assert.ok(WORKFLOW_STEPS[2].inputs.every((input) => input.startsWith('workspace/')));
  assert.equal(WORKFLOW_STEPS.find(({ id }) => id === 'as-is-knowledge').accumulative, true);
});

test('a completed stage passes verified artifact references to its dependent stage', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'handoff', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  await completeStep(engine, context, 'business-epic', {
    'business-epic': 'workspace/.discovery/test-topic/results/business-epic/001-epic.md',
  });
  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md',
  });

  let received;
  await engine.runWorkflowStep({
    ...context,
    stepId: 'discovery-consolidation',
    execute: async ({ prerequisites }) => {
      received = prerequisites;
      return {
        artifacts: {
          'discovery-consolidation': artifact(
            workspaceRoot,
            'workspace/.discovery/test-topic/results/discovery-consolidation/001-consolidation.md',
            'discovery consolidation',
          ),
        },
      };
    },
  });

  assert.deepEqual(Object.keys(received).sort(), ['as-is-knowledge', 'business-epic']);
  assert.equal(received['business-epic']['business-epic'].path, 'workspace/.discovery/test-topic/results/business-epic/001-epic.md');
  assert.equal(received['as-is-knowledge'].knowledge.path, 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md');
});

test('a missing or invalid stage output blocks dependent stages', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'invalid-output', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  await assert.rejects(
    engine.runWorkflowStep({
      ...context,
      stepId: 'business-epic',
      execute: async () => ({ artifacts: {} }),
    }),
    /artifact|output/i,
  );
  await assert.rejects(
    engine.runWorkflowStep({
      ...context,
      stepId: 'discovery-consolidation',
      execute: async () => ({ artifacts: {} }),
    }),
    /blocked|prerequisite/i,
  );

  const state = await engine.readWorkflowRun(context);
  assert.equal(stepState(state, 'business-epic').status, 'failed');
  assert.notEqual(stepState(state, 'discovery-consolidation').status, 'completed');

  await assert.rejects(
    engine.runWorkflowStep({
      ...context,
      stepId: 'discovery-consolidation',
      execute: async () => ({ artifacts: {} }),
    }),
    /blocked|prerequisite/i,
  );
});

test('pending validation approval prevents downstream work', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'pending-gate', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  await completeUpstream(engine, context);

  assert.deepEqual(await engine.getReadySteps(context), ['as-is-knowledge', 'decision-record', 'validation-gate']);
  await assert.rejects(
    engine.runWorkflowStep({
      ...context,
      stepId: 'story-task-breakdown',
      execute: async () => ({ artifacts: {} }),
    }),
    /blocked|prerequisite/i,
  );
  await assert.rejects(
    engine.approveValidationGate({ ...context, confirmation: 'yes' }),
    /explicit|APPROVE|confirmation/i,
  );
});

test('workflow approval refuses artifacts changed after the user reviewed them', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = {
    workspaceRoot,
    runId: 'stale-approval-snapshot',
    inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'],
  };
  await completeUpstream(engine, context);
  const gate = (await engine.getReadyStepDetails(context)).find(
    ({ id }) => id === 'validation-gate',
  );
  const reviewedFingerprint = gate?.approvalFingerprint ?? 'f'.repeat(64);

  writeFileSync(
    path.join(workspaceRoot, 'workspace/.discovery/test-topic/results/discovery-consolidation/001-consolidation.md'),
    'revised after review',
  );
  await engine.readWorkflowRun(context);
  await completeStep(engine, context, 'discovery-consolidation', {
    'discovery-consolidation': 'workspace/.discovery/test-topic/results/discovery-consolidation/002-consolidation.md',
  });
  await completeStep(engine, context, 'tech-solution-specification', {
    'tech-solution-specification': 'workspace/.discovery/test-topic/results/tech-solution-specification/002-spec.md',
  });
  await completeStep(engine, context, 'decision-record', {
    'decision-record': 'workspace/.discovery/test-topic/results/decision-record/002-decision.md',
  });

  await assert.rejects(
    engine.approveValidationGate({
      ...context,
      confirmation: 'APPROVE',
      approvalFingerprint: reviewedFingerprint,
    }),
    /changed|review|fingerprint|approval/i,
  );
  assert.equal(
    stepState(await engine.readWorkflowRun(context), 'validation-gate').status,
    'pending',
  );
});

test('approved validation artifacts are passed to downstream stages', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = {
    workspaceRoot,
    runId: 'approved-handoff',
    inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'],
  };
  await completeUpstream(engine, context);
  await approveGate(engine, context);

  let received;
  await engine.runWorkflowStep({
    ...context,
    stepId: 'story-task-breakdown',
    execute: async ({ prerequisites }) => {
      received = prerequisites;
      return {
        artifacts: {
          'story-task-breakdown': artifact(
            workspaceRoot,
            'workspace/.discovery/test-topic/results/story-task-breakdown/001-breakdown.md',
            'breakdown',
          ),
          'execution-plan': artifact(
            workspaceRoot,
            'workspace/.discovery/test-topic/results/story-task-breakdown/002-plan.md',
            'plan',
          ),
        },
      };
    },
  });

  assert.deepEqual(
    Object.keys(received['validation-gate']).sort(),
    ['decision-record', 'discovery-consolidation', 'tech-solution-specification'],
  );
  assert.equal(
    received['validation-gate']['discovery-consolidation']['discovery-consolidation'].path,
    'workspace/.discovery/test-topic/results/discovery-consolidation/001-consolidation.md',
  );
  const savedState = await engine.readWorkflowRun(context);
  const gateArtifacts = stepState(savedState, 'validation-gate').approvedArtifacts;
  assert.equal(gateArtifacts.find(({ stepType }) => stepType === 'discovery-consolidation').artifacts[0].name, 'discovery-consolidation');
  assert.equal(
    gateArtifacts.find(({ stepType }) => stepType === 'tech-solution-specification').artifacts[0].path,
    'workspace/.discovery/test-topic/results/tech-solution-specification/001-spec.md',
  );
  assert.equal(
    gateArtifacts.find(({ stepType }) => stepType === 'decision-record').artifacts[0].path,
    'workspace/.discovery/test-topic/results/decision-record/001-decision.md',
  );
});

test('execution errors are persisted and stop the dependency chain', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'execution-error', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  await assert.rejects(
    engine.runWorkflowStep({
      ...context,
      stepId: 'business-epic',
      execute: async () => {
        throw new Error('executor failed');
      },
    }),
    /executor failed/,
  );

  const state = await engine.readWorkflowRun(context);
  assert.equal(stepState(state, 'business-epic').status, 'failed');
  assert.match(stepState(state, 'business-epic').error, /executor failed/);
  assert.deepEqual(await engine.getReadySteps(context), ['business-epic', 'as-is-knowledge']);
});

test('run state can be resumed after reloading it from disk', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'resume', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  await completeStep(engine, context, 'business-epic', {
    'business-epic': 'workspace/.discovery/test-topic/results/business-epic/001-epic.md',
  });

  const reloaded = await engine.readWorkflowRun(context);
  assert.equal(stepState(reloaded, 'business-epic').status, 'completed');
  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md',
  });
  assert.deepEqual(await engine.getReadySteps(context), ['as-is-knowledge', 'discovery-consolidation']);
});

test('invalid pre-schema state is rejected and left untouched', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'invalid-run', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  const file = path.join(workspaceRoot, '.smith', 'runs', 'invalid-run.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{"schemaVersion":4,"nodes":{}}');
  await assert.rejects(engine.readWorkflowRun(context), { code: 'INVALID_RUN_STATE' });
  assert.equal(readFileSync(file, 'utf8'), '{"schemaVersion":4,"nodes":{}}');
});

test('state from one run is isolated from another run', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const first = { workspaceRoot, runId: 'run-one', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  const second = { workspaceRoot, runId: 'run-two', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  await completeStep(engine, first, 'business-epic', {
    'business-epic': 'workspace/.discovery/test-topic/results/business-epic/001-run-one-epic.md',
  });

  const firstState = await engine.readWorkflowRun(first);
  const secondState = await engine.readWorkflowRun(second);
  assert.equal(stepState(firstState, 'business-epic').status, 'completed');
  assert.equal(stepState(secondState, 'business-epic').status, 'pending');
});

test('topics under one initiative keep independent state and input fingerprints', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const secondInput = 'workspace/.discovery/test-topic/results/business-epic/second-story.md';
  writeFileSync(path.join(workspaceRoot, secondInput), 'second story version one');
  const first = {
    workspaceRoot,
    runId: 'motor-recorrencia',
    tema: 'Regra da Primeira Parcela',
    inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'],
  };
  const second = {
    workspaceRoot,
    runId: 'motor-recorrencia',
    tema: 'Cadastro e Ciclo de Vida do Contrato',
    inputFiles: [secondInput],
  };

  await completeStep(engine, first, 'business-epic', {
    'business-epic': 'workspace/.discovery/motor-recorrencia/results/business-epic/001-regra-da-primeira-parcela.md',
  });
  assert.equal(stepState(await engine.readWorkflowRun(first), 'business-epic').status, 'completed');
  assert.equal(stepState(await engine.readWorkflowRun(second), 'business-epic').status, 'pending');
  await completeStep(engine, second, 'business-epic', {
    'business-epic': 'workspace/.discovery/motor-recorrencia/results/business-epic/002-cadastro-e-ciclo-de-vida-do-contrato.md',
  });
  assert.equal(stepState(await engine.readWorkflowRun(second), 'business-epic').status, 'completed');

  writeFileSync(path.join(workspaceRoot, secondInput), 'second story version two');
  // Re-running business-epic with the changed input detects the fingerprint change and re-executes;
  // first topic's state must be unaffected
  await completeStep(engine, second, 'business-epic', {
    'business-epic': 'workspace/.discovery/motor-recorrencia/results/business-epic/003-updated.md',
  });
  assert.equal(stepState(await engine.readWorkflowRun(first), 'business-epic').status, 'completed');
});

test('invalid themes and normalized name collisions are rejected', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = {
    workspaceRoot,
    runId: 'topic-slugs',
    tema: 'Regra',
    inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'],
  };
  await engine.readWorkflowRun(context);
  await assert.rejects(
    engine.readWorkflowRun({ ...context, tema: '!!!' }),
    /Invalid tema/,
  );
  await assert.rejects(
    engine.readWorkflowRun({ ...context, tema: 'Regra!' }),
    /collides/,
  );
});

test('changed inputs invalidate prior approval and block dependent stages', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = {
    workspaceRoot,
    runId: 'changed-input',
    inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'],
  };
  await completeUpstream(engine, context);
  await approveGate(engine, context);

  writeFileSync(path.join(workspaceRoot, 'workspace/.discovery/test-topic/results/business-epic/story.md'), 'story version two');
  // Re-running business-epic with the new input triggers fingerprint detection, invalidates all
  // downstream steps (including the gate), then re-executes business-epic with the new fingerprint
  await completeStep(engine, context, 'business-epic', {
    'business-epic': 'workspace/.discovery/test-topic/results/business-epic/002-epic.md',
  });
  const changedState = await engine.readWorkflowRun(context);
  assert.equal(stepState(changedState, 'validation-gate').status, 'pending');
  assert.deepEqual(await engine.getReadySteps(context), ['as-is-knowledge', 'discovery-consolidation']);
  await assert.rejects(
    engine.runWorkflowStep({
      ...context,
      stepId: 'story-task-breakdown',
      execute: async () => ({ artifacts: {} }),
    }),
    /blocked|prerequisite/i,
  );
});


test('dynamic step selection respects prerequisites', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'selection', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  assert.deepEqual(await engine.getReadySteps(context), ['business-epic', 'as-is-knowledge']);
  await completeStep(engine, context, 'business-epic', {
    'business-epic': 'workspace/.discovery/test-topic/results/business-epic/001-epic.md',
  });
  assert.deepEqual(await engine.getReadySteps(context), ['as-is-knowledge']);
  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md',
  });
  assert.deepEqual(await engine.getReadySteps(context), ['as-is-knowledge', 'discovery-consolidation']);
});

test('accumulative step remains in readySteps after completion and can be re-executed', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'accumulation', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md',
  });
  const afterFirst = await engine.readWorkflowRun(context);
  assert.equal(stepState(afterFirst, 'as-is-knowledge').status, 'accumulating');
  assert.ok((await engine.getReadySteps(context)).includes('as-is-knowledge'));

  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/002-knowledge.md',
  });
  const afterSecond = await engine.readWorkflowRun(context);
  assert.equal(stepState(afterSecond, 'as-is-knowledge').status, 'accumulating');
  assert.equal(stepState(afterSecond, 'as-is-knowledge').artifacts.length, 2);
  assert.equal(stepState(afterSecond, 'as-is-knowledge').artifacts.at(-1).path,
    'workspace/.discovery/test-topic/results/as-is-knowledge/002-knowledge.md');
});

test('accumulative step does not invalidate downstream when re-executed', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'accumulation-no-invalidate', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  await completeStep(engine, context, 'business-epic', {
    'business-epic': 'workspace/.discovery/test-topic/results/business-epic/001-epic.md',
  });
  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md',
  });
  await completeStep(engine, context, 'discovery-consolidation', {
    'discovery-consolidation': 'workspace/.discovery/test-topic/results/discovery-consolidation/001-consolidation.md',
  });

  const before = await engine.readWorkflowRun(context);
  assert.equal(stepState(before, 'discovery-consolidation').status, 'completed');

  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/002-knowledge.md',
  });

  const after = await engine.readWorkflowRun(context);
  assert.equal(stepState(after, 'discovery-consolidation').status, 'completed');
});

test('accumulative step allows downstream prerequisites to use accumulating status', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'accumulating-prerequisite', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };

  await completeStep(engine, context, 'business-epic', {
    'business-epic': 'workspace/.discovery/test-topic/results/business-epic/001-epic.md',
  });
  await completeStep(engine, context, 'as-is-knowledge', {
    knowledge: 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md',
  });

  const readySteps = await engine.getReadySteps(context);
  assert.ok(readySteps.includes('discovery-consolidation'), 'discovery-consolidation should be ready when as-is-knowledge is accumulating');
});

test('concurrent independent stage completions preserve both artifacts', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'concurrent-stages', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  const entered = new Set();
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const execute = (stepId, name, output) =>
    engine.runWorkflowStep({
      ...context,
      stepId,
      execute: async ({ workspaceRoot: root }) => {
        entered.add(stepId);
        if (entered.size === 2) {
          release();
        }
        await barrier;
        return { artifacts: { [name]: artifact(root, output, stepId) } };
      },
    });

  await Promise.all([
    execute('business-epic', 'business-epic', 'workspace/.discovery/test-topic/results/business-epic/001-epic.md'),
    execute('as-is-knowledge', 'knowledge', 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md'),
  ]);
  const state = await engine.readWorkflowRun(context);

  assert.equal(stepState(state, 'business-epic').status, 'completed');
  assert.equal(stepState(state, 'as-is-knowledge').status, 'accumulating');
  assert.equal(artifactReference(state, 'business-epic', 'business-epic').path, 'workspace/.discovery/test-topic/results/business-epic/001-epic.md');
  assert.equal(artifactReference(state, 'as-is-knowledge', 'knowledge').path, 'workspace/.discovery/test-topic/results/as-is-knowledge/001-knowledge.md');
});

test('a stage already running in this session cannot be executed twice', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'duplicate-stage', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = engine.runWorkflowStep({
    ...context,
    stepId: 'business-epic',
    execute: async ({ workspaceRoot: root }) => {
      entered();
      await barrier;
      return {
        artifacts: {
          'business-epic': artifact(root, 'workspace/.discovery/test-topic/results/business-epic/001-epic.md', 'business epic'),
        },
      };
    },
  });
  await started;
  try {
    await assert.rejects(
      engine.runWorkflowStep({
        ...context,
        stepId: 'business-epic',
        execute: async () => {
          throw new Error('duplicate executor must not run');
        },
      }),
      /already running/i,
    );
  } finally {
    release();
  }
  await first;
});

test('a stage left running by a prior process is ready to retry', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'interrupted-stage', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  await engine.readWorkflowRun(context);
  const statePath = path.join(workspaceRoot, '.smith', 'runs', 'interrupted-stage.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const savedNode = state.nodes.find(({ id }) => id === 'test-topic');
  Object.assign(stepState(savedNode, 'business-epic'), {
    status: 'running',
    executionPid: Number.MAX_SAFE_INTEGER,
    executionToken: 'stale-execution',
    artifacts: [],
  });
  writeFileSync(statePath, JSON.stringify(state));

  assert.deepEqual(await engine.getReadySteps(context), ['business-epic', 'as-is-knowledge']);
  const reconciled = await engine.readWorkflowRun(context);
  assert.equal(stepState(reconciled, 'business-epic').status, 'failed');
  assert.match(stepState(reconciled, 'business-epic').error, /interrupted/i);
});

test('workflow CLI starts and resumes runs without copying input contents', (t) => {
  const workspaceRoot = createWorkspace(t);
  const legacyState = path.join(workspaceRoot, 'workspace', '.workflow', 'runs', 'cli-run.json');
  mkdirSync(path.dirname(legacyState), { recursive: true });
  writeFileSync(legacyState, '{"legacy":true}\n');
  const args = [
    cliPath,
    'start',
    '--workspace',
    workspaceRoot,
    '--run-id',
    'cli-run',
    '--tema',
    'test-topic',
    '--input',
    'workspace/.discovery/test-topic/results/business-epic/story.md',
  ];
  const start = spawnSync(process.execPath, args, { encoding: 'utf8' });

  assert.equal(start.status, 0, start.stderr);
  assert.deepEqual(JSON.parse(start.stdout).readySteps, ['business-epic', 'as-is-knowledge']);
  assert.ok(JSON.parse(start.stdout).readyStepDetails.every(({ outputs, instructions }) => outputs && instructions));

  const resume = spawnSync(
    process.execPath,
    [...args.slice(0, 1), 'resume', ...args.slice(2)],
    { encoding: 'utf8' },
  );
  assert.equal(resume.status, 0, resume.stderr);

  const persisted = readFileSync(
    path.join(workspaceRoot, '.smith', 'runs', 'cli-run.json'),
    'utf8',
  );
  assert.doesNotMatch(persisted, /story version one/);
  assert.equal(readFileSync(legacyState, 'utf8'), '{"legacy":true}\n');
});

test('CLI resume exposes approved artifact references to the next stage', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'cli-approved-handoff', tema: 'test-topic', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  await completeUpstream(engine, context);
  await approveGate(engine, context);

  const resumed = spawnSync(
    process.execPath,
    [cliPath, 'resume', '--workspace', workspaceRoot, '--run-id', context.runId, '--tema', context.tema, '--input', 'workspace/.discovery/test-topic/results/business-epic/story.md'],
    { encoding: 'utf8' },
  );

  assert.equal(resumed.status, 0, resumed.stderr);
  const output = JSON.parse(resumed.stdout);
  const nextStage = output.readyStepDetails.find(({ id }) => id === 'story-task-breakdown');
  assert.ok(nextStage);
  assert.equal(
    nextStage.prerequisites['validation-gate']['decision-record']['decision-record'].path,
    `workspace/.discovery/${context.runId}/results/decision-record/001-decision.md`,
  );
});

test('workflow CLI records output artifacts by verified relative path', (t) => {
  const workspaceRoot = createWorkspace(t);
  const outputPath = path.join(workspaceRoot, 'workspace/.discovery/cli-complete/results/business-epic/001-epic.md');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, 'business epic');

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'complete',
      '--workspace',
      workspaceRoot,
      '--run-id',
      'cli-complete',
      '--tema',
      'test-topic',
      '--input',
      'workspace/.discovery/test-topic/results/business-epic/story.md',
      '--step',
      'business-epic',
      '--artifact',
      'business-epic=workspace/.discovery/cli-complete/results/business-epic/001-epic.md',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).steps['business-epic'].status, 'completed');
});

test('workflow CLI records validation approval with the exact confirmation', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = {
    workspaceRoot,
    runId: 'cli-explicit-approval',
    tema: 'test-topic',
    inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'],
  };
  await completeUpstream(engine, context);

  const fingerprint = getApprovalFingerprint(workspaceRoot, context.runId);
  const result = runApprovalCli(workspaceRoot, context.runId, 'APPROVE', fingerprint);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).steps['validation-gate'].status, 'completed');
});

test('workflow CLI does not record approval for a missing or inexact confirmation', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const wrongContext = {
    workspaceRoot,
    runId: 'cli-wrong-approval',
    tema: 'test-topic',
    inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'],
  };
  const missingContext = {
    ...wrongContext,
    runId: 'cli-missing-approval',
  };
  await completeUpstream(engine, wrongContext);
  await completeUpstream(engine, missingContext);

  const wrongFingerprint = getApprovalFingerprint(workspaceRoot, wrongContext.runId);
  const wrong = runApprovalCli(workspaceRoot, wrongContext.runId, 'approve', wrongFingerprint);
  const missingFingerprint = getApprovalFingerprint(workspaceRoot, missingContext.runId);
  const missing = runApprovalCli(workspaceRoot, missingContext.runId, undefined, missingFingerprint);

  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /explicit|APPROVE|confirmation/i);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /interactive terminal/i);
  assert.equal(
    stepState(await engine.readWorkflowRun(wrongContext), 'validation-gate').status,
    'pending',
  );
  assert.equal(
    stepState(await engine.readWorkflowRun(missingContext), 'validation-gate').status,
    'pending',
  );
});

test('workflow CLI requires the reviewed fingerprint before prompting for approval', async (t) => {
  const engine = await loadEngine();
  const workspaceRoot = createWorkspace(t);
  const context = { workspaceRoot, runId: 'cli-missing-fingerprint', tema: 'test-topic', inputFiles: ['workspace/.discovery/test-topic/results/business-epic/story.md'] };
  await completeUpstream(engine, context);

  const result = runApprovalCli(workspaceRoot, context.runId);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--approval-fingerprint is required/);
  assert.equal(stepState(await engine.readWorkflowRun(context), 'validation-gate').status, 'pending');
});

test('workflow CLI publish generates file with --name slug', (t) => {
  const workspaceRoot = createWorkspace(t);
  mkdirSync(path.join(workspaceRoot, 'workspace/.discovery/cli-publish/results/as-is-knowledge'), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'publish',
      '--workspace',
      workspaceRoot,
      '--run-id',
      'cli-publish',
      '--tema',
      'test-topic',
      '--step',
      'as-is-knowledge',
      '--name',
      'pix-agendamento',
      '--input',
      'workspace/.discovery/test-topic/results/business-epic/story.md',
    ],
    {
      input: JSON.stringify({ knowledge: '# Knowledge\n\nConteúdo.\n' }),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const artifactPath = output.steps['as-is-knowledge'].artifacts[0].path;
  assert.match(artifactPath, /pix-agendamento\.md$/);
  assert.ok(existsSync(path.join(workspaceRoot, artifactPath)));
});

test('workflow CLI publish defaults to nodeId when --name is not provided', (t) => {
  const workspaceRoot = createWorkspace(t);
  mkdirSync(path.join(workspaceRoot, 'workspace/.discovery/cli-publish-default/results/as-is-knowledge'), { recursive: true });

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'publish',
      '--workspace',
      workspaceRoot,
      '--run-id',
      'cli-publish-default',
      '--tema',
      'test-topic',
      '--step',
      'as-is-knowledge',
      '--input',
      'workspace/.discovery/test-topic/results/business-epic/story.md',
    ],
    {
      input: JSON.stringify({ knowledge: '# Knowledge\n\nConteúdo.\n' }),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const artifactPath = output.steps['as-is-knowledge'].artifacts[0].path;
  assert.match(artifactPath, /test-topic\.md$/);
});

test('workflow CLI publish rejects invalid --name slug', (t) => {
  const workspaceRoot = createWorkspace(t);

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'publish',
      '--workspace',
      workspaceRoot,
      '--run-id',
      'cli-publish-invalid',
      '--tema',
      'test-topic',
      '--step',
      'as-is-knowledge',
      '--name',
      'Invalid Slug!',
      '--input',
      'workspace/.discovery/test-topic/results/business-epic/story.md',
    ],
    {
      input: JSON.stringify({ knowledge: '# Knowledge\n' }),
      encoding: 'utf8',
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--name/);
});

test('project instructions separate Superpowers from workflow orchestration', () => {
  const instructions = readFileSync(
    path.join(repositoryRoot, '.github', 'copilot-instructions.md'),
    'utf8',
  );

  assert.match(instructions, /Superpowers/);
  assert.match(instructions, /Dynamic Workflow/);
  assert.match(instructions, /\.smith\/runs\//);
  assert.match(instructions, /cli\.mjs (start|resume|approve)/);
  assert.match(instructions, /utils\/repository\/sync\/sync\.mjs/);
  assert.match(instructions, /--dry-run/);
  assert.match(instructions, /não .*sincronização.*automaticamente/i);
  assert.doesNotMatch(instructions, /^\*\*\* End of File$/m);
});
