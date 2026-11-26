import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const multiCliTools = [
  'Ask-Antigravity',
  'Antigravity-Help',
  'Fetch-Antigravity-Chunk',
  'List-Antigravity-Models',
  'Ask-Claude',
  'Claude-Help',
  'List-Claude-Models',
];

function createDirectory(t, prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function loadMcp() {
  return import('../src/mcp/configure.mjs');
}

test('dry-run previews read-only GitHub and pinned, allowlisted Multi-CLI without writes', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp dry run ');
  const configPath = path.join(root, 'workspace', '.mcp.json');

  const result = await configureMcp({
    client: 'vscode',
    configPath,
    includeMultiCli: true,
    dryRun: true,
  });

  assert.equal(result.status, 'planned');
  assert.equal(existsSync(configPath), false);
  assert.match(result.warnings.join(' '), /also read by Copilot CLI/i);
  assert.equal(result.servers['github-readonly'].type, 'http');
  assert.equal(result.servers['github-readonly'].url, 'https://api.githubcopilot.com/mcp/readonly');
  assert.equal(result.servers['smith-multi-cli'].command, 'npx');
  assert.deepEqual(result.servers['smith-multi-cli'].args, [
    '--yes',
    '@osanoai/multicli@1.5.41',
  ]);
  assert.deepEqual(result.servers['smith-multi-cli'].tools, multiCliTools);
  assert.doesNotMatch(JSON.stringify(result), /token|password|secret|credential/i);
});

test('apply preserves unrelated servers and requires explicit confirmation', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp preserve ');
  const configPath = path.join(root, '.mcp.json');
  const original = {
    custom: { keep: true },
    mcpServers: {
      personal: { type: 'stdio', command: 'my-server', args: [] },
    },
    note: 'local-token-not-for-output',
  };
  writeFileSync(configPath, `${JSON.stringify(original, null, 2)}\n`);
  const { stat } = await import('node:fs/promises');
  const originalMode = (await stat(configPath)).mode & 0o777;
  let preview;

  const result = await configureMcp({
    client: 'vscode',
    configPath,
    confirmChanges: async (plan) => {
      preview = plan;
      return true;
    },
  });

  const saved = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(preview.status, 'planned');
  assert.deepEqual(saved.custom, original.custom);
  assert.deepEqual(saved.mcpServers.personal, original.mcpServers.personal);
  assert.equal(saved.mcpServers['github-readonly'].url, 'https://api.githubcopilot.com/mcp/readonly');
  assert.doesNotMatch(JSON.stringify(preview), /local-token-not-for-output/);
  assert.equal(result.status, 'configured');
  assert.equal((await stat(configPath)).mode & 0o777, originalMode);
});

test('confirmation binds the previewed config path and exact file snapshot', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp stale preview ');
  const configPath = path.join(root, 'personal-mcp.json');
  const original = '{"custom":"before"}\n';
  writeFileSync(configPath, original, { flag: 'w' });

  await assert.rejects(
    configureMcp({
      client: 'jetbrains',
      configPath,
      confirmChanges: async (plan) => {
        assert.equal(plan.configPath, configPath);
        assert.ok(plan.preview.includes(configPath));
        writeFileSync(configPath, '{"custom":"edited while waiting"}\n');
        return true;
      },
    }),
    /changed while awaiting confirmation|changed after preview/i,
  );
  assert.equal(readFileSync(configPath, 'utf8'), '{"custom":"edited while waiting"}\n');
});

test('apply refuses to write without confirmation', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp confirmation ');
  const configPath = path.join(root, '.mcp.json');

  await assert.rejects(
    configureMcp({ client: 'vscode', configPath }),
    /confirmation|authorization/i,
  );
  assert.equal(existsSync(configPath), false);
});

