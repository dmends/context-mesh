import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, before, after } from 'node:test';
import { diagnoseProject } from './doctor.mjs';
import { CheckStatus } from '../domain/status.mjs';

describe('diagnoseProject', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'doctor-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('throws when targetRoot is missing', async () => {
    await assert.rejects(() => diagnoseProject({ client: 'vscode' }), TypeError);
  });

  it('returns checks array with target check', async () => {
    const result = await diagnoseProject({
      targetRoot: dir,
      client: 'vscode',
      copilotAvailable: false,
      gitAvailable: false,
    });
    assert.ok(Array.isArray(result.checks));
    const target = result.checks.find((c) => c.id === 'target');
    assert.ok(target, 'target check must exist');
    assert.equal(target.ok, true);
  });

  it('target check fails for non-existent directory', async () => {
    const result = await diagnoseProject({
      targetRoot: join(dir, 'nonexistent'),
      client: 'vscode',
      copilotAvailable: false,
      gitAvailable: false,
    });
    const target = result.checks.find((c) => c.id === 'target');
    assert.equal(target.ok, false);
  });

  it('node version check passes for current version', async () => {
    const result = await diagnoseProject({
      targetRoot: dir,
      client: 'vscode',
      nodeVersion: process.versions.node,
      copilotAvailable: false,
      gitAvailable: false,
    });
    const nodeCheck = result.checks.find((c) => c.id === 'node');
    assert.equal(nodeCheck.ok, true);
  });

  it('node version check fails for old version', async () => {
    const result = await diagnoseProject({
      targetRoot: dir,
      client: 'vscode',
      nodeVersion: '18.0.0',
      copilotAvailable: false,
      gitAvailable: false,
    });
    const nodeCheck = result.checks.find((c) => c.id === 'node');
    assert.equal(nodeCheck.ok, false);
  });
});
