import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATE_FILES = [
  '000-knowledge-api.md',
  '001-knowledge-as-is.md',
  '002-discovery-result.md',
  '003-decision-record.md',
  '004-business-epic.md',
  '005-technical-specification.md',
  '006-story-task-breakdown.md',
  '007-execution-plan.md',
  '008-analysis.md',
];
const PROMPT_ASSETS = [
  { file: '00-discovery-consolidation.prompt.md', stageId: 'discovery-consolidation' },
  { file: '01-business-epic.prompt.md', stageId: 'business-epic' },
  { file: '02-as-is-knowledge.prompt.md', stageId: 'as-is-knowledge' },
  { file: '03-discovery-result.prompt.md', stageId: 'discovery-result' },
  { file: '04-decision-record.prompt.md', stageId: 'decision-record' },
  { file: '05-validation-gate.prompt.md', stageId: 'validation-gate' },
  { file: '06-tech-solution-specification.prompt.md', stageId: 'tech-solution-specification' },
  { file: '07-story-task-breakdown.prompt.md', stageId: 'story-task-breakdown' },
  { file: '08-technical-refinement.prompt.md', stageId: 'technical-refinement' },
  { file: '09-analysis.prompt.md', stageId: 'analysis' },
  { file: '10-api-knowledge.prompt.md', stageId: 'as-is-knowledge' },
];
const MCP_DELEGATION_PROMPT_FILES = PROMPT_ASSETS
  .map(({ file }) => file)
  .filter((file) => file !== '05-validation-gate.prompt.md');
