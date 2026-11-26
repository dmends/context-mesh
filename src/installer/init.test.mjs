import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('init.mjs', () => {
  it('exports initializePlugin as a function', async () => {
    const { initializePlugin } = await import('./init.mjs');
    assert.equal(typeof initializePlugin, 'function');
  });

  it('exports installAgentPlugin as a function', async () => {
    const { installAgentPlugin } = await import('./init.mjs');
    assert.equal(typeof installAgentPlugin, 'function');
  });

  it('installAgentPlugin rejects unsupported agents', async () => {
    const { installAgentPlugin } = await import('./init.mjs');
    await assert.rejects(
      () => installAgentPlugin({ targetRoot: '/tmp', agent: 'unknown-agent' }),
      /Unsupported agent/,
    );
  });
});
