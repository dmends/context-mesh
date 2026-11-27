import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const initUrl = new URL('../src/installer/init.mjs', import.meta.url);
const doctorUrl = new URL('../src/installer/doctor.mjs', import.meta.url);
const { version: pluginVersion } = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
const JETBRAINS_PROMPTS = [
  { source: '00-discovery-consolidation.prompt.md', destination: 'smith-discovery-consolidation.prompt.md', stage: 'discovery-consolidation' },
  { source: '01-business-epic.prompt.md', destination: 'smith-business-epic.prompt.md', stage: 'business-epic' },
  { source: '02-as-is-knowledge.prompt.md', destination: 'smith-as-is-knowledge.prompt.md', stage: 'as-is-knowledge' },
  { source: '04-decision-record.prompt.md', destination: 'smith-decision-record.prompt.md', stage: 'decision-record' },
  { source: '05-validation-gate.prompt.md', destination: 'smith-validation-gate.prompt.md', stage: 'validation-gate' },
  { source: '06-tech-solution-specification.prompt.md', destination: 'smith-tech-solution-specification.prompt.md', stage: 'tech-solution-specification' },
  { source: '07-story-task-breakdown.prompt.md', destination: 'smith-story-task-breakdown.prompt.md', stage: 'story-task-breakdown' },
  { source: '08-technical-refinement.prompt.md', destination: 'smith-technical-refinement.prompt.md', stage: 'technical-refinement' },
  { source: '09-analysis.prompt.md', destination: 'smith-analysis.prompt.md', stage: 'analysis' },
  { source: '10-api-knowledge.prompt.md', destination: 'smith-api-knowledge.prompt.md', stage: 'as-is-knowledge' },
];

function createDirectory(t, prefix) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function createPluginFixture(t) {
  const sourceRoot = path.join(createDirectory(t, 'plugin-installer-source-'), 'plugin');
  mkdirSync(path.join(sourceRoot, 'assets'), { recursive: true });
  mkdirSync(path.join(sourceRoot, 'core'), { recursive: true });
  mkdirSync(path.join(sourceRoot, 'installer'), { recursive: true });
  mkdirSync(path.join(sourceRoot, 'instructions'), { recursive: true });
  mkdirSync(path.join(sourceRoot, 'report'), { recursive: true });
  mkdirSync(path.join(sourceRoot, 'templates'), { recursive: true });
  mkdirSync(path.join(sourceRoot, 'workflows', 'prompts'), { recursive: true });
  writeFileSync(
    path.join(sourceRoot, 'plugin.json'),
    JSON.stringify({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'smith',
      version: pluginVersion,
    }),
  );
  writeFileSync(path.join(sourceRoot, 'assets', 'copilot-instructions.md'), '# Package instructions\nUse mcp-agents-Ask-Claude for each workflow stage.\n');
  writeFileSync(path.join(sourceRoot, 'core', 'engine.mjs'), 'export {};\n');
  writeFileSync(path.join(sourceRoot, 'report', 'index.html'), readFileSync(new URL('../src/report/index.html', import.meta.url)));
  writeFileSync(path.join(sourceRoot, 'report', 'workflow.css'), readFileSync(new URL('../src/report/workflow.css', import.meta.url)));
  writeFileSync(path.join(sourceRoot, 'report', 'workflow.js'), readFileSync(new URL('../src/report/workflow.js', import.meta.url)));
  writeFileSync(path.join(sourceRoot, 'instructions', 'initial-project.md'), readFileSync(new URL('../resources/instructions/initial-project.md', import.meta.url)));
  writeFileSync(path.join(sourceRoot, 'templates', 'sample.md'), 'template\n');
  const promptHistory = Object.fromEntries(['1.1.0', '1.2.0'].map((version) => [
    version,
    {
      prompts: Object.fromEntries(JETBRAINS_PROMPTS.map(({ destination }) => [
        destination,
        createHash('sha256').update(`Previous ${version} prompt\n`).digest('hex'),
      ])),
    },
  ]));
  writeFileSync(path.join(sourceRoot, 'prompt-history.json'), `${JSON.stringify(promptHistory)}\n`);
  writeFileSync(
    path.join(sourceRoot, 'instructions', 'smith.instructions.md'),
    readFileSync(new URL('../resources/instructions/smith.instructions.md', import.meta.url)),
  );
  addJetBrainsPromptAssets(sourceRoot);
  return sourceRoot;
}

function addJetBrainsPromptAssets(sourceRoot) {
  const promptDirectory = path.join(sourceRoot, 'workflows', 'prompts');
  mkdirSync(promptDirectory, { recursive: true });
  for (const { source, stage } of JETBRAINS_PROMPTS) {
    writeFileSync(
      path.join(promptDirectory, source),
      `---\ndescription: ${stage}\n---\nPrompt stage: ${stage}\nnode .copilot/plugins/smith/core/cli.mjs ready\n`,
    );
  }
}