const MCP_PATH_GUIDANCE_FILES = [
  'resources/instructions/smith.instructions.md',
  'resources/agents/common/workflow-overview.md',
  ...MCP_DELEGATION_PROMPT_FILES.map((file) => `resources/prompts/${file}`),
];
const AGENT_OUTPUT_FILES = [
  "agents/antigravity/.antigravity-plugin/plugin.json",
  "agents/antigravity/AGENTS.md",
  "agents/antigravity/skills/api-knowledge/SKILL.md",
  "agents/antigravity/skills/as-is-knowledge/SKILL.md",
  "agents/antigravity/skills/business-epic/SKILL.md",
  "agents/antigravity/skills/decision-record/SKILL.md",
  "agents/antigravity/skills/discovery-consolidation/SKILL.md",
  "agents/antigravity/skills/discovery-result/SKILL.md",
  "agents/antigravity/skills/analysis/SKILL.md",
  "agents/antigravity/skills/story-task-breakdown/SKILL.md",
  "agents/antigravity/skills/tech-solution-specification/SKILL.md",
  "agents/antigravity/skills/technical-refinement/SKILL.md",
  "agents/antigravity/skills/using-smith/SKILL.md",
  "agents/antigravity/skills/validation-gate/SKILL.md",
  "agents/claude-code/.claude-plugin/plugin.json",
  "agents/claude-code/.claude/skills/api-knowledge/SKILL.md",
  "agents/claude-code/.claude/skills/as-is-knowledge/SKILL.md",
  "agents/claude-code/.claude/skills/business-epic/SKILL.md",
  "agents/claude-code/.claude/skills/decision-record/SKILL.md",
  "agents/claude-code/.claude/skills/discovery-consolidation/SKILL.md",
  "agents/claude-code/.claude/skills/discovery-result/SKILL.md",
  "agents/claude-code/.claude/skills/analysis/SKILL.md",
  "agents/claude-code/.claude/skills/story-task-breakdown/SKILL.md",
  "agents/claude-code/.claude/skills/tech-solution-specification/SKILL.md",
  "agents/claude-code/.claude/skills/technical-refinement/SKILL.md",
  "agents/claude-code/.claude/skills/using-smith/SKILL.md",
  "agents/claude-code/.claude/skills/validation-gate/SKILL.md",
  "agents/claude-code/CLAUDE.md",
  "agents/codex/.agents/skills/api-knowledge/SKILL.md",
  "agents/codex/.agents/skills/api-knowledge/openai.yaml",
  "agents/codex/.agents/skills/as-is-knowledge/SKILL.md",
  "agents/codex/.agents/skills/as-is-knowledge/openai.yaml",
  "agents/codex/.agents/skills/business-epic/SKILL.md",
  "agents/codex/.agents/skills/business-epic/openai.yaml",
  "agents/codex/.agents/skills/decision-record/SKILL.md",
  "agents/codex/.agents/skills/decision-record/openai.yaml",
  "agents/codex/.agents/skills/discovery-consolidation/SKILL.md",
  "agents/codex/.agents/skills/discovery-consolidation/openai.yaml",
  "agents/codex/.agents/skills/discovery-result/SKILL.md",
  "agents/codex/.agents/skills/discovery-result/openai.yaml",
  "agents/codex/.agents/skills/analysis/SKILL.md",
  "agents/codex/.agents/skills/analysis/openai.yaml",
  "agents/codex/.agents/skills/story-task-breakdown/SKILL.md",
  "agents/codex/.agents/skills/story-task-breakdown/openai.yaml",
  "agents/codex/.agents/skills/tech-solution-specification/SKILL.md",
  "agents/codex/.agents/skills/tech-solution-specification/openai.yaml",
  "agents/codex/.agents/skills/technical-refinement/SKILL.md",
  "agents/codex/.agents/skills/technical-refinement/openai.yaml",
  "agents/codex/.agents/skills/using-smith/SKILL.md",
  "agents/codex/.agents/skills/validation-gate/SKILL.md",
  "agents/codex/.agents/skills/validation-gate/openai.yaml",
  "agents/codex/.codex-plugin/plugin.json",
  "agents/codex/AGENTS.md",
  "agents/copilot/.github/copilot-instructions.md",
  "agents/copilot/.github/instructions/smith.instructions.md",
  "agents/copilot/.github/prompts/smith-api-knowledge.prompt.md",
  "agents/copilot/.github/prompts/smith-as-is-knowledge.prompt.md",
  "agents/copilot/.github/prompts/smith-business-epic.prompt.md",
  "agents/copilot/.github/prompts/smith-decision-record.prompt.md",
  "agents/copilot/.github/prompts/smith-discovery-consolidation.prompt.md",
  "agents/copilot/.github/prompts/smith-analysis.prompt.md",
  "agents/copilot/.github/prompts/smith-story-task-breakdown.prompt.md",
  "agents/copilot/.github/prompts/smith-tech-solution-specification.prompt.md",
  "agents/copilot/.github/prompts/smith-technical-refinement.prompt.md",
  "agents/copilot/.github/prompts/smith-validation-gate.prompt.md",
  "agents/cursor/.cursor-plugin/plugin.json",
  "agents/cursor/.cursor/rules/smith.mdc",
  "agents/cursor/.cursor/skills/api-knowledge/SKILL.md",
  "agents/cursor/.cursor/skills/as-is-knowledge/SKILL.md",
  "agents/cursor/.cursor/skills/business-epic/SKILL.md",
  "agents/cursor/.cursor/skills/decision-record/SKILL.md",
  "agents/cursor/.cursor/skills/discovery-consolidation/SKILL.md",
  "agents/cursor/.cursor/skills/discovery-result/SKILL.md",
  "agents/cursor/.cursor/skills/analysis/SKILL.md",
  "agents/cursor/.cursor/skills/story-task-breakdown/SKILL.md",
  "agents/cursor/.cursor/skills/tech-solution-specification/SKILL.md",
  "agents/cursor/.cursor/skills/technical-refinement/SKILL.md",
  "agents/cursor/.cursor/skills/using-smith/SKILL.md",
  "agents/cursor/.cursor/skills/validation-gate/SKILL.md",
  "agents/gemini-cli/.gemini/skills/api-knowledge/SKILL.md",
  "agents/gemini-cli/.gemini/skills/as-is-knowledge/SKILL.md",
  "agents/gemini-cli/.gemini/skills/business-epic/SKILL.md",
  "agents/gemini-cli/.gemini/skills/decision-record/SKILL.md",
  "agents/gemini-cli/.gemini/skills/discovery-consolidation/SKILL.md",
  "agents/gemini-cli/.gemini/skills/discovery-result/SKILL.md",
  "agents/gemini-cli/.gemini/skills/analysis/SKILL.md",
  "agents/gemini-cli/.gemini/skills/story-task-breakdown/SKILL.md",
  "agents/gemini-cli/.gemini/skills/tech-solution-specification/SKILL.md",
  "agents/gemini-cli/.gemini/skills/technical-refinement/SKILL.md",
  "agents/gemini-cli/.gemini/skills/using-smith/SKILL.md",
  "agents/gemini-cli/.gemini/skills/validation-gate/SKILL.md",
  "agents/gemini-cli/GEMINI.md",
  "agents/gemini-cli/gemini-extension.json"
];
const EXPECTED_PACKAGE_FILES = [
  ...AGENT_OUTPUT_FILES,
  'README.md',
  'config/env.mjs',
  'domain/errors.mjs',
  'domain/status.mjs',
  'core/artifact-transaction.mjs',
  'core/cli.mjs',
  'core/engine.mjs',
  'core/run-lock.mjs',
  'core/state-store.mjs',
  'installer/doctor.mjs',
  'installer/file-writer.mjs',
  'installer/init.mjs',
  'installer/legacy-hashes.txt',
  'installer/legacy-runtime.mjs',
  'installer/prompt-builder.mjs',
  'installer/run-workflow.mjs',
  'installer/shared-runtime.mjs',
  'mcp/configure.mjs',
  'plugin.json',
  'prompt-history.json',
  'report/index.html',
  'report/workflow.css',
  'report/workflow.js',
  'utils/repository/sync/sync.mjs',
  'utils/template-loader.mjs',
  ...TEMPLATE_FILES.map((name) => `templates/${name}`),
  'instructions/initial-project.md',
  'workflows/project-lifecycle.mjs',
  ...PROMPT_ASSETS.map(({ file }) => `workflows/prompts/${file}`),
].sort();

