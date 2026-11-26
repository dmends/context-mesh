import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
});
