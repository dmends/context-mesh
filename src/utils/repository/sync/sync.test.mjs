import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateSyncConfig } from './sync.mjs';

describe('validateSyncConfig', () => {
  it('throws for missing baseUrl', () => {
    assert.throws(() => validateSyncConfig({ projects: [] }, '/base'), /baseUrl/i);
  });

  it('throws for non-array projects', () => {
    assert.throws(() => validateSyncConfig({ baseUrl: 'https://github.com/', projects: 'bad' }, '/base'));
  });

  it('throws for project with path traversal in folder', () => {
    const config = {
      baseUrl: 'https://github.com/example/',
      projects: [{ folder: '../outside', gitPath: 'repo.git', name: 'Repo' }],
    };
    assert.throws(() => validateSyncConfig(config, '/base'), /traversal|unsafe|outside/i);
  });

  it('accepts valid config', () => {
    const config = {
      baseUrl: 'https://github.com/example/',
      defaultBranch: 'main',
      projects: [{ folder: 'my-project', gitPath: 'my-project.git', name: 'My Project' }],
    };
    assert.doesNotThrow(() => validateSyncConfig(config, '/base'));
  });
});
