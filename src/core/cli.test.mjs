import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { StepStatus } from '../domain/status.mjs';

const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url));

describe('cli.mjs', () => {
  it('exits with non-zero and prints usage for unknown subcommand', () => {
    const result = spawnSync(process.execPath, [cliPath, 'unknown-subcommand'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.length > 0 || result.stdout.length > 0, 'must print some output');
  });

  it('prints usage without arguments and exits zero', () => {
    const result = spawnSync(process.execPath, [cliPath], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });

  it('limits out-of-order authorization to publish and complete', () => {
    const result = spawnSync(process.execPath, [
      cliPath,
      'status',
      '--run-id', 'authorization-scope',
      '--tema', 'test-topic',
      '--input', 'workspace/story.md',
      '--allow-out-of-order',
    ], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /only valid with complete or publish/i);
  });

  it('initializes an initiative and first theme without source files', (t) => {
    const workspace = mkdtempSync(join(tmpdir(), 'smith-cli-init-'));
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    const args = [
      cliPath,
      'init',
      '--workspace', workspace,
      '--run-id', 'saft-orchestration',
      '--tema', 'Cadastro e ciclo de vida',
    ];

    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const initialized = JSON.parse(result.stdout);
    assert.equal(initialized.runId, 'saft-orchestration');
    assert.equal(initialized.tema, 'Cadastro e ciclo de vida');
    assert.equal(initialized.nodeId, 'cadastro-e-ciclo-de-vida');
    assert.ok(initialized.steps.every(({ status }) => status === StepStatus.PENDING));
    for (const directory of [
      'workspace/.discovery/saft-orchestration/results/as-is-knowledge',
      'workspace/.discovery/saft-orchestration/results/business-epic',
      'workspace/.discovery/saft-orchestration/results/decision-record',
      'workspace/.discovery/saft-orchestration/results/discovery-consolidation',
      'workspace/.discovery/saft-orchestration/results/story-task-breakdown',
      'workspace/.discovery/saft-orchestration/results/tech-solution-specification',
      'workspace/.discovery/saft-orchestration/results/technical-refinement',
      'workspace/.discovery/saft-orchestration/results/validation-gate',
    ]) {
      assert.equal(existsSync(join(workspace, directory)), true, `${directory} should be created`);
    }
    assert.equal(existsSync(join(workspace, 'workspace/.discovery/saft-orchestration/results')), true);
    for (const directory of [
      'workspace/.discovery/saft-orchestration/input/business-stories',
      'workspace/.discovery/saft-orchestration/input/transcripts',
    ]) {
      assert.equal(existsSync(join(workspace, directory)), true, `${directory} should be created`);
    }
    assert.equal(
      existsSync(join(workspace, 'workspace/.discovery/saft-orchestration/plans')),
      false,
      'plans should not be created',
    );
    assert.equal(
      existsSync(join(workspace, 'workspace/.discovery/saft-orchestration/business-epic')),
      false,
      'step folders should only be created under results',
    );

    const persisted = JSON.parse(readFileSync(join(workspace, '.smith/runs/saft-orchestration.json'), 'utf8'));
    assert.equal(persisted.schemaVersion, 1);
    assert.deepEqual(persisted.sources, []);
    assert.equal(persisted.nodes[0].tema, initialized.tema);
  });

  it('supports source catalog operations from JSON stdin', (t) => {
    const workspace = mkdtempSync(join(tmpdir(), 'smith-cli-sources-'));
    t.after(() => rmSync(workspace, { recursive: true, force: true }));
    mkdirSync(join(workspace, 'workspace/src/repo'), { recursive: true });
    const baseArgs = ['--workspace', workspace, '--run-id', 'source-cli'];
    const source = {
      id: 'target-repo',
      path: 'workspace/src/repo',
      kind: 'repository',
      role: 'target',
    };
    const add = spawnSync(process.execPath, [cliPath, 'sources', 'add', ...baseArgs], {
      encoding: 'utf8',
      input: JSON.stringify(source),
    });
    assert.equal(add.status, 0, add.stderr);
    assert.equal(JSON.parse(add.stdout).id, source.id);
    const listed = spawnSync(process.execPath, [cliPath, 'sources', 'list', ...baseArgs], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(listed.stdout).sources, [source]);
    const update = spawnSync(process.execPath, [cliPath, 'sources', 'update', ...baseArgs], {
      encoding: 'utf8',
      input: JSON.stringify({ id: source.id, role: 'reference' }),
    });
    assert.equal(update.status, 0, update.stderr);
    assert.equal(JSON.parse(update.stdout).role, 'reference');
    const remove = spawnSync(process.execPath, [
      cliPath, 'sources', 'remove', ...baseArgs, '--source-id', source.id,
    ], { encoding: 'utf8' });
    assert.equal(remove.status, 0, remove.stderr);
    assert.deepEqual(JSON.parse(spawnSync(process.execPath, [
      cliPath, 'sources', 'list', ...baseArgs,
    ], { encoding: 'utf8' }).stdout).sources, []);
  });
});
