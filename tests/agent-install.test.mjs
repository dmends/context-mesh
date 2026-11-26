import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPackage } from '../build.mjs';
import { installAgentPlugin } from '../src/installer/init.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

function createDirectory(t, prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('installAgentPlugin installs standalone antigravity files', async (t) => {
  const distParent = createDirectory(t, 'agent-build-');
  const customDist = path.join(distParent, 'dist', 'smith-plugin');
  await buildPackage({ repositoryRoot: REPOSITORY_ROOT, output: customDist });

  const targetRoot = createDirectory(t, 'antigravity-target-');
  const result = await installAgentPlugin({
    sourceRoot: customDist,
    targetRoot,
    agent: 'antigravity',
  });

  assert.equal(result.status, 'installed');
  assert.equal(result.agent, 'antigravity');

  // Verify Antigravity files
  assert.equal(existsSync(path.join(targetRoot, '.antigravity-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(targetRoot, 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(targetRoot, 'skills', 'using-smith', 'SKILL.md')), true);
  assert.equal(existsSync(path.join(targetRoot, 'skills', 'discovery-consolidation', 'SKILL.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.github')), false);
  assert.equal(existsSync(path.join(targetRoot, 'workspace', '.context')), true);
  assert.equal(existsSync(path.join(targetRoot, 'workspace', '.discovery')), true);
  assert.equal(existsSync(path.join(targetRoot, 'workspace', '.knowledge')), true);
  assert.equal(existsSync(path.join(targetRoot, 'workspace', 'src')), true);

  const skills = readdirSync(path.join(targetRoot, 'skills'));
  assert.equal(skills.length, 12);
});

test('installAgentPlugin installs standalone claude-code files', async (t) => {
  const targetRoot = createDirectory(t, 'claude-target-');
  const result = await installAgentPlugin({
    sourceRoot: REPOSITORY_ROOT,
    targetRoot,
    agent: 'claude-code',
  });

  assert.equal(result.status, 'installed');
  assert.equal(existsSync(path.join(targetRoot, '.claude-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(targetRoot, 'CLAUDE.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.claude', 'skills', 'using-smith', 'SKILL.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.claude', 'skills', 'decision-record', 'SKILL.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.github')), false);
});

test('installAgentPlugin installs standalone cursor files', async (t) => {
  const targetRoot = createDirectory(t, 'cursor-target-');
  const result = await installAgentPlugin({
    sourceRoot: REPOSITORY_ROOT,
    targetRoot,
    agent: 'cursor',
  });

  assert.equal(result.status, 'installed');
  assert.equal(existsSync(path.join(targetRoot, '.cursor-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(targetRoot, '.cursor', 'rules', 'smith.mdc')), true);
  assert.equal(existsSync(path.join(targetRoot, '.cursor', 'skills', 'using-smith', 'SKILL.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.github')), false);
});

test('installAgentPlugin installs standalone codex files including openai.yaml', async (t) => {
  const targetRoot = createDirectory(t, 'codex-target-');
  const result = await installAgentPlugin({
    sourceRoot: REPOSITORY_ROOT,
    targetRoot,
    agent: 'codex',
  });

  assert.equal(result.status, 'installed');
  assert.equal(existsSync(path.join(targetRoot, '.codex-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(targetRoot, 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.agents', 'skills', 'using-smith', 'SKILL.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.agents', 'skills', 'discovery-consolidation', 'openai.yaml')), true);
  assert.equal(existsSync(path.join(targetRoot, '.github')), false);
});

test('installAgentPlugin installs standalone gemini-cli files', async (t) => {
  const targetRoot = createDirectory(t, 'gemini-target-');
  const result = await installAgentPlugin({
    sourceRoot: REPOSITORY_ROOT,
    targetRoot,
    agent: 'gemini-cli',
  });

  assert.equal(result.status, 'installed');
  assert.equal(existsSync(path.join(targetRoot, 'gemini-extension.json')), true);
  assert.equal(existsSync(path.join(targetRoot, 'GEMINI.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.gemini', 'skills', 'using-smith', 'SKILL.md')), true);
  assert.equal(existsSync(path.join(targetRoot, '.github')), false);
});

test('CLI --agent installs directly without --client', async (t) => {
  const targetRoot = createDirectory(t, 'cli-agent-target-');
  const initScript = path.join(REPOSITORY_ROOT, 'src', 'installer', 'init.mjs');

  const result = spawnSync(
    process.execPath,
    [initScript, '--target', targetRoot, '--agent', 'antigravity'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}, stdout: ${result.stdout}`);
  assert.equal(existsSync(path.join(targetRoot, '.antigravity-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(targetRoot, 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(targetRoot, 'skills', 'using-smith', 'SKILL.md')), true);
});
