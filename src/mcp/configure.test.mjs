import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, before, after } from 'node:test';
import { getMcpConfigPath, previewMcpConfiguration, diagnoseMcpConfiguration } from './configure.mjs';

describe('getMcpConfigPath', () => {
  it('returns explicit configPath resolved', () => {
    const result = getMcpConfigPath({ client: 'vscode', workspaceRoot: '/ws', configPath: '/custom/mcp.json' });
    assert.equal(result, '/custom/mcp.json');
  });

  it('returns .mcp.json under workspaceRoot for vscode', () => {
    const result = getMcpConfigPath({ client: 'vscode', workspaceRoot: '/my/project' });
    assert.equal(result, '/my/project/.mcp.json');
  });

  it('returns .mcp.json under workspaceRoot for copilot-cli', () => {
    const result = getMcpConfigPath({ client: 'copilot-cli', workspaceRoot: '/my/project' });
    assert.equal(result, '/my/project/.mcp.json');
  });

  it('returns JetBrains path under homeDir on non-Windows', () => {
    const result = getMcpConfigPath({ client: 'jetbrains', homeDir: '/home/user', platform: 'darwin' });
    assert.match(result, /intellij\/mcp\.json$/);
    assert.ok(result.startsWith('/home/user'));
  });

  it('throws for invalid client', () => {
    assert.throws(() => getMcpConfigPath({ client: 'unknown' }), /Unsupported/);
  });

  it('throws when workspaceRoot is missing for vscode', () => {
    assert.throws(() => getMcpConfigPath({ client: 'vscode' }), /workspaceRoot/);
  });
});

describe('previewMcpConfiguration', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-configure-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a plan object with status', async () => {
    const plan = await previewMcpConfiguration({ client: 'vscode', workspaceRoot: dir });
    assert.equal(typeof plan.status, 'string');
    assert.ok(['planned', 'unchanged'].includes(plan.status));
  });

  it('plan includes configPath', async () => {
    const plan = await previewMcpConfiguration({ client: 'vscode', workspaceRoot: dir });
    assert.equal(typeof plan.configPath, 'string');
    assert.ok(plan.configPath.endsWith('.mcp.json'));
  });
});

describe('diagnoseMcpConfiguration', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-diagnose-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns check results array', async () => {
    const result = await diagnoseMcpConfiguration({ client: 'vscode', workspaceRoot: dir });
    assert.ok(Array.isArray(result.checks));
  });
});
