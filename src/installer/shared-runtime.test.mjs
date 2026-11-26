import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSharedClient, sharedDestination, workflowCommand } from './shared-runtime.mjs';

describe('isSharedClient', () => {
  it('returns true for jetbrains and vscode', () => {
    assert.equal(isSharedClient('jetbrains'), true);
    assert.equal(isSharedClient('vscode'), true);
  });

  it('returns false for copilot-cli and unknown clients', () => {
    assert.equal(isSharedClient('copilot-cli'), false);
    assert.equal(isSharedClient('unknown'), false);
    assert.equal(isSharedClient(''), false);
  });
});

describe('sharedDestination', () => {
  it('returns an absolute path with version segment', () => {
    const dest = sharedDestination('1.2.3', '/tmp/shared');
    assert.match(dest, /1\.2\.3/);
    assert.match(dest, /versions/);
  });

  it('throws for invalid version string', () => {
    assert.throws(() => sharedDestination('invalid', '/tmp/shared'), /version/i);
    assert.throws(() => sharedDestination('', '/tmp/shared'), /version/i);
  });

  it('throws for relative sharedRoot', () => {
    assert.throws(() => sharedDestination('1.0.0', 'relative/path'), /absolute/i);
  });

  it('uses provided sharedRoot', () => {
    const dest = sharedDestination('2.0.0', '/custom/root');
    assert.ok(dest.startsWith('/custom/root'), `expected path under /custom/root, got ${dest}`);
  });
});

describe('workflowCommand', () => {
  it('returns a readable node command without base64', () => {
    const cmd = workflowCommand('1.0.0', '/tmp/shared');
    assert.match(cmd, /^node "/);
    assert.doesNotMatch(cmd, /base64/);
    assert.doesNotMatch(cmd, /node -e/);
  });

  it('references run-workflow.mjs', () => {
    const cmd = workflowCommand('1.0.0', '/tmp/shared');
    assert.match(cmd, /run-workflow\.mjs/);
  });

  it('embeds sharedRoot in the path', () => {
    const cmd = workflowCommand('1.0.0', '/custom/root');
    assert.ok(cmd.includes('/custom/root'), `expected /custom/root in command, got ${cmd}`);
  });
});