async function loadInit() {
  assert.ok(existsSync(fileURLToPath(initUrl)), 'installer entry point must exist');
  const { initializePlugin } = await import(initUrl.href);
  return { initializePlugin: (options) => initializePlugin({ sharedRoot: `${options.targetRoot}-runtime`, ...options }) };
}

async function loadDoctor() {
  assert.ok(existsSync(fileURLToPath(doctorUrl)), 'doctor entry point must exist');
  const { diagnoseProject } = await import(doctorUrl.href);
  return { diagnoseProject: (options) => diagnoseProject({ sharedRoot: `${options.targetRoot}-runtime`, ...options }) };
}

test('new install is project-local and preserves existing Copilot instructions', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = path.join(createDirectory(t, 'project-with-instructions '), 'target project');
  mkdirSync(path.join(targetRoot, '.github'), { recursive: true });
  const instructionPath = path.join(targetRoot, '.github', 'copilot-instructions.md');
  writeFileSync(instructionPath, 'personal project instructions\n');
  let externalCommands = 0;

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    runCommand: async () => {
      externalCommands += 1;
    },
  });

  assert.equal(result.status, 'installed');
  assert.equal(
    readFileSync(path.join(result.installPath, 'templates', 'sample.md'), 'utf8'),
    'template\n',
  );
  assert.equal(readFileSync(instructionPath, 'utf8'), 'personal project instructions\n');
  assert.equal(externalCommands, 0);
});

test('JetBrains install adds all Copilot prompts without replacing project instructions', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const targetRoot = path.join(createDirectory(t, 'jetbrains-project '), 'target project');
  mkdirSync(path.join(targetRoot, '.github'), { recursive: true });
  const instructionPath = path.join(targetRoot, '.github', 'copilot-instructions.md');
  writeFileSync(instructionPath, 'existing project instructions\n');

  const result = await initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' });

  assert.equal(result.status, 'installed');
  assert.equal(result.client, 'jetbrains');
  assert.equal(result.pluginActivated, false);
  assert.equal(result.mcpConfiguration, undefined);
  assert.equal(result.instructionStatus, 'installed');
  const workflowInstructions = path.join(
    targetRoot,
    '.github',
    'instructions',
    'smith.instructions.md',
  );
  assert.equal(existsSync(workflowInstructions), true);
  assert.match(readFileSync(workflowInstructions, 'utf8'), /applyTo: "\*\*"/);
  assert.match(readFileSync(workflowInstructions, 'utf8'), /leia o arquivo correspondente.*por inteiro/);
  assert.match(readFileSync(workflowInstructions, 'utf8'), /mcp-agents-Ask-(?:Claude|Antigravity)/);
  assert.match(readFileSync(workflowInstructions, 'utf8'), /smith-business-epic\.prompt\.md/);
  assert.equal(readFileSync(instructionPath, 'utf8'), 'existing project instructions\n');
  assert.match(result.nextStep.action, /Copilot Chat in IntelliJ/i);
  assert.doesNotMatch(result.nextStep.action, /VS Code|Agent Plugins/i);
  assert.deepEqual(
    result.prompts.map(({ path: promptPath, status }) => ({
      path: path.relative(targetRoot, promptPath).split(path.sep).join('/'),
      status,
    })),
    JETBRAINS_PROMPTS.map(({ destination }) => ({
      path: `.github/prompts/${destination}`,
      status: 'installed',
    })),
  );
  for (const { source, destination, stage } of JETBRAINS_PROMPTS) {
    const installedPrompt = path.join(targetRoot, '.github', 'prompts', destination);
    const installedContent = readFileSync(installedPrompt, 'utf8');
    assert.ok(installedContent.includes(`Prompt stage: ${stage}\n`));
    assert.ok(installedContent.includes('" ready') || installedContent.includes(' ready'));
    assert.ok(result.changedFiles.includes(installedPrompt));
    assert.equal(
      readFileSync(path.join(result.installPath, 'workflows', 'prompts', source), 'utf8'),
      readFileSync(path.join(sourceRoot, 'workflows', 'prompts', source), 'utf8'),
    );
  }
});

test('JetBrains dry-run reports prompt actions without writing or configuring MCP', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const targetRoot = createDirectory(t, 'jetbrains-dry-run-target-');

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'jetbrains',
    dryRun: true,
  });

  assert.equal(result.status, 'planned');
  assert.equal(result.prompts.length, 10);
  assert.ok(result.prompts.every(({ status }) => status === 'planned'));
  assert.match(result.nextStep.action, /Copilot Chat in IntelliJ/i);
  assert.equal(result.mcpConfiguration, undefined);
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
  assert.equal(existsSync(path.join(targetRoot, '.github')), false);
});