test('declining confirmation leaves an existing configuration unchanged', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp declined ');
  const configPath = path.join(root, '.mcp.json');
  const original = '{"mcpServers":{"personal":{"command":"keep"}}}\n';
  writeFileSync(configPath, original);

  await assert.rejects(
    configureMcp({
      client: 'vscode',
      configPath,
      confirmChanges: async () => false,
    }),
    /not authorized|declined/i,
  );
  assert.equal(readFileSync(configPath, 'utf8'), original);
});

test('existing identical configuration is idempotent without confirmation', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp idempotent ');
  const configPath = path.join(root, '.mcp.json');
  const first = await configureMcp({
    client: 'vscode',
    configPath,
    confirmChanges: async () => true,
  });
  let confirmations = 0;

  const second = await configureMcp({
    client: 'vscode',
    configPath,
    confirmChanges: async () => {
      confirmations += 1;
      return true;
    },
  });

  assert.equal(first.status, 'configured');
  assert.equal(second.status, 'unchanged');
  assert.equal(confirmations, 0);
});

test('server name collision is refused without replacing the existing entry', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp collision ');
  const configPath = path.join(root, '.mcp.json');
  writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { 'github-readonly': { command: 'user-server' } } }),
  );

  await assert.rejects(
    configureMcp({
      client: 'vscode',
      configPath,
      confirmChanges: async () => true,
    }),
    /collision|conflict/i,
  );
  assert.equal(
    JSON.parse(readFileSync(configPath, 'utf8')).mcpServers['github-readonly'].command,
    'user-server',
  );
});