test('MCP delegation guidance requires absolute local paths', () => {
  for (const file of MCP_PATH_GUIDANCE_FILES) {
    const guidance = readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8');
    assert.match(guidance, /somente caminhos absolutos do filesystem local/i, file);
    assert.match(guidance, /resolva qualquer caminho relativo antes da chamada/i, file);
  }

  const instructions = readFileSync(
    path.join(REPOSITORY_ROOT, 'resources/instructions/smith.instructions.md'),
    'utf8',
  );
  assert.match(instructions, /@\/caminho\/absoluto/);
});

test('current guidance only references supported hidden workspace directories', () => {
  const allowed = new Set(['.analysis', '.context', '.discovery']);
  for (const file of [
    'resources/instructions/smith.instructions.md',
    'resources/agents/common/workflow-overview.md',
    ...PROMPT_ASSETS.map(({ file }) => `resources/prompts/${file}`),
    'install.md',
    'docs/project-lifecycle-flow.md',
    'src/installer/init.mjs',
  ]) {
    const guidance = readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8');
    for (const match of guidance.matchAll(/workspace\/(\.[a-z-]+)/g)) {
      assert.ok(allowed.has(match[1]), `${file}: ${match[0]}`);
    }
  }
});

function createDirectory(t, prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function createRepositoryFixture(t) {
  const parent = createDirectory(t, 'plugin package source ');
  const repositoryRoot = path.join(parent, 'source repo');
  mkdirSync(repositoryRoot);
  for (const dir of ['src', 'resources', 'tests']) {
    cpSync(path.join(REPOSITORY_ROOT, dir), path.join(repositoryRoot, dir), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  for (const file of ['build.mjs', 'plugin.json', 'package.json', 'README.md', '.gitignore']) {
    cpSync(path.join(REPOSITORY_ROOT, file), path.join(repositoryRoot, file));
  }
  rmSync(path.join(repositoryRoot, 'dist'), { recursive: true, force: true });
  mkdirSync(path.join(repositoryRoot, '.github'), { recursive: true });
  cpSync(
    path.join(REPOSITORY_ROOT, '.github', 'copilot-instructions.md'),
    path.join(repositoryRoot, '.github', 'copilot-instructions.md'),
  );
  mkdirSync(path.join(repositoryRoot, '.idea'), { recursive: true });
  writeFileSync(path.join(repositoryRoot, '.idea', 'workspace.xml'), 'private-idea-setting\n');
  mkdirSync(path.join(repositoryRoot, '.smith', 'runs'), { recursive: true });
  writeFileSync(
    path.join(repositoryRoot, '.smith', 'runs', 'private-state.json'),
    '{"secret":"package-test-secret"}\n',
  );
  writeFileSync(path.join(repositoryRoot, 'input-projects-full.json'), '{"private":true}\n');
  const outsideSecret = path.join(parent, 'outside-secret.json');
  writeFileSync(outsideSecret, '{"secret":"symlink-target-must-not-be-copied"}\n');
  symlinkSync(
    outsideSecret,
    path.join(repositoryRoot, 'src', 'external-secret.json'),
    'file',
  );
  return { repositoryRoot, outsideSecret };
}

function listPackageFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    const info = lstatSync(absolutePath);
    assert.equal(info.isSymbolicLink(), false, `artifact must not contain symlink ${absolutePath}`);
    if (info.isDirectory()) {
      listPackageFiles(root, absolutePath, files);
    } else {
      files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function runBuild(repositoryRoot, args = []) {
  const scriptPath = realpathSync(path.join(repositoryRoot, 'build.mjs'));
  return spawnSync(
    process.execPath,
    [scriptPath, ...args],
    { encoding: 'utf8' },
  );
}

async function loadBuilder() {
  return import('../build.mjs');
}

test('build CLI uses the default output and logs its absolute path', async (t) => {
  const { repositoryRoot } = createRepositoryFixture(t);
  const expectedOutput = path.join(realpathSync(repositoryRoot), 'dist', 'smith-plugin');

  const result = runBuild(repositoryRoot);

  assert.equal(result.status, 0, `stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).output, expectedOutput);
  assert.equal(existsSync(path.join(expectedOutput, 'plugin.json')), true);
});

test('build CLI keeps --output as a custom destination override', async (t) => {
  const { repositoryRoot } = createRepositoryFixture(t);
  const output = path.join(createDirectory(t, 'plugin custom output '), 'custom artifact');

  const result = runBuild(repositoryRoot, ['--output', output]);

  assert.equal(result.status, 0, `stdout: ${result.stdout}; stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).output, output);
  assert.equal(existsSync(path.join(output, 'plugin.json')), true);
});

test('build CLI refuses to overwrite the default output and preserves existing data', async (t) => {
  const { repositoryRoot } = createRepositoryFixture(t);
  const output = path.join(repositoryRoot, 'dist', 'smith-plugin');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'preserve.txt'), 'user data\n');

  const result = runBuild(repositoryRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exists|overwrite|refus/i);
  assert.equal(readFileSync(path.join(output, 'preserve.txt'), 'utf8'), 'user data\n');
});

test('a second default build replaces the generated package with the current source', (t) => {
  const { repositoryRoot } = createRepositoryFixture(t);
  const output = path.join(repositoryRoot, 'dist', 'smith-plugin');
  const first = runBuild(repositoryRoot);
  assert.equal(first.status, 0, first.stderr);
  const manifestPath = path.join(repositoryRoot, 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '2.0.0' }));
  const second = runBuild(repositoryRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(output, 'plugin.json'), 'utf8')).version, '2.0.0');
});