test('JetBrains prompt install is idempotent', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const targetRoot = createDirectory(t, 'jetbrains-idempotent-target-');

  const first = await initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' });
  const second = await initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' });

  assert.equal(first.status, 'installed');
  assert.equal(second.status, 'unchanged');
  assert.ok(second.prompts.every(({ status }) => status === 'unchanged'));
  assert.equal(first.instructionStatus, 'installed');
  assert.equal(second.instructionStatus, 'unchanged');
});

test('JetBrains install updates the previous generated instruction supplement', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const targetRoot = createDirectory(t, 'jetbrains-existing-instructions-target-');
  const instructionPath = path.join(
    targetRoot,
    '.github',
    'instructions',
    'smith.instructions.md',
  );
  const previousInstructions = `---
applyTo: "**"
---

Quando o usuário invocar um comando \`/Smith: ...\`, leia o arquivo correspondente em \`.github/prompts/\` por inteiro e siga suas instruções. A lista do seletor não garante que o corpo do prompt tenha sido incluído na mensagem; portanto, não diga que faltam instruções antes de consultar o arquivo correspondente.
Os arquivos de comando seguem o padrão \`.github/prompts/smith-*.prompt.md\` e estão mapeados abaixo.

| Comando | Arquivo |
|---|---|
| \`/Smith: Épico de negócio\` | \`.github/prompts/smith-business-epic.prompt.md\` |
| \`/Smith: Knowledge As-Is\` | \`.github/prompts/smith-as-is-knowledge.prompt.md\` |
| \`/Smith: Resultado de discovery\` | \`.github/prompts/smith-discovery-result.prompt.md\` |
| \`/Smith: Registro de decisão\` | \`.github/prompts/smith-decision-record.prompt.md\` |
| \`/Smith: Gate de validação\` | \`.github/prompts/smith-validation-gate.prompt.md\` |
| \`/Smith: Especificação técnica\` | \`.github/prompts/smith-technical-specification.prompt.md\` |
| \`/Smith: Quebra de histórias e plano\` | \`.github/prompts/smith-story-task-breakdown.prompt.md\` |

Só leia esses arquivos quando o usuário invocar um dos comandos Smith.`;
  mkdirSync(path.dirname(instructionPath), { recursive: true });
  writeFileSync(instructionPath, previousInstructions);

  const preview = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'jetbrains',
    dryRun: true,
  });
  assert.equal(preview.legacy.requiresConfirmation, false);
  assert.equal(preview.instructionStatus, 'update-planned');

  const result = await initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' });

  assert.equal(result.instructionStatus, 'updated');
  assert.match(readFileSync(instructionPath, 'utf8'), /mcp-agents-Ask-(?:Claude|Antigravity)/);
});

test('installation overwrites existing instruction supplements for each client', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const customInstructions = 'Custom project instructions\n';
  for (const client of ['copilot-cli', 'jetbrains', 'vscode']) {
    const targetRoot = createDirectory(t, `${client}-custom-instructions-target-`);
    const instructionPath = path.join(
      targetRoot,
      '.github',
      'instructions',
      'smith.instructions.md',
    );
    mkdirSync(path.dirname(instructionPath), { recursive: true });
    writeFileSync(instructionPath, customInstructions);

    const preview = await initializePlugin({
      sourceRoot,
      targetRoot,
      client,
      dryRun: true,
    });
    assert.equal(preview.instructionStatus, 'update-planned');

    const result = await initializePlugin({ sourceRoot, targetRoot, client });

    assert.equal(result.instructionStatus, 'updated');
    assert.notEqual(readFileSync(instructionPath, 'utf8'), customInstructions);
    assert.match(readFileSync(instructionPath, 'utf8'), /mcp-agents-Ask-(?:Claude|Antigravity)/);
  }
});

test('JetBrains prompt conflicts are refused before any installation writes', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const targetRoot = createDirectory(t, 'jetbrains-prompt-conflict-target-');
  const conflictPath = path.join(
    targetRoot,
    '.github',
    'prompts',
    JETBRAINS_PROMPTS[3].destination,
  );
  mkdirSync(path.dirname(conflictPath), { recursive: true });
  writeFileSync(conflictPath, 'user-owned prompt\n');

  await assert.rejects(
    initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' }),
    /prompt.*conflict|conflict.*prompt/i,
  );

  assert.equal(readFileSync(conflictPath, 'utf8'), 'user-owned prompt\n');
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
  assert.equal(
    existsSync(
      path.join(targetRoot, '.github', 'prompts', JETBRAINS_PROMPTS[0].destination),
    ),
    false,
  );
  assert.equal(
    existsSync(path.join(targetRoot, '.github', 'instructions', 'smith.instructions.md')),
    false,
  );
});

