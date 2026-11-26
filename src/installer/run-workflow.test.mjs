import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const launcherPath = fileURLToPath(new URL('./run-workflow.mjs', import.meta.url));

describe('run-workflow.mjs', () => {
  it('delegates to cli.mjs and prints usage with no arguments', () => {
    const result = spawnSync(process.execPath, [launcherPath], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });

  it('propagates exit code from cli.mjs for unknown subcommand', () => {
    const result = spawnSync(process.execPath, [launcherPath, 'unknown-subcommand'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  });

  it('passes arguments through to cli.mjs', () => {
    const result = spawnSync(process.execPath, [launcherPath, 'template', '--step', 'nonexistent-step'], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
  });
});
