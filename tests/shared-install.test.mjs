import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';
import { buildPackage } from '../build.mjs';
import { initializePlugin } from '../src/installer/init.mjs';
import { diagnoseProject } from '../src/installer/doctor.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'shared workflow '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRoot = join(root, 'package');
  await buildPackage({ output: sourceRoot });
  const sharedRoot = join(root, 'user data');
  const targetRoot = join(root, 'intellij');
  mkdirSync(targetRoot);
  return { root, sourceRoot, sharedRoot, targetRoot, client: 'jetbrains' };
}

test('installs a local workflow viewer without overwriting existing files', async (t) => {
  const options = await fixture(t);
  const viewer = join(options.targetRoot, '.smith/report/index.html');
  const preview = await initializePlugin({ ...options, dryRun: true });
  assert.equal(preview.viewerStatus, 'planned');
  assert.equal(existsSync(viewer), false);
  const installed = await initializePlugin(options);
  assert.equal(installed.viewerPath, viewer);
  assert.equal(installed.viewerStatus, 'installed');
  assert.match(readFileSync(viewer, 'utf8'), /type="file"/);
  assert.doesNotMatch(readFileSync(viewer, 'utf8'), /__WORKFLOW_STEPS__/);
  const readme = readFileSync(join(options.targetRoot, '.smith/README.md'), 'utf8');
  assert.match(readme, /Pergunte ao usuário qual será o nome da iniciativa \(`--run-id`\)/);
  assert.match(readme, /Pergunte qual é o primeiro tema de negócio \(`--tema`\)/);
  assert.match(readme, /workspace\/\.discovery\/<run-id>\/results\/business-epic\//);
  assert.ok(readme.includes(readFileSync(join(options.sourceRoot, 'instructions/initial-project.md'), 'utf8').trim()));
  assert.equal((await initializePlugin(options)).viewerStatus, 'unchanged');
  writeFileSync(viewer, 'custom user content');
  await assert.rejects(initializePlugin(options), /viewer.*conflict/i);
  assert.equal(readFileSync(viewer, 'utf8'), 'custom user content');
});

test('refreshes an unchanged viewer when the packaged viewer changes', async (t) => {
  const options = await fixture(t);
  const first = await initializePlugin(options);
  const original = readFileSync(first.viewerPath, 'utf8');
  const asset = join(options.sourceRoot, 'report/index.html');
  writeFileSync(asset, `${readFileSync(asset, 'utf8')}\n<!-- new version -->\n`);
  assert.equal((await initializePlugin({ ...options, dryRun: true })).viewerStatus, 'update-planned');
  assert.equal(readFileSync(first.viewerPath, 'utf8'), original);
  assert.equal((await initializePlugin(options)).viewerStatus, 'updated');
  assert.match(readFileSync(first.viewerPath, 'utf8'), /new version/);
});

test('force atualiza visualizador antigo sem marcadores atuais', async (t) => {
  const options = await fixture(t);
  const first = await initializePlugin(options);
  const oldViewer = readFileSync(first.viewerPath, 'utf8')
    .replace(/; const initialProjectPrompt = [\s\S]*(?=<\/script>)/, '');
  writeFileSync(first.viewerPath, oldViewer);

  const result = spawnSync(process.execPath, [
    join(options.sourceRoot, 'installer/init.mjs'),
    '--target', options.targetRoot,
    '--shared-root', options.sharedRoot,
    '--client', 'jetbrains',
    '--agent', 'copilot',
    '--force',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).viewerStatus, 'updated');
  assert.match(readFileSync(first.viewerPath, 'utf8'), /const initialProjectPrompt = "# Iniciar Smith/);
});

test('refuses symlinks in the viewer destination before installation', async (t) => {
  const options = await fixture(t);
  const outside = join(options.root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(options.targetRoot, '.smith'));
  await assert.rejects(initializePlugin(options), /symlink/i);
  assert.equal(existsSync(join(outside, 'report/index.html')), false);
  assert.equal(existsSync(options.sharedRoot), false);
});

test('IntelliJ and VS Code use one runtime with nine prompts per project', async (t) => {
  const options = await fixture(t);
  const preview = await initializePlugin({ ...options, dryRun: true });
  assert.equal(preview.status, 'planned');
  assert.equal(existsSync(options.sharedRoot), false);
  assert.equal(existsSync(join(options.targetRoot, '.github')), false);
  const first = await initializePlugin(options);
  const vscode = join(options.root, 'vscode');
  mkdirSync(vscode);
  const second = await initializePlugin({ ...options, targetRoot: vscode, client: 'vscode' });
  assert.equal(first.installPath, second.installPath);
  assert.ok(first.installPath.startsWith(join(options.sharedRoot, 'versions') + sep));
  for (const [result, target] of [[first, options.targetRoot], [second, vscode]]) {
    assert.equal(result.prompts.length, 10);
    for (const { path } of result.prompts) {
      const prompt = readFileSync(path, 'utf8');
      assert.match(prompt, /--tema "<tema>"/);
      assert.match(prompt, /não crie planos auxiliares em disco/);
      if (!path.endsWith('validation-gate.prompt.md')) {
        if (path.endsWith('business-epic.prompt.md')) {
          assert.match(prompt, / publish --workspace /);
          assert.match(prompt, /publish --workspace \. --run-id (?:"<run-id>"|<run-id>) --tema "<tema>"/);
          assert.match(prompt, /input\/business-stories/);
          assert.match(prompt, /input\/transcripts/);
          assert.doesNotMatch(prompt, / complete --workspace /);
        }
        assert.match(prompt, /fonte for diretório, liste recursivamente.*arquivos.*--input/i);
        assert.match(prompt, /não entregue.*apenas.*conversa/i);
        assert.match(prompt, /\.smith\/runs\/<run-id>\.json/);
      }
    }
    assert.equal(existsSync(join(target, '.copilot/plugins/smith')), false);
    const diagnosis = await diagnoseProject({ targetRoot: target, client: result.client, sharedRoot: options.sharedRoot });
    assert.equal(diagnosis.checks.find(({ id }) => id === 'plugin').ok, true);
    assert.equal(diagnosis.checks.find(({ id }) => id === 'client-integration').ok, true);
    const businessEpic = result.prompts.find(({ path }) => path.endsWith('business-epic.prompt.md'));
    const prompt = readFileSync(businessEpic.path, 'utf8');
    const command = prompt.split('\n').find((line) => line.includes(' template --step business-epic'));
    assert.ok(command);
    const template = spawnSync(command, { shell: true, cwd: target, encoding: 'utf8' });
    assert.equal(template.status, 0, template.stderr);
    assert.match(template.stdout, /## Metadados/);
    writeFileSync(join(target, 'story.txt'), 'fixture');
    const launcher = command.slice(0, -'template --step business-epic'.length);
    const context = '--workspace . --run-id fixture --tema "Teste" --input story.txt';
    const ready = spawnSync(`${launcher}ready ${context}`, { shell: true, cwd: target, encoding: 'utf8' });
    assert.equal(ready.status, 0, ready.stderr);
    assert.ok(existsSync(join(target, '.smith/runs/fixture.json')));
    const document = template.stdout.replaceAll('<tema>', 'Teste');
    const publish = spawnSync(`${launcher}publish ${context} --step business-epic`, {
      shell: true, cwd: target, encoding: 'utf8', input: JSON.stringify({ 'business-epic': document }),
    });
    assert.equal(publish.status, 0, publish.stderr);
    assert.equal(readFileSync(join(target, 'workspace/.discovery/fixture/results/business-epic/001-teste.md'), 'utf8'), document);
  }
});

test('a same-version package refreshes the shared runtime and its previous project prompt', async (t) => {
  const options = await fixture(t);
  const first = await initializePlugin(options);
  const asset = 'workflows/prompts/01-business-epic.prompt.md';
  const installed = join(first.installPath, asset);
  const original = readFileSync(installed, 'utf8');
  const prompt = first.prompts.find(({ path }) => path.endsWith('business-epic.prompt.md')).path;
  const originalPrompt = readFileSync(prompt, 'utf8');
  const state = join(options.targetRoot, '.smith/runs/test.json');
  mkdirSync(join(options.targetRoot, '.smith/runs'), { recursive: true });
  writeFileSync(state, '{"keep":true}');
  writeFileSync(join(options.sourceRoot, asset), `${original}\nUpdated epic guidance.\n`);

  const preview = await initializePlugin({ ...options, dryRun: true });
  assert.equal(preview.runtimeStatus, 'reinstall-planned');
  assert.equal(preview.prompts.find(({ path }) => path.endsWith('business-epic.prompt.md')).status, 'update-planned');
  assert.equal(readFileSync(installed, 'utf8'), original);
  assert.equal(readFileSync(prompt, 'utf8'), originalPrompt);
  const result = await initializePlugin(options);
  assert.equal(result.installPath, first.installPath);
  assert.equal(result.runtimeStatus, 'reinstalled');
  assert.match(readFileSync(installed, 'utf8'), /Updated epic guidance/);
  assert.match(readFileSync(prompt, 'utf8'), /Updated epic guidance/);
  assert.equal(readFileSync(state, 'utf8'), '{"keep":true}');
  assert.equal((await initializePlugin(options)).status, 'unchanged');
});

test('shared runtime reinstall refuses unknown entries and symlinks', async (t) => {
  const options = await fixture(t);
  const first = await initializePlugin(options);
  const unknown = join(first.installPath, 'user-data');
  mkdirSync(unknown);
  await assert.rejects(initializePlugin(options), /conflict/i);
  assert.equal(existsSync(unknown), true);
  rmSync(unknown, { recursive: true });
  symlinkSync(join(options.sourceRoot, 'README.md'), unknown);
  await assert.rejects(initializePlugin(options), /symlink/i);
});

test('force removes known retired runtime directories during shared runtime refresh', async (t) => {
  const options = await fixture(t);
  const first = await initializePlugin(options);
  const retiredFile = join(first.installPath, 'report/prototipe/old-preview.html');
  mkdirSync(join(first.installPath, 'report/prototipe'), { recursive: true });
  writeFileSync(retiredFile, '<!doctype html>');
  const retiredSkill = join(first.installPath, 'agents/antigravity/skills/initial-project/SKILL.md');
  mkdirSync(join(first.installPath, 'agents/antigravity/skills/initial-project'), { recursive: true });
  writeFileSync(retiredSkill, '# Obsolete skill');

  await assert.rejects(initializePlugin(options), /unexpected directory/i);
  assert.equal(existsSync(retiredFile), true);
  assert.equal(existsSync(retiredSkill), true);

  const result = spawnSync(process.execPath, [
    join(options.sourceRoot, 'installer/init.mjs'),
    '--target', options.targetRoot,
    '--shared-root', options.sharedRoot,
    '--client', 'jetbrains',
    '--agent', 'copilot',
    '--force',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).runtimeStatus, 'reinstalled');
  assert.equal(existsSync(retiredFile), false);
  assert.equal(existsSync(retiredSkill), false);
  assert.equal(existsSync(join(first.installPath, 'report/prototipe')), false);
});

test('upgrade replaces only known legacy prompts and retires only verified runtime files', async (t) => {
  const options = await fixture(t);
  const legacy = join(options.targetRoot, '.copilot/plugins/smith');
  const template = 'templates/004-business-epic.md';
  const projectPrompt = join(options.targetRoot, '.github/prompts/smith-business-epic.prompt.md');
  const asIsSource = join(options.sourceRoot, 'workflows/prompts/02-as-is-knowledge.prompt.md');
  const asCrlf = (file) => readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n');
  mkdirSync(join(legacy, 'templates'), { recursive: true });
  mkdirSync(join(options.targetRoot, '.github/prompts'), { recursive: true });
  writeFileSync(projectPrompt, asCrlf(join(options.sourceRoot, 'workflows/prompts/01-business-epic.prompt.md')));
  writeFileSync(asIsSource, asCrlf(asIsSource));
  writeFileSync(join(legacy, template), asCrlf(join(options.sourceRoot, template)));
  writeFileSync(join(legacy, 'README.md'), 'local customization');
  const outside = join(options.root, 'outside.txt');
  writeFileSync(outside, 'outside');
  symlinkSync(outside, join(legacy, 'external-link'));
  const statePath = join(options.targetRoot, '.smith/runs/test.json');
  const document = join(options.targetRoot, 'workspace/document.md');
  for (const [file, parent] of [[statePath, '.smith/runs'], [document, 'workspace']]) {
    mkdirSync(join(options.targetRoot, parent), { recursive: true });
    writeFileSync(file, 'preserved');
  }
  const preview = await initializePlugin({ ...options, dryRun: true });
  assert.equal(preview.prompts.find(({ path }) => path.endsWith('business-epic.prompt.md')).status, 'update-planned');
  assert.equal(existsSync(join(legacy, template)), true);
  const result = await initializePlugin(options);
  assert.equal(result.prompts.find(({ path }) => path.endsWith('business-epic.prompt.md')).status, 'updated');
  assert.equal(existsSync(join(legacy, template)), false);
  assert.equal(readFileSync(join(legacy, 'README.md'), 'utf8'), 'local customization');
  assert.ok(result.legacy.retained.includes(join(legacy, 'README.md')));
  assert.ok(result.legacy.retained.includes(join(legacy, 'external-link')));
  assert.equal(readFileSync(outside, 'utf8'), 'outside');
  assert.equal(readFileSync(statePath, 'utf8'), 'preserved');
  assert.equal(readFileSync(document, 'utf8'), 'preserved');
  const asIs = readFileSync(result.prompts[2].path, 'utf8');
  assert.match(asIs, /template --step as-is-knowledge/);
  assert.match(asIs, /000-knowledge-api\.md` para contrato de entrada de API; `001-knowledge-as-is\.md` para outros comportamentos As-Is/);
});

test('upgrade replaces prompts rendered by the previous plugin version', async (t) => {
  const options = await fixture(t);
  const previousPrompts = JSON.parse(readFileSync(new URL('../resources/prompt-history.json', import.meta.url), 'utf8'))['1.2.0'].prompts;
  const promptDirectory = join(options.targetRoot, '.github/prompts');
  mkdirSync(promptDirectory, { recursive: true });
  for (const [destination, content] of Object.entries(previousPrompts)) {
    writeFileSync(join(promptDirectory, destination), content);
  }

  const preview = await initializePlugin({ ...options, dryRun: true });
  assert.ok(preview.prompts.every(({ status }) => status === 'update-planned'));
  const result = await initializePlugin(options);
  assert.equal(result.prompts.length, 10);
  assert.ok(result.prompts.every(({ status }) => status === 'updated'));
  assert.ok(result.prompts.every(({ path }) => readFileSync(path, 'utf8').includes('--tema "<tema>"')));
});

test('doctor rejects a project prompt still pointing at the legacy runtime', async (t) => {
  const options = await fixture(t);
  const installed = await initializePlugin(options);
  writeFileSync(installed.prompts[0].path, readFileSync(join(options.sourceRoot, 'workflows/prompts/01-business-epic.prompt.md')));
  const diagnosis = await diagnoseProject(options);
  assert.equal(diagnosis.checks.find(({ id }) => id === 'plugin').ok, true);
  assert.equal(diagnosis.checks.find(({ id }) => id === 'client-integration').ok, false);
  rmSync(installed.installPath, { recursive: true });
  const missing = await diagnoseProject(options);
  assert.equal(missing.checks.find(({ id }) => id === 'plugin').ok, false);
});

test('ambiguous legacy runtime and CLI instructions survive until explicitly authorized', async (t) => {
  const options = await fixture(t);
  const asset = 'templates/004-business-epic.md';
  const cli = await initializePlugin({ ...options, client: 'copilot-cli' });
  const legacyAsset = join(cli.installPath, asset);
  const instructions = readFileSync(cli.instructionFile);
  const vscode = { ...options, client: 'vscode' };
  const prompt = join(options.targetRoot, '.github/prompts/smith-business-epic.prompt.md');
  const preview = await initializePlugin({ ...vscode, dryRun: true });
  assert.equal(preview.legacy.requiresConfirmation, true);
  await assert.rejects(initializePlugin({
    ...vscode,
    confirmLegacyCleanup: async () => {
      mkdirSync(join(options.targetRoot, '.github/prompts'), { recursive: true });
      writeFileSync(prompt, 'User-authored prompt');
      return true;
    },
  }), /prompt conflict/i);
  assert.equal(existsSync(options.sharedRoot), false);
  assert.equal(readFileSync(prompt, 'utf8'), 'User-authored prompt');
  assert.equal(existsSync(legacyAsset), true);
  rmSync(prompt);
  const declined = await initializePlugin({ ...vscode, confirmLegacyCleanup: async () => false });
  assert.ok(declined.legacy.retained.includes(legacyAsset));
  assert.equal(declined.instructionStatus, 'updated');
  assert.notDeepEqual(readFileSync(cli.instructionFile), instructions);
  assert.match(readFileSync(cli.instructionFile, 'utf8'), /mcp-agents-Ask-(?:Claude|Antigravity)/);
  assert.equal(existsSync(legacyAsset), true);
  let confirmations = 0;
  const approved = await initializePlugin({
    ...vscode,
    confirmLegacyCleanup: async () => { confirmations++; return true; },
  });
  assert.equal(confirmations, 1);
  assert.ok(approved.legacy.removed.includes(legacyAsset));
  assert.equal(existsSync(legacyAsset), false);
  assert.equal(approved.instructionStatus, 'unchanged');
});