test('JetBrains prompt conflicts added during MCP confirmation are rechecked before writes', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const targetRoot = createDirectory(t, 'jetbrains-confirmation-race-target-');
  const previousHome = process.env.HOME;
  process.env.HOME = targetRoot;
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  });
  const conflictPath = path.join(
    targetRoot,
    '.github',
    'prompts',
    JETBRAINS_PROMPTS[3].destination,
  );

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'jetbrains',
      configureMcpServers: true,
      confirmMcpChanges: async () => {
        mkdirSync(path.dirname(conflictPath), { recursive: true });
        writeFileSync(conflictPath, 'concurrent user prompt\n');
        return true;
      },
    }),
    /prompt.*conflict|conflict.*prompt/i,
  );

  assert.equal(readFileSync(conflictPath, 'utf8'), 'concurrent user prompt\n');
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
  assert.equal(
    existsSync(path.join(targetRoot, '.github', 'instructions', 'smith.instructions.md')),
    false,
  );
  assert.equal(
    existsSync(path.join(targetRoot, '.config', 'github-copilot', 'intellij', 'mcp.json')),
    false,
  );
});

test('installer rejects a source without generated package instructions before writing', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  rmSync(path.join(sourceRoot, 'assets'), { recursive: true });
  const targetRoot = createDirectory(t, 'plugin-missing-instructions-target-');

  await assert.rejects(
    initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' }),
    /Copilot instructions.*missing|required/i,
  );
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
  assert.equal(existsSync(path.join(targetRoot, '.github')), false);
});

test('re-running an identical install is idempotent', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-idempotent-target-');

  const first = await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });
  const second = await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });

  assert.equal(first.status, 'installed');
  assert.equal(second.status, 'unchanged');
  assert.equal(first.instructionFile, path.join(targetRoot, '.github', 'copilot-instructions.md'));
  assert.equal(existsSync(first.instructionFile), true);
});

test('reinstall uses copilot-instructions when only the legacy supplement exists', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-legacy-instructions-target-');
  const first = await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });
  const legacySupplement = path.join(
    targetRoot,
    '.github',
    'instructions',
    'smith.instructions.md',
  );
  mkdirSync(path.dirname(legacySupplement), { recursive: true });
  renameSync(first.instructionFile, legacySupplement);

  const result = await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });

  assert.equal(result.instructionFile, path.join(targetRoot, '.github', 'copilot-instructions.md'));
  assert.equal(existsSync(result.instructionFile), true);
});

test('refreshes viewer JavaScript when the HTML template is unchanged', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-viewer-refresh-target-');
  const first = await initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' });
  const sourceScript = path.join(sourceRoot, 'report', 'workflow.js');
  const installedScript = path.join(targetRoot, '.smith', 'report', 'workflow.js');
  const viewerContent = readFileSync(first.viewerPath, 'utf8');
  const updatedScript = `${readFileSync(sourceScript, 'utf8')}\n// viewer refresh marker\n`;
  writeFileSync(sourceScript, updatedScript);

  const result = await initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' });

  assert.equal(result.viewerStatus, 'updated');
  assert.equal(readFileSync(installedScript, 'utf8'), updatedScript);
  assert.equal(readFileSync(result.viewerPath, 'utf8'), viewerContent);
  assert.equal(first.viewerPath, result.viewerPath);
});

test('dry-run reports planned files without writing or invoking commands', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-dry-run-target-');
  let externalCommands = 0;

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    dryRun: true,
    runCommand: async () => {
      externalCommands += 1;
    },
  });

  assert.equal(result.status, 'planned');
  assert.ok(result.files.includes('plugin.json'));
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
  assert.equal(externalCommands, 0);
});

test('dry-run never requests or performs an optional external installation', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-dry-run-external-target-');
  let confirmations = 0;
  let activationConfirmations = 0;
  let externalCommands = 0;

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    dryRun: true,
    installSuperpowers: true,
    activatePlugin: true,
    confirmExternalInstall: async () => {
      confirmations += 1;
      return true;
    },
    confirmPluginActivation: async () => {
      activationConfirmations += 1;
      return true;
    },
    runCommand: async () => {
      externalCommands += 1;
    },
  });

  assert.equal(result.status, 'planned');
  assert.equal(result.externalCommands.length, 4);
  assert.equal(result.activationCommand.requiresAuthorization, true);
  assert.equal(confirmations, 0);
  assert.equal(activationConfirmations, 0);
  assert.equal(externalCommands, 0);
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
});

test('dry-run previews opt-in MCP configuration without writing it', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-mcp-dry-run-target-');
  let confirmations = 0;

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'vscode',
    dryRun: true,
    configureMcpServers: true,
    includeMultiCli: true,
    confirmMcpChanges: async () => {
      confirmations += 1;
      return true;
    },
  });

  assert.equal(result.mcpConfiguration.status, 'planned');
  assert.equal(existsSync(path.join(targetRoot, '.mcp.json')), false);
  assert.equal(confirmations, 0);
});