test('build refuses output paths that alias the plugin source through a symlink', async (t) => {
  const { buildPackage } = await loadBuilder();
  const { repositoryRoot } = createRepositoryFixture(t);
  const alias = path.join(path.dirname(repositoryRoot), 'plugin source alias');
  symlinkSync(path.join(repositoryRoot, 'src'), alias, 'dir');
  const output = path.join(alias, 'dist', 'unapproved-output');

  await assert.rejects(
    buildPackage({ repositoryRoot, output }),
    /overlap|plugin source/i,
  );
  assert.equal(existsSync(path.join(repositoryRoot, 'dist', 'unapproved-output')), false);
});

test('build creates a manifest-valid artifact from the explicit allowlist only', async (t) => {
  const { buildPackage } = await loadBuilder();
  const { repositoryRoot } = createRepositoryFixture(t);
  const output = path.join(createDirectory(t, 'plugin package output '), 'artifact with spaces');

  const result = await buildPackage({ repositoryRoot, output });
  const manifest = JSON.parse(readFileSync(path.join(output, 'plugin.json'), 'utf8'));

  assert.equal(result.status, 'built');
  assert.deepEqual(result.files, EXPECTED_PACKAGE_FILES);
  assert.deepEqual(listPackageFiles(output), EXPECTED_PACKAGE_FILES);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'smith');
  assert.equal(typeof manifest.version, 'string');
  assert.equal(typeof manifest.description, 'string');
  for (const { file, stageId } of PROMPT_ASSETS) {
    const prompt = readFileSync(path.join(output, 'workflows', 'prompts', file), 'utf8');
    assert.match(prompt, new RegExp(stageId));
    assert.match(prompt, /^---\nname: "[^"\n]+"/);
    assert.match(prompt, /\ndescription: "[^"\n]+"/);
    assert.match(prompt, /\n---\n/);
  }
  assert.equal('dependencies' in manifest, false);
  assert.equal(
    readFileSync(path.join(output, 'README.md'), 'utf8'),
    readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8'),
  );
  assert.equal(existsSync(path.join(output, 'agents', 'antigravity', 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(output, 'agents', 'claude-code', 'CLAUDE.md')), true);
  assert.equal(existsSync(path.join(output, 'agents', 'cursor', '.cursor', 'rules', 'smith.mdc')), true);
  assert.equal(existsSync(path.join(output, 'agents', 'codex', 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(output, 'agents', 'gemini-cli', 'GEMINI.md')), true);
  assert.equal(existsSync(path.join(output, 'agents', 'copilot', '.github', 'copilot-instructions.md')), true);
  assert.equal(existsSync(path.join(output, 'agents', 'copilot', '.github', 'instructions', 'smith.instructions.md')), true);
  assert.equal(existsSync(path.join(output, 'assets')), false);
  assert.equal(existsSync(path.join(output, 'instructions', 'initial-project.md')), true);
  assert.equal(existsSync(path.join(output, 'tests')), false);
  assert.equal(existsSync(path.join(output, '.idea')), false);
  assert.equal(existsSync(path.join(output, 'workspace')), false);
  assert.equal(existsSync(path.join(output, 'external-secret.json')), false);
  assert.doesNotMatch(
    listPackageFiles(output).join('\n'),
    /package-test-secret|symlink-target-must-not-be-copied|private-state|input-projects-full|workspace\.xml/,
  );
});

test('artifact installs in isolation and keeps all templates and runtime paths available', async (t) => {
  const { buildPackage } = await loadBuilder();
  const { repositoryRoot } = createRepositoryFixture(t);
  const output = path.join(createDirectory(t, 'plugin isolated artifact '), 'artifact');
  await buildPackage({ repositoryRoot, output });
  const { initializePlugin } = await import(
    pathToFileURL(path.join(output, 'installer', 'init.mjs')).href
  );
  const targetRoot = createDirectory(t, 'plugin isolated target ');
  const result = await initializePlugin({ sourceRoot: output, targetRoot, client: 'vscode', sharedRoot: createDirectory(t, 'shared runtime ') });
  const installedRoot = result.installPath;
  const instructions = readFileSync(result.instructionFile, 'utf8');

  assert.equal(result.status, 'installed');
  for (const template of TEMPLATE_FILES) {
    assert.equal(existsSync(path.join(installedRoot, 'templates', template)), true);
  }
  assert.equal(existsSync(path.join(output, 'instructions', 'initial-project.md')), true);
  assert.match(instructions, /smith-\*/);
  assert.equal(result.prompts.length, 10);
  assert.doesNotMatch(instructions, /plugin\/(?:mcp|utils\/repository\/sync|core)\//);
});

test('build refuses allowlisted source files reached through an external directory symlink', async (t) => {
  const { buildPackage } = await loadBuilder();
  const { repositoryRoot } = createRepositoryFixture(t);
  const templatesPath = path.join(repositoryRoot, 'resources', 'templates');
  const externalTemplates = path.join(path.dirname(repositoryRoot), 'external templates');
  cpSync(templatesPath, externalTemplates, { recursive: true });
  rmSync(templatesPath, { recursive: true });
  symlinkSync(externalTemplates, templatesPath, 'dir');
  const output = path.join(createDirectory(t, 'plugin source symlink output '), 'artifact');

  await assert.rejects(
    buildPackage({ repositoryRoot, output }),
    /symlink|symbolic link/i,
  );
  assert.equal(existsSync(output), false);
});

test('a second default build succeeds when the previous dist has an obsolete file', (t) => {
  const { repositoryRoot } = createRepositoryFixture(t);
  const output = path.join(repositoryRoot, 'dist', 'smith-plugin');
  const first = runBuild(repositoryRoot);
  assert.equal(first.status, 0, first.stderr);
  writeFileSync(path.join(output, 'obsolete-stale-artifact.txt'), 'stale artifact\n');
  const second = runBuild(repositoryRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(existsSync(path.join(output, 'obsolete-stale-artifact.txt')), false);
});

test('build refuses to overwrite an existing output directory', async (t) => {
  const { buildPackage } = await loadBuilder();
  const { repositoryRoot } = createRepositoryFixture(t);
  const output = path.join(createDirectory(t, 'plugin package collision '), 'artifact');
  mkdirSync(output);
  writeFileSync(path.join(output, 'preserve.txt'), 'user data\n');

  await assert.rejects(
    buildPackage({ repositoryRoot, output }),
    /exists|overwrite|refus/i,
  );
  assert.equal(readFileSync(path.join(output, 'preserve.txt'), 'utf8'), 'user data\n');
});

test('buildAgentArtifacts creates pre-rendered outputs for each supported agent', async (t) => {
  const { buildAgentArtifacts } = await loadBuilder();
  const { repositoryRoot } = createRepositoryFixture(t);
  const distRoot = path.join(createDirectory(t, 'agent-build-dist-'), 'dist');

  const result = await buildAgentArtifacts({ repositoryRoot, distRoot });
  assert.equal(result.status, 'built');

  const expectedAgents = ['copilot', 'claude-code', 'antigravity', 'codex', 'cursor', 'gemini-cli'];
  for (const agent of expectedAgents) {
    assert.ok(result.agents[agent], `Agent ${agent} must be in build result`);
    const agentDir = path.join(distRoot, agent);
    assert.equal(existsSync(agentDir), true, `Directory must exist for ${agent}`);
  }

  // Copilot checks
  assert.equal(existsSync(path.join(distRoot, 'copilot', '.github', 'instructions', 'smith.instructions.md')), true);
  assert.equal(existsSync(path.join(distRoot, 'copilot', '.github', 'copilot-instructions.md')), true);
  const copilotPrompts = readdirSync(path.join(distRoot, 'copilot', '.github', 'prompts'));
  assert.equal(copilotPrompts.length, 10);

  // Antigravity checks
  assert.equal(existsSync(path.join(distRoot, 'antigravity', '.antigravity-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(distRoot, 'antigravity', 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(distRoot, 'antigravity', 'skills', 'using-smith', 'SKILL.md')), true);
  const antigravitySkills = readdirSync(path.join(distRoot, 'antigravity', 'skills'));
  assert.equal(antigravitySkills.length, 12);

  // Claude Code checks
  assert.equal(existsSync(path.join(distRoot, 'claude-code', '.claude-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(distRoot, 'claude-code', 'CLAUDE.md')), true);
  assert.equal(existsSync(path.join(distRoot, 'claude-code', '.claude', 'skills', 'using-smith', 'SKILL.md')), true);

  // Codex checks
  assert.equal(existsSync(path.join(distRoot, 'codex', '.codex-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(distRoot, 'codex', 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(distRoot, 'codex', '.agents', 'skills', 'discovery-consolidation', 'openai.yaml')), true);

  // Cursor checks
  assert.equal(existsSync(path.join(distRoot, 'cursor', '.cursor-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(distRoot, 'cursor', '.cursor', 'rules', 'smith.mdc')), true);

  // Gemini CLI checks
  assert.equal(existsSync(path.join(distRoot, 'gemini-cli', 'gemini-extension.json')), true);
  assert.equal(existsSync(path.join(distRoot, 'gemini-cli', 'GEMINI.md')), true);
});

test('default build generates smith-plugin and all agent directories', (t) => {
  const { repositoryRoot } = createRepositoryFixture(t);
  const result = runBuild(repositoryRoot);
  assert.equal(result.status, 0, result.stderr);

  const distDir = path.join(realpathSync(repositoryRoot), 'dist');
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'plugin.json')), true);
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'agents', 'antigravity', 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'agents', 'claude-code', 'CLAUDE.md')), true);
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'agents', 'cursor', '.cursor', 'rules', 'smith.mdc')), true);
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'agents', 'codex', 'AGENTS.md')), true);
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'agents', 'gemini-cli', 'GEMINI.md')), true);
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'agents', 'copilot', '.github', 'copilot-instructions.md')), true);
  assert.equal(existsSync(path.join(distDir, 'smith-plugin', 'agents', 'copilot', '.github', 'prompts')), true);
  assert.equal(existsSync(path.join(distDir, 'antigravity')), false);
  assert.equal(existsSync(path.join(distDir, 'claude-code')), false);
  assert.equal(existsSync(path.join(distDir, 'cursor')), false);
  assert.equal(existsSync(path.join(distDir, 'codex')), false);
  assert.equal(existsSync(path.join(distDir, 'gemini-cli')), false);
  assert.equal(existsSync(path.join(distDir, 'copilot')), false);
});

