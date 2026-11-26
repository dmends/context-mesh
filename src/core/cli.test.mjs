import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

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