test('MCP configuration requires confirmation and is applied only after consent', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-mcp-apply-target-');

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'vscode',
      configureMcpServers: true,
      confirmMcpChanges: async () => false,
    }),
    /MCP.*not authorized|declined/i,
  );
  assert.equal(existsSync(path.join(targetRoot, '.mcp.json')), false);
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'vscode',
    configureMcpServers: true,
    confirmMcpChanges: async () => true,
  });
  const config = JSON.parse(readFileSync(path.join(targetRoot, '.mcp.json'), 'utf8'));

  assert.equal(result.mcpConfiguration.status, 'configured');
  assert.equal(config.mcpServers['github-readonly'].url, 'https://api.githubcopilot.com/mcp/readonly');
});

test('installer does not apply MCP changes if the approved preview becomes stale', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-mcp-stale-preview-target-');
  const configPath = path.join(targetRoot, '.mcp.json');

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'vscode',
      configureMcpServers: true,
      confirmMcpChanges: async (plan) => {
        assert.equal(plan.configPath, configPath);
        writeFileSync(configPath, '{"custom":"changed after preview"}\n');
        return true;
      },
    }),
    /changed after preview/i,
  );
  assert.equal(readFileSync(configPath, 'utf8'), '{"custom":"changed after preview"}\n');
});

test('installation supports target paths containing spaces', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const parent = createDirectory(t, 'plugin-spaces-');
  const targetRoot = path.join(parent, 'client workspace with spaces');
  mkdirSync(targetRoot);

  const result = await initializePlugin({ sourceRoot, targetRoot, client: 'vscode' });

  assert.equal(existsSync(path.join(result.installPath, 'plugin.json')), true);
});

test('existing installation conflicts are refused before external operations', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-conflict-target-');
  const first = await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });
  writeFileSync(path.join(first.installPath, 'templates', 'sample.md'), 'user change\n');
  let confirmations = 0;
  let externalCommands = 0;

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'copilot-cli',
      installSuperpowers: true,
      confirmExternalInstall: async () => {
        confirmations += 1;
        return true;
      },
      runCommand: async () => {
        externalCommands += 1;
      },
    }),
    /conflict|overwrite/i,
  );

  assert.equal(readFileSync(path.join(first.installPath, 'templates', 'sample.md'), 'utf8'), 'user change\n');
  assert.equal(confirmations, 0);
  assert.equal(externalCommands, 0);
});

test('Copilot CLI instructions are installed as a supplement with package-relative templates', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const assets = path.join(sourceRoot, 'assets');
  writeFileSync(
    path.join(assets, 'copilot-instructions.md'),
    'Use templates from plugin/templates/ and keep project instructions. Run plugin/mcp/configure.mjs and plugin/utils/repository/sync/sync.mjs.\n',
  );
  const targetRoot = createDirectory(t, 'plugin-instructions-target-');
  mkdirSync(path.join(targetRoot, '.github'), { recursive: true });
  writeFileSync(path.join(targetRoot, '.github', 'copilot-instructions.md'), 'existing instructions\n');

  const result = await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });
  const supplement = readFileSync(
    path.join(targetRoot, '.github', 'instructions', 'smith.instructions.md'),
    'utf8',
  );

  assert.equal(readFileSync(path.join(targetRoot, '.github', 'copilot-instructions.md'), 'utf8'), 'existing instructions\n');
  assert.match(supplement, /\.copilot\/plugins\/smith\/templates\//);
  assert.match(supplement, /\.copilot\/plugins\/smith\/mcp\/configure\.mjs/);
  assert.match(supplement, /\.copilot\/plugins\/smith\/utils\/repository\/sync\/sync\.mjs/);
  assert.doesNotMatch(supplement, /plugin\/templates\//);
  assert.doesNotMatch(supplement, /plugin\/(?:mcp|utils\/repository\/sync)\//);
  assert.equal(result.status, 'installed');
});

test('unexpected symlinks are refused without following them', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const parent = createDirectory(t, 'plugin-symlink-');
  const targetRoot = path.join(parent, 'target');
  const externalDirectory = path.join(parent, 'outside');
  mkdirSync(targetRoot);
  mkdirSync(externalDirectory);
  writeFileSync(path.join(externalDirectory, 'sentinel'), 'untouched');
  symlinkSync(externalDirectory, path.join(targetRoot, '.copilot'));

  await assert.rejects(
    initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' }),
    /symlink|symbolic link/i,
  );
  assert.equal(readFileSync(path.join(externalDirectory, 'sentinel'), 'utf8'), 'untouched');
});

