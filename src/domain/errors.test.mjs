import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowError, InstallError, SyncError, ConfigError } from './errors.mjs';

describe('WorkflowError', () => {
  it('has correct name', () => {
    const err = new WorkflowError('STEP_LOCKED', 'step is locked');
    assert.equal(err.name, 'WorkflowError');
  });
  it('has code', () => {
    const err = new WorkflowError('STEP_LOCKED', 'step is locked');
    assert.equal(err.code, 'STEP_LOCKED');
  });
  it('has message', () => {
    const err = new WorkflowError('STEP_LOCKED', 'step is locked');
    assert.equal(err.message, 'step is locked');
  });
  it('is instanceof Error', () => {
    const err = new WorkflowError('STEP_LOCKED', 'step is locked');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof WorkflowError);
  });
  it('supports cause', () => {
    const cause = new Error('root');
    const err = new WorkflowError('PREREQ_NOT_MET', 'blocked', { cause });
    assert.equal(err.cause, cause);
  });
});

describe('InstallError', () => {
  it('has correct name and code', () => {
    const err = new InstallError('UNSUPPORTED_CLIENT', 'bad client');
    assert.equal(err.name, 'InstallError');
    assert.equal(err.code, 'UNSUPPORTED_CLIENT');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof InstallError);
  });
});

describe('SyncError', () => {
  it('has correct name and code', () => {
    const err = new SyncError('CLONE_FAILED', 'git clone failed');
    assert.equal(err.name, 'SyncError');
    assert.equal(err.code, 'CLONE_FAILED');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof SyncError);
  });
});

describe('ConfigError', () => {
  it('has correct name and code', () => {
    const err = new ConfigError('INVALID_MCP_CONFIG', 'bad config');
    assert.equal(err.name, 'ConfigError');
    assert.equal(err.code, 'INVALID_MCP_CONFIG');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ConfigError);
  });
});
