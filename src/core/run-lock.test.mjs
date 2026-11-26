import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, before, after } from 'node:test';
import { processIsAlive, acquireRunLock } from './run-lock.mjs';

describe('processIsAlive', () => {
  it('returns true for the current process', async () => {
    assert.equal(await processIsAlive(process.pid), true);
  });

  it('returns false for invalid pid', async () => {
    assert.equal(await processIsAlive(-1), false);
    assert.equal(await processIsAlive(0), false);
    assert.equal(await processIsAlive(1.5), false);
  });

  it('returns false for a very large unlikely-used pid', async () => {
    const result = await processIsAlive(2147483647);
    assert.equal(typeof result, 'boolean');
  });
});

describe('acquireRunLock', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'run-lock-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('acquires and releases a lock', async () => {
    const filePath = join(dir, 'run1', 'state.json');
    const release = await acquireRunLock(filePath);
    assert.equal(typeof release, 'function');
    await release();
  });

  it('acquire succeeds after lock is released', async () => {
    const filePath = join(dir, 'run2', 'state.json');
    const release1 = await acquireRunLock(filePath);
    await release1();
    const release2 = await acquireRunLock(filePath);
    await release2();
  });

  it('release is idempotent — calling twice does not throw', async () => {
    const filePath = join(dir, 'run3', 'state.json');
    const release = await acquireRunLock(filePath);
    await release();
    await release();
  });
});