test('unsupported clients are rejected before creating files', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-unsupported-target-');

  await assert.rejects(
    initializePlugin({ sourceRoot, targetRoot, client: 'eclipse' }),
    /unsupported|incompatible/i,
  );
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
});

test('missing Node.js requirements block initialization before writes', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-old-node-target-');

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'copilot-cli',
      nodeVersion: '20.11.0',
    }),
    /Node\.js.*22/i,
  );
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
});

test('external Superpowers installation requires consent and reports partial failure', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-external-failure-target-');
  const commands = [];

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'copilot-cli',
      installSuperpowers: true,
      confirmExternalInstall: async () => true,
      runCommand: async (command, args) => {
        commands.push([command, args]);
        if (args[1] === 'list') {
          return { stdout: '[]', stderr: '' };
        }
        if (args[1] === 'install') {
          throw new Error('simulated install failure');
        }
        return { stdout: '', stderr: '' };
      },
    }),
    /Superpowers installation failed after plugin setup/,
  );

  assert.deepEqual(commands, [
    ['copilot', ['plugin', 'list', '--json']],
    ['copilot', ['plugin', 'marketplace', 'add', 'obra/superpowers-marketplace']],
    ['copilot', ['plugin', 'install', 'superpowers@superpowers-marketplace']],
  ]);
  assert.equal(existsSync(path.join(targetRoot, '.copilot', 'plugins', 'smith')), true);
});

test('external Superpowers installation is verified after explicit consent', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-external-success-target-');
  const commands = [];
  let installed = false;

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    installSuperpowers: true,
    confirmExternalInstall: async () => true,
    runCommand: async (command, args) => {
      commands.push([command, args]);
      if (args[1] === 'install') {
        installed = true;
      }
      return args[1] === 'list'
        ? {
            stdout: JSON.stringify(installed ? [{ name: 'superpowers', enabled: true }] : []),
            stderr: '',
          }
        : { stdout: '', stderr: '' };
    },
  });

  assert.equal(result.superpowersInstalled, true);
  assert.deepEqual(commands[3], ['copilot', ['plugin', 'list', '--json']]);
});

test('re-running Superpowers installation does not add duplicate configuration', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-superpowers-idempotent-target-');
  let installed = false;
  let installationCommands = 0;
  const runCommand = async (_command, args) => {
    if (args[0] === 'plugin' && args[1] === 'list') {
      return {
        stdout: JSON.stringify(installed ? [{ name: 'superpowers', enabled: true }] : []),
        stderr: '',
      };
    }
    installationCommands += 1;
    if (args[1] === 'install') {
      installed = true;
    }
    return { stdout: '', stderr: '' };
  };
  const options = {
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    installSuperpowers: true,
    confirmExternalInstall: async () => true,
    runCommand,
  };

  const first = await initializePlugin(options);
  const second = await initializePlugin(options);

  assert.equal(first.superpowersInstalled, true);
  assert.equal(second.superpowersInstalled, true);
  assert.equal(installationCommands, 2);
});

test('declining external installation makes no local or external changes', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-external-declined-target-');
  let externalCommands = 0;

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'copilot-cli',
      installSuperpowers: true,
      confirmExternalInstall: async () => false,
      runCommand: async () => {
        externalCommands += 1;
      },
    }),
    /not authorized/i,
  );
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
  assert.equal(externalCommands, 0);
});

test('Copilot CLI activation requires consent and verifies plugin registration', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-activation-target-');
  const commands = [];
  let registered = false;
  let source;

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    activatePlugin: true,
    confirmPluginActivation: async () => true,
    runCommand: async (command, args) => {
      commands.push([command, args]);
      if (args[1] === 'install') {
        registered = true;
        source = args[2];
        return { stdout: '', stderr: '' };
      }
      return {
        stdout: JSON.stringify(registered ? [{ name: 'smith', enabled: true, source }] : []),
        stderr: '',
      };
    },
  });

  assert.equal(result.pluginActivated, true);
  assert.deepEqual(commands, [
    ['copilot', ['plugin', 'list', '--json']],
    ['copilot', ['plugin', 'install', result.installPath]],
    ['copilot', ['plugin', 'list', '--json']],
  ]);
});

test('activation enables an existing disabled registration from this package', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-activation-disabled-target-');
  const installedPath = path.join(targetRoot, '.copilot', 'plugins', 'smith');
  const commands = [];
  let enabled = false;

  const result = await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    activatePlugin: true,
    confirmPluginActivation: async () => true,
    runCommand: async (_command, args) => {
      commands.push(args);
      if (args[1] === 'enable') {
        enabled = true;
        return { stdout: '', stderr: '' };
      }
      return {
        stdout: JSON.stringify([{ name: 'smith', enabled, source: installedPath }]),
        stderr: '',
      };
    },
  });

  assert.equal(result.pluginActivated, true);
  assert.deepEqual(commands.map((args) => args.slice(0, 2)), [
    ['plugin', 'list'],
    ['plugin', 'enable'],
    ['plugin', 'list'],
  ]);
});