test('standalone unzipped package installs in complete isolation without repo or sibling dist', async (t) => {
  const { buildPackage } = await loadBuilder();
  const { repositoryRoot } = createRepositoryFixture(t);
  const buildOutput = path.join(createDirectory(t, 'build-out-root- '), 'smith-plugin');
  await buildPackage({ repositoryRoot, output: buildOutput });

  // Simula cópia pura do ZIP sem pastas irmãs nem repo
  const isolatedDir = path.join(createDirectory(t, 'isolated-pkg-root- '), 'smith-plugin');
  cpSync(buildOutput, isolatedDir, { recursive: true });

  const { initializePlugin, installAgentPlugin } = await import(
    pathToFileURL(path.join(isolatedDir, 'installer', 'init.mjs')).href
  );

  const targetCopilot = createDirectory(t, 'target-copilot- ');
  const resCopilot = await initializePlugin({ sourceRoot: isolatedDir, targetRoot: targetCopilot, client: 'copilot-cli', dryRun: true });
  assert.equal(resCopilot.status, 'planned');

  const targetAgent = createDirectory(t, 'target-agent- ');
  const resAgent = await installAgentPlugin({ sourceRoot: isolatedDir, targetRoot: targetAgent, agent: 'cursor' });
  assert.equal(resAgent.agent, 'cursor');
  assert.equal(existsSync(path.join(targetAgent, '.cursor', 'rules', 'smith.mdc')), true);
});
