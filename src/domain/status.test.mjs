import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StepStatus, CheckStatus, SyncStatus, InstallStatus } from './status.mjs';

describe('StepStatus', () => {
  it('is frozen', () => {
    assert.ok(Object.isFrozen(StepStatus));
  });
  it('has expected values', () => {
    assert.equal(StepStatus.PENDING, 'pending');
    assert.equal(StepStatus.RUNNING, 'running');
    assert.equal(StepStatus.COMPLETED, 'completed');
    assert.equal(StepStatus.ACCUMULATING, 'accumulating');
    assert.equal(StepStatus.BLOCKED, 'blocked');
    assert.equal(StepStatus.READY, 'ready');
    assert.equal(StepStatus.SKIPPED, 'skipped');
    assert.equal(StepStatus.FAILED, 'failed');
  });
  it('is immutable', () => {
    assert.throws(() => { StepStatus.PENDING = 'mutated'; }, TypeError);
  });
});

describe('CheckStatus', () => {
  it('is frozen', () => {
    assert.ok(Object.isFrozen(CheckStatus));
  });
  it('has expected values', () => {
    assert.equal(CheckStatus.OK, 'ok');
    assert.equal(CheckStatus.ERROR, 'error');
    assert.equal(CheckStatus.WARNING, 'warning');
    assert.equal(CheckStatus.SKIP, 'skip');
  });
});

describe('SyncStatus', () => {
  it('is frozen', () => {
    assert.ok(Object.isFrozen(SyncStatus));
  });
  it('has expected values', () => {
    assert.equal(SyncStatus.CLONED, 'cloned');
    assert.equal(SyncStatus.UPDATED, 'updated');
    assert.equal(SyncStatus.UNCHANGED, 'unchanged');
    assert.equal(SyncStatus.PLANNED, 'planned');
    assert.equal(SyncStatus.SKIPPED, 'skipped');
    assert.equal(SyncStatus.AHEAD, 'ahead');
    assert.equal(SyncStatus.DIVERGED, 'diverged');
    assert.equal(SyncStatus.ERROR, 'error');
    assert.equal(SyncStatus.FAILED, 'failed');
  });
});

describe('InstallStatus', () => {
  it('is frozen', () => {
    assert.ok(Object.isFrozen(InstallStatus));
  });
  it('has expected values', () => {
    assert.equal(InstallStatus.PLANNED, 'planned');
    assert.equal(InstallStatus.INSTALLED, 'installed');
    assert.equal(InstallStatus.CONFIGURED, 'configured');
    assert.equal(InstallStatus.UNCHANGED, 'unchanged');
    assert.equal(InstallStatus.CONFLICT, 'conflict');
    assert.equal(InstallStatus.NOT_NEEDED, 'not-needed');
  });
});