test('activation refuses a same-name registration from a different source', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-activation-source-conflict-');
  const commands = [];

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'copilot-cli',
      activatePlugin: true,
      confirmPluginActivation: async () => true,
      runCommand: async (_command, args) => {
        commands.push(args);
        return {
          stdout: JSON.stringify([
            { name: 'smith', enabled: true, source: '/some/other/plugin' },
          ]),
          stderr: '',
        };
      },
    }),
    /different source|conflict/i,
  );
  assert.deepEqual(commands.map((args) => args.slice(0, 2)), [['plugin', 'list']]);
});

test('re-running activation does not register the same plugin twice', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-activation-idempotent-target-');
  let registered = false;
  let source;
  let registrations = 0;
  const runCommand = async (_command, args) => {
    if (args[0] === 'plugin' && args[1] === 'install') {
      registrations += 1;
      registered = true;
      source = args[2];
      return { stdout: '', stderr: '' };
    }
    return {
      stdout: JSON.stringify(registered ? [{ name: 'smith', enabled: true, source }] : []),
      stderr: '',
    };
  };
  const options = {
    sourceRoot,
    targetRoot,
    client: 'copilot-cli',
    activatePlugin: true,
    confirmPluginActivation: async () => true,
    runCommand,
  };

  const first = await initializePlugin(options);
  const second = await initializePlugin(options);

  assert.equal(first.status, 'installed');
  assert.equal(second.status, 'unchanged');
  assert.equal(first.pluginActivated, true);
  assert.equal(second.pluginActivated, true);
  assert.equal(registrations, 1);
});

test('declining Copilot CLI activation leaves personal configuration untouched', async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-activation-declined-target-');
  let externalCommands = 0;

  await assert.rejects(
    initializePlugin({
      sourceRoot,
      targetRoot,
      client: 'copilot-cli',
      activatePlugin: true,
      confirmPluginActivation: async () => false,
      runCommand: async () => {
        externalCommands += 1;
      },
    }),
    /activation was not authorized/i,
  );
  assert.equal(existsSync(path.join(targetRoot, '.copilot')), false);
  assert.equal(externalCommands, 0);
});

test('doctor reports missing runtime and unsupported client requirements', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const targetRoot = createDirectory(t, 'plugin-doctor-target-');

  const diagnosis = await diagnoseProject({
    targetRoot,
    client: 'copilot-cli',
    nodeVersion: '20.11.0',
    copilotAvailable: false,
  });

  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.checks.some((check) => check.id === 'node' && !check.ok));
  assert.ok(diagnosis.checks.some((check) => check.id === 'copilot-cli' && !check.ok));
  assert.ok(diagnosis.checks.some((check) => check.id === 'client-integration' && !check.ok));
});

test('doctor distinguishes a package path from verified client compatibility', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const targetRoot = createDirectory(t, 'plugin-doctor-client-path-target-');

  const diagnosis = await diagnoseProject({
    targetRoot,
    client: 'vscode',
  });

  assert.match(
    diagnosis.checks.find(({ id }) => id === 'client').message,
    /runtime compatibility.*not verified/i,
  );
});

test('doctor verifies all seven JetBrains prompt files', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const sourceRoot = createPluginFixture(t);
  addJetBrainsPromptAssets(sourceRoot);
  const targetRoot = createDirectory(t, 'jetbrains-doctor-target-');
  const { initializePlugin } = await loadInit();
  const pluginInstall = await initializePlugin({ sourceRoot, targetRoot, client: 'jetbrains' });

  const mcpConfigPath = path.join(targetRoot, 'mcp.json');
  const installed = await diagnoseProject({
    targetRoot,
    client: 'jetbrains',
    mcpConfigPath,
  });
  assert.equal(installed.checks.find(({ id }) => id === 'prompts').ok, true);
  assert.equal(installed.checks.find(({ id }) => id === 'instructions').required, true);
  assert.equal(installed.checks.find(({ id }) => id === 'instructions').ok, true);
  assert.match(installed.checks.find(({ id }) => id === 'instructions').message, /installed/);

  unlinkSync(
    path.join(targetRoot, '.github', 'prompts', JETBRAINS_PROMPTS[4].destination),
  );
  const missing = await diagnoseProject({
    targetRoot,
    client: 'jetbrains',
    mcpConfigPath,
  });

  assert.equal(missing.checks.find(({ id }) => id === 'prompts').ok, false);
  assert.equal(
    missing.checks.find(({ id }) => id === 'client-integration').ok,
    false,
  );

  unlinkSync(pluginInstall.instructionFile);
  const missingInstructions = await diagnoseProject({
    targetRoot,
    client: 'jetbrains',
    mcpConfigPath,
  });
  assert.equal(missingInstructions.checks.find(({ id }) => id === 'instructions').ok, false);
  assert.equal(
    missingInstructions.checks.find(({ id }) => id === 'client-integration').ok,
    false,
  );
});

