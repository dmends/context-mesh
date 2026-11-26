import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('env.mjs', () => {
  it('exports numeric STATE_SCHEMA_VERSION', async () => {
    const { STATE_SCHEMA_VERSION } = await import('./env.mjs');
    assert.equal(typeof STATE_SCHEMA_VERSION, 'number');
    assert.ok(STATE_SCHEMA_VERSION > 0);
  });

  it('exports numeric MIN_NODE_VERSION', async () => {
    const { MIN_NODE_VERSION } = await import('./env.mjs');
    assert.equal(typeof MIN_NODE_VERSION, 'number');
  });

  it('exports numeric RUN_LOCK_TIMEOUT_MS', async () => {
    const { RUN_LOCK_TIMEOUT_MS } = await import('./env.mjs');
    assert.equal(typeof RUN_LOCK_TIMEOUT_MS, 'number');
    assert.ok(RUN_LOCK_TIMEOUT_MS > 0);
  });

  it('exports numeric RUN_LOCK_STALE_MS', async () => {
    const { RUN_LOCK_STALE_MS } = await import('./env.mjs');
    assert.equal(typeof RUN_LOCK_STALE_MS, 'number');
    assert.ok(RUN_LOCK_STALE_MS > 0);
  });

  it('exports MULTI_CLI_VERSION string', async () => {
    const { MULTI_CLI_VERSION } = await import('./env.mjs');
    assert.equal(typeof MULTI_CLI_VERSION, 'string');
    assert.match(MULTI_CLI_VERSION, /^\d+\.\d+\.\d+/);
  });

  it('exports GITHUB_MCP_READONLY_URL string', async () => {
    const { GITHUB_MCP_READONLY_URL } = await import('./env.mjs');
    assert.equal(typeof GITHUB_MCP_READONLY_URL, 'string');
    assert.match(GITHUB_MCP_READONLY_URL, /^https:\/\//);
  });
});