test('invalid JSON and symlinked configuration paths are refused', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp invalid ');
  const invalidPath = path.join(root, 'invalid.json');
  writeFileSync(invalidPath, '{invalid');
  await assert.rejects(
    configureMcp({
      client: 'vscode',
      configPath: invalidPath,
      confirmChanges: async () => true,
    }),
    /valid JSON|parse/i,
  );

  const outside = path.join(root, 'outside.json');
  writeFileSync(outside, '{}');
  const linkedPath = path.join(root, 'linked.json');
  try {
    await import('node:fs/promises').then(({ symlink }) => symlink(outside, linkedPath));
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`Symlinks are unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    configureMcp({
      client: 'vscode',
      configPath: linkedPath,
      confirmChanges: async () => true,
    }),
    /symlink|symbolic link/i,
  );
  assert.equal(readFileSync(outside, 'utf8'), '{}');
});

test('Copilot CLI uses its built-in GitHub server and only adds allowlisted Multi-CLI', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp copilot cli ');
  const configPath = path.join(root, '.mcp.json');

  const result = await configureMcp({
    client: 'copilot-cli',
    configPath,
    includeMultiCli: true,
    dryRun: true,
  });

  assert.equal(result.servers['github-readonly'], undefined);
  assert.deepEqual(result.servers['smith-multi-cli'].tools, multiCliTools);
  assert.equal(existsSync(configPath), false);
});

test('IntelliJ config uses the reported home-relative path and excludes unfiltered Multi-CLI', async (t) => {
  const { configureMcp } = await loadMcp();
  const homeDir = createDirectory(t, 'mcp IntelliJ home ');
  const result = await configureMcp({
    client: 'jetbrains',
    homeDir,
    includeMultiCli: true,
    dryRun: true,
  });

  assert.equal(
    result.configPath,
    path.join(homeDir, '.config', 'github-copilot', 'intellij', 'mcp.json'),
  );
  assert.deepEqual(result.servers['github-readonly'], {
    url: 'https://api.githubcopilot.com/mcp/readonly',
  });
  assert.equal(result.servers['smith-multi-cli'], undefined);
  assert.match(result.warnings.join(' '), /allowlist|tool filtering/i);
});

test('doctor reports configured servers without connecting or exposing credentials', async (t) => {
  const { diagnoseMcpConfiguration, configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp doctor ');
  const configPath = path.join(root, '.mcp.json');
  await configureMcp({
    client: 'vscode',
    configPath,
    confirmChanges: async () => true,
  });

  let commands = 0;
  const diagnosis = await diagnoseMcpConfiguration({
    client: 'vscode',
    configPath,
    runCommand: async () => {
      commands += 1;
      throw new Error('MCP must not be started by doctor');
    },
  });

  assert.equal(diagnosis.ok, true);
  assert.ok(diagnosis.checks.some((check) => check.id === 'github-mcp' && check.ok));
  assert.equal(commands, 0);
  assert.doesNotMatch(JSON.stringify(diagnosis), /token|password|secret|credential/i);
});

test('doctor checks authorized CLI executables without launching agents', async (t) => {
  const { diagnoseMcpConfiguration, configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp cli checks ');
  const bin = path.join(root, 'bin');
  const configPath = path.join(root, '.mcp.json');
  mkdirSync(bin);
  const claudePath = path.join(bin, 'claude');
  writeFileSync(claudePath, '#!/bin/sh\nexit 0\n');
  chmodSync(claudePath, 0o700);
  await configureMcp({
    client: 'vscode',
    configPath,
    includeMultiCli: true,
    confirmChanges: async () => true,
  });
  let commands = 0;

  const diagnosis = await diagnoseMcpConfiguration({
    client: 'vscode',
    configPath,
    pathValue: bin,
    platform: 'darwin',
    runCommand: async () => {
      commands += 1;
    },
  });

  assert.ok(diagnosis.checks.some((check) => check.id === 'claude-cli' && check.ok));
  assert.ok(diagnosis.checks.some((check) => check.id === 'antigravity-cli' && !check.ok));
  assert.ok(diagnosis.checks.some((check) => check.id === 'multicli-runtime' && !check.ok));
  assert.equal(commands, 0);
});

test('Windows executable suffixes and unverified JetBrains config paths are handled explicitly', async (t) => {
  const { diagnoseMcpConfiguration, configureMcp, getMcpConfigPath } = await loadMcp();
  const root = createDirectory(t, 'mcp windows checks ');
  const bin = path.join(root, 'bin');
  const configPath = path.join(root, 'mcp.json');
  mkdirSync(bin);
  for (const executable of ['npx.cmd', 'claude.exe', 'agy.cmd']) {
    writeFileSync(path.join(bin, executable), '');
  }
  await configureMcp({
    client: 'vscode',
    configPath,
    includeMultiCli: true,
    confirmChanges: async () => true,
  });

  const diagnosis = await diagnoseMcpConfiguration({
    client: 'vscode',
    configPath,
    pathValue: bin,
    platform: 'win32',
  });

  assert.ok(diagnosis.checks.some((check) => check.id === 'multicli-runtime' && check.ok));
  assert.ok(diagnosis.checks.some((check) => check.id === 'claude-cli' && check.ok));
  assert.ok(diagnosis.checks.some((check) => check.id === 'antigravity-cli' && check.ok));
  assert.throws(
    () => getMcpConfigPath({ client: 'jetbrains', homeDir: root, platform: 'win32' }),
    /path is not verified on Windows/i,
  );
});

test('doctor marks missing configuration and authentication as pending', async (t) => {
  const { diagnoseMcpConfiguration } = await loadMcp();
  const root = createDirectory(t, 'mcp doctor missing ');

  const diagnosis = await diagnoseMcpConfiguration({
    client: 'jetbrains',
    homeDir: root,
  });

  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.checks.some((check) => check.id === 'github-mcp' && !check.ok));
  assert.ok(diagnosis.checks.some((check) => /authenticat|sign in/i.test(check.message)));
});

test('Multi-CLI cannot be enabled for a client without verified tool filtering', async (t) => {
  const { configureMcp } = await loadMcp();
  const root = createDirectory(t, 'mcp blocked tools ');

  const result = await configureMcp({
    client: 'jetbrains',
    configPath: path.join(root, 'mcp.json'),
    includeMultiCli: true,
    dryRun: true,
  });

  assert.equal(result.servers['smith-multi-cli'], undefined);
  assert.match(result.warnings.join(' '), /disabled|not added/i);
});