test('doctor reports MCP configuration without connecting to servers', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-doctor-mcp-target-');
  const { initializePlugin } = await loadInit();
  await initializePlugin({
    sourceRoot,
    targetRoot,
    client: 'vscode',
    configureMcpServers: true,
    confirmMcpChanges: async () => true,
  });
  let commands = 0;

  const diagnosis = await diagnoseProject({
    targetRoot,
    client: 'vscode',
    mcpConfigPath: path.join(targetRoot, '.mcp.json'),
    runCommand: async () => {
      commands += 1;
      throw new Error('doctor must not start MCP servers');
    },
  });

  assert.ok(diagnosis.checks.some((check) => check.id === 'github-mcp' && check.ok));
  assert.equal(commands, 0);
});

test('doctor reports a missing installed instruction supplement', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-doctor-instructions-target-');
  const { initializePlugin } = await loadInit();
  const installed = await initializePlugin({ sourceRoot, targetRoot, client: 'vscode' });
  unlinkSync(installed.instructionFile);

  const diagnosis = await diagnoseProject({ targetRoot, client: 'vscode' });

  assert.equal(diagnosis.checks.find(({ id }) => id === 'instructions').ok, false);
});

test('doctor does not count disabled or differently sourced plugins as integrated', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-doctor-disabled-target-');
  const { initializePlugin } = await loadInit();
  await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });

  const diagnosis = await diagnoseProject({
    targetRoot,
    client: 'copilot-cli',
    copilotAvailable: true,
    runCommand: async () => ({
      stdout: JSON.stringify([
        { name: 'smith', enabled: false, source: path.join(targetRoot, '.copilot/plugins/smith') },
        { name: 'superpowers', enabled: false, source: 'superpowers-marketplace' },
      ]),
      stderr: '',
    }),
  });

  assert.equal(diagnosis.checks.find(({ id }) => id === 'client-integration').ok, false);
  assert.equal(diagnosis.checks.find(({ id }) => id === 'superpowers').ok, false);
});

test('doctor distinguishes executor, Superpowers, and client integration failures', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, 'plugin-doctor-components-');
  const { initializePlugin } = await loadInit();
  const installed = await initializePlugin({ sourceRoot, targetRoot, client: 'copilot-cli' });
  unlinkSync(path.join(installed.installPath, 'core', 'engine.mjs'));

  const diagnosis = await diagnoseProject({
    targetRoot,
    client: 'copilot-cli',
    copilotAvailable: true,
    runCommand: async () => ({ stdout: '[]', stderr: '' }),
  });

  assert.equal(diagnosis.checks.find((check) => check.id === 'executor').ok, false);
  assert.equal(diagnosis.checks.find((check) => check.id === 'superpowers').ok, false);
  assert.equal(diagnosis.checks.find((check) => check.id === 'client-integration').ok, false);
});

test('doctor fails with a clear result for a client without plugin support', async (t) => {
  const { diagnoseProject } = await loadDoctor();
  const targetRoot = createDirectory(t, 'plugin-doctor-unsupported-');

  const diagnosis = await diagnoseProject({
    targetRoot,
    client: 'eclipse',
    nodeVersion: '26.12.1',
    copilotAvailable: true,
  });

  assert.equal(diagnosis.ok, false);
  assert.ok(diagnosis.checks.some((check) => check.id === 'client' && !check.ok));
});

test("installation creates default workspace directories and dry-run does not", async (t) => {
  const { initializePlugin } = await loadInit();
  const sourceRoot = createPluginFixture(t);
  const targetRoot = createDirectory(t, "plugin-workspace-dirs-");

  await initializePlugin({ sourceRoot, targetRoot, client: "jetbrains", dryRun: true });
  assert.equal(existsSync(path.join(targetRoot, "workspace")), false);

  const result = await initializePlugin({ sourceRoot, targetRoot, client: "jetbrains" });
  assert.equal(result.status, "installed");
  assert.equal(existsSync(path.join(targetRoot, "workspace", ".context")), true);
  assert.equal(existsSync(path.join(targetRoot, "workspace", ".discovery")), true);
  assert.equal(existsSync(path.join(targetRoot, "workspace", ".analysis")), true);
  assert.deepEqual(readdirSync(path.join(targetRoot, "workspace")).sort(), [".analysis", ".context", ".discovery", "src"]);
  assert.equal(existsSync(path.join(targetRoot, "workspace", "src")), true);
});
