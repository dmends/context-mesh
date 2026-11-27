import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';
import { configureMcp as configureMcpServers, previewMcpConfiguration } from '../mcp/configure.mjs';
import { isSharedClient, sharedDestination, workflowCommand } from './shared-runtime.mjs';
import { inspectLegacy, matchesLegacy } from './legacy-runtime.mjs';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';
import { StepStatus } from '../domain/status.mjs';
import { loadTemplate } from '../utils/template-loader.mjs';
import { atomicWrite } from './file-writer.mjs';
import { buildPromptContent } from './prompt-builder.mjs';

const execFileAsync = promisify(execFile);
const MIN_NODE_MAJOR = 22;
const SUPPORTED_CLIENTS = new Set(['copilot-cli', 'jetbrains', 'vscode']);
const SUPPORTED_AGENTS = new Set(['copilot', 'claude-code', 'cursor', 'gemini-cli', 'antigravity', 'codex']);
export const DEFAULT_WORKSPACE_DIRECTORIES = [
  'workspace/.context',
  'workspace/.discovery',
  'workspace/.analysis',
  'workspace/.knowledge',
  'workspace/src',
];

const AGENT_PROMPT_DEST = {
  copilot: (slug) => `.github/prompts/${slug}.prompt.md`,
  'claude-code': (slug) => `.claude/skills/${slug}/SKILL.md`,
  cursor: (slug) => `.cursor/skills/${slug}/SKILL.md`,
  'gemini-cli': (slug) => `.gemini/skills/${slug}/SKILL.md`,
  antigravity: (slug) => `skills/${slug}/SKILL.md`,
  codex: (slug) => `.agents/skills/${slug}/SKILL.md`,
};

const AGENT_FILE_MAP = {
  copilot: [
    { template: 'instructions/smith.instructions.md', fallback: 'resources/instructions/smith.instructions.md', destination: '.github/copilot-instructions.md' },
  ],
  'claude-code': [
    { template: 'agents/claude-code/plugin.json', fallback: 'resources/agents/claude-code/plugin.json', destination: '.claude-plugin/plugin.json' },
    { template: 'instructions/smith.instructions.md', fallback: 'resources/instructions/smith.instructions.md', destination: 'CLAUDE.md' },
  ],
  cursor: [
    { template: 'agents/cursor/plugin.json', fallback: 'resources/agents/cursor/plugin.json', destination: '.cursor-plugin/plugin.json' },
    { template: 'instructions/smith.instructions.md', fallback: 'resources/instructions/smith.instructions.md', destination: '.cursor/rules/smith.mdc' },
  ],
  'gemini-cli': [
    { template: 'agents/gemini-cli/gemini-extension.json', fallback: 'resources/agents/gemini-cli/gemini-extension.json', destination: 'gemini-extension.json' },
    { template: 'instructions/smith.instructions.md', fallback: 'resources/instructions/smith.instructions.md', destination: 'GEMINI.md' },
  ],
  antigravity: [
    { template: 'agents/antigravity/plugin.json', fallback: 'resources/agents/antigravity/plugin.json', destination: '.antigravity-plugin/plugin.json' },
    { template: 'instructions/smith.instructions.md', fallback: 'resources/instructions/smith.instructions.md', destination: 'AGENTS.md' },
  ],
  codex: [
    { template: 'agents/codex/plugin.json', fallback: 'resources/agents/codex/plugin.json', destination: '.codex-plugin/plugin.json' },
    { template: 'instructions/smith.instructions.md', fallback: 'resources/instructions/smith.instructions.md', destination: 'AGENTS.md' },
  ],
};

function getAgentHeader(agent) {
  if (agent === 'cursor') {
    return '---\ndescription: Smith workflow instructions\nalwaysApply: true\n---\n';
  }
  if (agent === 'copilot') {
    return '---\napplyTo: "**"\n---\n';
  }
  return '';
}

function getAgentCommandMapping(agent) {
  if (agent === 'copilot') {
    return `Quando o usuário invocar um comando \`/Smith: ...\`, leia o arquivo correspondente em \`.github/prompts/\` por inteiro e siga suas instruções. A lista do seletor não garante que o corpo do prompt tenha sido incluído na mensagem; portanto, não diga que faltam instruções antes de consultar o arquivo correspondente.
Os arquivos de comando seguem o padrão \`.github/prompts/smith-*.prompt.md\` e estão mapeados abaixo.

| Comando | Arquivo |
|---|---|
| \`/Smith: Consolidação\` | \`.github/prompts/smith-discovery-consolidation.prompt.md\` |
| \`/Smith: Knowledge As-Is\` | \`.github/prompts/smith-as-is-knowledge.prompt.md\` |
| \`/Smith: Consolidar épico\` | \`.github/prompts/smith-business-epic.prompt.md\` |
| \`/Smith: Especificação de Solução\` | \`.github/prompts/smith-tech-solution-specification.prompt.md\` |
| \`/Smith: Registro de decisão\` | \`.github/prompts/smith-decision-record.prompt.md\` |
| \`/Smith: Gate de validação\` | \`.github/prompts/smith-validation-gate.prompt.md\` |
| \`/Smith: Quebra de histórias e plano\` | \`.github/prompts/smith-story-task-breakdown.prompt.md\` |
| \`/Smith: Detalhamento técnico\` | \`.github/prompts/smith-technical-refinement.prompt.md\` |
| \`/Smith: Analysis\` | \`.github/prompts/smith-analysis.prompt.md\` |
| \`/Smith: Knowledge API\` | \`.github/prompts/smith-api-knowledge.prompt.md\` |

Só leia esses arquivos quando o usuário invocar um dos comandos Smith.`;
  }
  return 'Mencione o trigger correspondente na conversa para ativar a etapa desejada. O gate de validação (\`validation gate\`) requer confirmação explícita com \`APPROVE\` para prosseguir para downstream.\n';
}
const JETBRAINS_PROMPTS = [
  { source: '00-discovery-consolidation.prompt.md', destination: 'smith-discovery-consolidation.prompt.md' },
  { source: '01-business-epic.prompt.md', destination: 'smith-business-epic.prompt.md' },
  { source: '02-as-is-knowledge.prompt.md', destination: 'smith-as-is-knowledge.prompt.md' },
  { source: '04-decision-record.prompt.md', destination: 'smith-decision-record.prompt.md' },
  { source: '05-validation-gate.prompt.md', destination: 'smith-validation-gate.prompt.md' },
  { source: '06-tech-solution-specification.prompt.md', destination: 'smith-tech-solution-specification.prompt.md' },
  { source: '07-story-task-breakdown.prompt.md', destination: 'smith-story-task-breakdown.prompt.md' },
  { source: '08-technical-refinement.prompt.md', destination: 'smith-technical-refinement.prompt.md' },
  { source: '09-analysis.prompt.md', destination: 'smith-analysis.prompt.md' },
  { source: '10-api-knowledge.prompt.md', destination: 'smith-api-knowledge.prompt.md' },
];

function nodeMajor(version) {
  const match = /^v?(\d+)\./.exec(version);
  return match ? Number(match[1]) : NaN;
}

function within(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath === '' || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

async function physicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await physicalPath(dirname(path)), basename(path));
  }
}

async function assertSharedPath(source, target, destination, allowSourceDestination = false) {
  const root = dirname(dirname(destination));
  await assertNoSymlinkPath(dirname(root), [basename(root), 'versions', basename(destination)]);
  const [physicalSource, physicalTarget, physicalDestination] = await Promise.all(
    [source, target, destination].map(physicalPath),
  );
  for (const project of [physicalSource, physicalTarget]) {
    const sourceIsDestination = allowSourceDestination &&
      project === physicalSource &&
      physicalSource === physicalDestination;
    if (!sourceIsDestination && (within(project, physicalDestination) || within(physicalDestination, project))) {
      throw new Error('Shared runtime must be outside the source and target projects');
    }
  }
}

async function assertDirectory(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${path}`, { cause: error });
    }
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink or file: ${path}`);
  }
}

export async function initializeWorkspaceDirectories(targetRoot) {
  for (const relativePath of DEFAULT_WORKSPACE_DIRECTORIES) {
    const segments = relativePath.split('/');
    await assertNoSymlinkPath(targetRoot, segments);
    const fullPath = join(targetRoot, ...segments);
    await mkdir(fullPath, { recursive: true });
  }
}

async function assertNoSymlinkPath(targetRoot, segments) {
  let current = targetRoot;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(`Refusing unexpected symlink in installation path: ${current}`);
      }
      if (index < segments.length - 1 && !info.isDirectory()) {
        throw new Error(`Installation path component is not a directory: ${current}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

async function collectFiles(root, current = root, files = [], allowedDirectories, { allowUnknownDirectories = false, includeSymlinks = false } = {}) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      if (includeSymlinks) {
        files.push(relative(root, absolutePath).split(sep).join('/'));
        continue;
      }
      throw new Error(`Plugin source contains an unexpected symlink: ${absolutePath}`);
    }
    if (info.isDirectory()) {
      if (allowedDirectories && !allowedDirectories.has(relative(root, absolutePath)) && !allowUnknownDirectories) {
        throw new Error(`Installation conflict; unexpected directory at ${absolutePath}`);
      }
      await collectFiles(root, absolutePath, files, allowedDirectories, { allowUnknownDirectories, includeSymlinks });
    } else if (info.isFile()) {
      files.push(relative(root, absolutePath).split(sep).join('/'));
    } else {
      throw new Error(`Plugin source contains an unsupported file type: ${absolutePath}`);
    }
  }
  return files;
}

async function readManifest(sourceRoot) {
  const manifestPath = join(sourceRoot, 'plugin.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read a valid plugin.json from ${sourceRoot}`, { cause: error });
  }
  if (
    manifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' ||
    typeof manifest.name !== 'string' ||
    !/^[a-z0-9][a-z0-9.-]*$/.test(manifest.name)
  ) {
    throw new Error('Plugin must use a valid Agent Plugins 1.0 manifest and name');
  }
  return manifest;
}

async function readInstructions(sourceRoot, pluginName) {
  const candidates = [
    join(sourceRoot, 'agents', 'copilot', '.github', 'copilot-instructions.md'),
    join(sourceRoot, 'assets', 'copilot-instructions.md'),
    join(sourceRoot, '..', 'agents', 'copilot', '.github', 'copilot-instructions.md'),
    join(sourceRoot, '..', 'copilot', '.github', 'copilot-instructions.md'),
    join(sourceRoot, 'dist', 'copilot', '.github', 'copilot-instructions.md'),
    join(sourceRoot, '.github', 'copilot-instructions.md'),
  ];
  let instructionsPath = null;
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (!info.isSymbolicLink() && info.isFile()) {
        instructionsPath = candidate;
        break;
      }
    } catch {}
  }
  if (!instructionsPath) {
    throw new Error(`Copilot instructions asset is required in the built package: ${join(sourceRoot, 'assets', 'copilot-instructions.md')}`);
  }

  let instructions = await readFile(instructionsPath, 'utf8');
  instructions = instructions
    .replaceAll('plugin/templates/', `.copilot/plugins/${pluginName}/templates/`)
    .replaceAll(
      'plugin/core/',
      `.copilot/plugins/${pluginName}/core/`,
    )
    .replaceAll(
      'plugin/dynamic-workflow/',
      `.copilot/plugins/${pluginName}/core/`,
    )
    .replaceAll('plugin/installer/', `.copilot/plugins/${pluginName}/installer/`)
    .replaceAll('plugin/mcp/', `.copilot/plugins/${pluginName}/mcp/`)
    .replaceAll('plugin/utils/repository/sync/', `.copilot/plugins/${pluginName}/utils/repository/sync/`)
    .replaceAll('plugin/repository-sync/', `.copilot/plugins/${pluginName}/utils/repository/sync/`)
    .replaceAll(
      'plugin/workflows/',
      `.copilot/plugins/${pluginName}/workflows/`,
    );
  if (!/^---\s*[\s\S]*?\bapplyTo\s*:/m.test(instructions)) {
    instructions = `---\napplyTo: "**"\n---\n\n${instructions}`;
  }
  return instructions.endsWith('\n') ? instructions : `${instructions}\n`;
}

async function readExistingInstructions(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Instructions destination is not a regular file: ${path}`);
    }
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

const PREVIOUS_PLUGIN_VERSIONS = ['1.1.0', '1.2.0'];

async function readPromptHistory(sourceRoot) {
  const historyPath = join(sourceRoot, 'prompt-history.json');
  const historyInfo = await lstat(historyPath);
  if (historyInfo.isSymbolicLink() || !historyInfo.isFile()) {
    throw new Error(`Prompt history must be a regular file: ${historyPath}`);
  }
  const promptHistory = JSON.parse(await readFile(historyPath, 'utf8'));
  if (!promptHistory || typeof promptHistory !== 'object' || Array.isArray(promptHistory)) {
    throw new Error(`Prompt history is invalid: ${historyPath}`);
  }
  for (const version of PREVIOUS_PLUGIN_VERSIONS) {
    const history = promptHistory[version];
    if (!history || typeof history !== 'object' || Array.isArray(history) ||
      typeof history.instructions !== 'string' ||
      !history.prompts || typeof history.prompts !== 'object' || Array.isArray(history.prompts)) {
      throw new Error(`Prompt history for version ${version} is missing or invalid: ${historyPath}`);
    }
  }
  return promptHistory;
}

async function readJetBrainsPromptAssets(sourceRoot, command, promptHistory) {
  return Promise.all(
    JETBRAINS_PROMPTS.map(async ({ source, destination }) => {
      const sourcePath = join(sourceRoot, 'workflows', 'prompts', source);
      let info;
      try {
        info = await lstat(sourcePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        throw new Error(`JetBrains prompt asset is missing: ${sourcePath}`, { cause: error });
      }
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error(`JetBrains prompt asset must be a regular file: ${sourcePath}`);
      }
      const stage = destination.slice('smith-'.length, -'.prompt.md'.length);
      const step = WORKFLOW_STEPS.find(({ id }) => id === stage);
      const { content, sourceContent } = await buildPromptContent(sourcePath, { stage, workflowCommand: command, step });
      const previousContents = [];
      for (const version of PREVIOUS_PLUGIN_VERSIONS) {
        const previousPrompt = promptHistory[version].prompts[destination];
        if (typeof previousPrompt !== 'string') {
          throw new Error(`Prompt history entry is missing or invalid: ${version}/${destination}`);
        }
        previousContents.push(Buffer.from(previousPrompt));
      }
      return { destination, source, content, previousContents, sourceContent };
    }),
  );
}

async function inspectJetBrainsPromptDestinations(targetRoot, promptAssets, forceOverwrite = false) {
  const prompts = [];
  for (const prompt of promptAssets) {
    const promptPath = join(targetRoot, '.github', 'prompts', prompt.destination);
    await assertNoSymlinkPath(targetRoot, ['.github', 'prompts', prompt.destination]);
    let status = 'planned';
    let previous;
    try {
      const info = await lstat(promptPath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error(`Prompt destination is not a regular file: ${promptPath}`);
      }
      const current = await readFile(promptPath);
      if (current.equals(prompt.content)) {
        status = 'unchanged';
      } else if (matchesLegacy(`workflows/prompts/${prompt.source}`, current) ||
        Buffer.from(current.toString('utf8').replaceAll('\r\n', '\n')).equals(prompt.sourceContent) ||
        prompt.previousContents?.some((content) => content.equals(current))) {
        status = 'update-planned';
        previous = current;
      } else if (forceOverwrite) {
        status = 'update-planned';
        previous = current;
      } else {
        throw new Error(`Installation prompt conflict; refusing to overwrite ${promptPath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    prompts.push({ path: promptPath, content: prompt.content, status, previous });
  }
  return prompts;
}

async function installPromptWithoutOverwrite(targetRoot, promptPath, content, previous) {
  const parent = dirname(promptPath);
  await assertNoSymlinkPath(targetRoot, ['.github', 'prompts', promptPath.split(sep).at(-1)]);
  await mkdir(parent, { recursive: true });
  await assertNoSymlinkPath(targetRoot, ['.github', 'prompts', promptPath.split(sep).at(-1)]);
  await atomicWrite(promptPath, content, { previous, changedMessage: `Prompt changed after preview: ${promptPath}` });
}

function renderViewer(template, initialProjectPrompt) {
  const marker = '__WORKFLOW_STEPS__';
  const statusMarker = '__STEP_STATUSES__';
  const promptMarker = '__INITIAL_PROJECT_PROMPT__';
  if ([marker, statusMarker, promptMarker].some((value) => template.split(value).length !== 2)) {
    throw new Error('Invalid workflow viewer template');
  }
  const steps = WORKFLOW_STEPS.map(({ id, name, kind, requires, outputs, instructions, promptCommand, recommendedSources }) => ({
    id, name, ...(kind && { kind }), requires, outputs, instructions, promptCommand, recommendedSources,
  }));
  const presentation = {
    PENDING: { label: 'Pendente', className: 'waiting' },
    RUNNING: { label: 'Em andamento', className: 'active' },
    COMPLETED: { label: 'Concluída', className: 'done' },
    FAILED: { label: 'Falhou', className: 'error' },
    ACCUMULATING: { label: 'Registrado', className: 'recorded' },
    BLOCKED: { label: 'Bloqueada', className: 'blocked' },
    READY: { label: 'Pronta', className: 'ready' },
    SKIPPED: { label: 'Ignorada', className: 'skipped' },
  };
  const statuses = Object.fromEntries(Object.entries(StepStatus).map(([key, value]) => [
    key,
    { value, ...presentation[key] },
  ]));
  const safeJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');
  return Buffer.from(template
    .replace(marker, safeJson(steps))
    .replace(statusMarker, safeJson(statuses))
    .replace(promptMarker, safeJson(initialProjectPrompt)));
}

async function inspectViewer(target, source, destination, destinationExists, forceOverwrite = false, initialProjectPrompt) {
  const segments = ['.smith', 'report', 'index.html'];
  const path = join(target, ...segments);
  const templatePath = join(source, 'report', 'index.html');
  const templateInfo = await lstat(templatePath);
  if (templateInfo.isSymbolicLink() || !templateInfo.isFile()) {
    throw new Error(`Workflow viewer template must be a regular file: ${templatePath}`);
  }
  const content = renderViewer(await readFile(templatePath, 'utf8'), initialProjectPrompt);
  const cssPath = join(target, '.smith', 'report', 'workflow.css');
  const jsPath = join(target, '.smith', 'report', 'workflow.js');
  const [cssContent, jsContent] = await Promise.all([
    readFile(join(source, 'report', 'workflow.css')),
    readFile(join(source, 'report', 'workflow.js')),
  ]);
  await assertNoSymlinkPath(target, segments);

  async function inspectStatic(assetPath, assetContent) {
    try {
      const info = await lstat(assetPath);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Viewer asset is not a regular file: ${assetPath}`);
      const previous = await readFile(assetPath);
      if (previous.equals(assetContent)) return { path: assetPath, content: assetContent, status: 'unchanged' };
      return { path: assetPath, content: assetContent, previous, status: 'update-planned' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { path: assetPath, content: assetContent, status: 'planned' };
    }
  }

  const [css, js] = await Promise.all([inspectStatic(cssPath, cssContent), inspectStatic(jsPath, jsContent)]);

  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Workflow viewer is not a regular file: ${path}`);
    const previous = await readFile(path);
    if (previous.equals(content) && css.status === 'unchanged' && js.status === 'unchanged') {
      return { path, content, status: 'unchanged', css, js };
    }
    if (forceOverwrite) {
      // Force must bypass parsing legacy viewer templates, which may not have current markers.
      return { path, content, previous, status: 'update-planned', css, js };
    }
    if (destinationExists) {
      try {
        const oldTemplate = await readFile(join(destination, 'report', 'index.html'), 'utf8');
        if (previous.equals(renderViewer(oldTemplate, initialProjectPrompt))) {
          return { path, content, previous, status: 'update-planned', css, js };
        }
        return { path, content, status: 'conflict', css, js };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return { path, content, previous, status: 'update-planned', css, js };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { path, content, status: 'planned', css, js };
  }
}

async function installViewer(target, viewer) {
  const segments = ['.smith', 'report', 'index.html'];
  await assertNoSymlinkPath(target, segments);
  await mkdir(dirname(viewer.path), { recursive: true });
  await assertNoSymlinkPath(target, segments);
  await atomicWrite(viewer.path, viewer.content, { previous: viewer.previous, changedMessage: `Workflow viewer changed after preview: ${viewer.path}` });
  for (const asset of [viewer.css, viewer.js].filter(Boolean)) {
    if (asset.status === 'unchanged') continue;
    await atomicWrite(asset.path, asset.content, { previous: asset.previous, changedMessage: `Viewer asset changed after preview: ${asset.path}` });
  }
}

const GENERATED_README_MARKER = '<!-- smith-generated -->\n';

function renderReadme(pluginPath, version, initialProjectPrompt) {
  const home = homedir();
  const displayPath = pluginPath.startsWith(home + sep)
    ? `$HOME${pluginPath.slice(home.length)}`
    : pluginPath;
  const dp = displayPath.replace(/\\/g, '/');
  const hasSpaces = dp.includes(' ');
  const cmd = (sub) => hasSpaces ? `node "${dp}/${sub}"` : `node ${dp}/${sub}`;
  return Buffer.from(`${GENERATED_README_MARKER}# Smith — Referência de Comandos

> Gerado automaticamente pelo instalador (v${version}). Não edite manualmente; a próxima instalação substituirá este arquivo.

## Estrutura de Pastas

\`\`\`
workspace/
├── .context/                        ← contexto comum lido em discovery e especificação de solução
├── .discovery/<iniciativa>/
    └── results/
        ├── as-is-knowledge/             ← etapa Knowledge As-Is
        ├── business-epic/               ← insumos e épico inicial
        ├── decision-record/             ← decisões adotadas
        ├── discovery-consolidation/     ← consolidado de discovery
        ├── story-task-breakdown/        ← histórias, tasks e plano
        ├── tech-solution-specification/ ← ARD e especificação de solução
        ├── technical-refinement/        ← refinamento técnico
        └── validation-gate/             ← aprovação explícita
├── .knowledge/
│   ├── legado/
│   │   └── <iniciativa>/            ← knowledge As-Is (legado)
│   ├── refatorado/
│   │   └── <iniciativa>/            ← knowledge As-Is (refatorado)
│   └── dominios/
│       └── <iniciativa>/            ← knowledge As-Is (domínios independentes)
└── .analysis/                       ← análises reutilizáveis de fluxos e funcionalidades
\`\`\`

O estado de cada execução fica em \`.smith/runs/<run-id>.json\`. O visualizador em \`.smith/report/index.html\` mostra o progresso, dependências e artefatos de todas as iniciativas.

## Comandos do Copilot Chat

Acesse esses comandos digitando \`/Smith:\` na barra de chat do GitHub Copilot.

| Comando | Finalidade |
|---|---|
| \`/Smith: Épico de negócio\` | Consolida agendas e histórias em um épico inicial para validação |
| \`/Smith: Knowledge As-Is\` | Documenta comportamento As-Is verificável no código |
| \`/Smith: Resultado de discovery\` | Sintetiza materiais de entrada com knowledge e código pertinente |
| \`/Smith: Registro de decisão\` | Registra somente escolhas explicitamente adotadas |
| \`/Smith: Gate de validação\` | Solicita aprovação explícita do épico, resultado e decisões |
| \`/Smith: Especificação de Solução\` | Produz a especificação To-Be a partir dos artefatos aprovados |
| \`/Smith: Quebra de histórias e plano\` | Gera a quebra de histórias/tasks e o plano de execução |

### Exemplos de Uso

Cada prompt começa com o nome do comando, seguido de \`run-id\` (identificador da iniciativa) e \`tema\` (subnó atual). Instruções livres opcionais podem ser inseridas entre \`tema:\` e \`fontes:\`.

**Épico de negócio**

\`\`\`
/Smith: Épico de negócio

run-id: minha-iniciativa
tema: Nome do Tema

fontes:
- workspace/.discovery/minha-iniciativa/input/business-stories
- workspace/.discovery/minha-iniciativa/input/transcripts
\`\`\`

**Knowledge As-Is**

\`\`\`
/Smith: Knowledge As-Is

run-id: minha-iniciativa
tema: Nome do Tema

fontes:
- workspace/src/legado
- workspace/src/refatorado
\`\`\`

**Resultado de discovery**

\`\`\`
/Smith: Resultado de discovery

run-id: minha-iniciativa
tema: Nome do Tema

fontes:
- workspace/.discovery/minha-iniciativa/results/business-epic
- workspace/.knowledge
- workspace/src
\`\`\`

**Registro de decisão**

\`\`\`
/Smith: Registro de decisão

run-id: minha-iniciativa
tema: Nome do Tema

fontes:
- workspace/.discovery/minha-iniciativa/results/decision-record
\`\`\`

**Gate de validação**

\`\`\`
/Smith: Gate de validação

run-id: minha-iniciativa
tema: Nome do Tema
\`\`\`

**Especificação de Solução**

\`\`\`
/Smith: Especificação de Solução

run-id: minha-iniciativa
tema: Nome do Tema
\`\`\`

**Quebra de histórias e plano**

\`\`\`
/Smith: Quebra de histórias e plano

run-id: minha-iniciativa
tema: Nome do Tema
\`\`\`

## CLI do Workflow

Substitua os valores entre \`<..>\` pelos do seu projeto. Todos os caminhos são relativos à raiz do projeto.

### Ver template de um step

\`\`\`bash
${cmd('core/cli.mjs')} template --step business-epic
\`\`\`

Steps disponíveis: \`discovery-consolidation\`, \`as-is-knowledge\`, \`business-epic\`, \`tech-solution-specification\`, \`decision-record\`, \`story-task-breakdown\`, \`technical-refinement\`

### Iniciar iniciativa e primeiro tema

O comando \`init\` cria o estado Schema 1 sem exigir arquivos de fonte. Use-o depois de definir o identificador da iniciativa e o primeiro tema:

\`\`\`bash
\${cmd('core/cli.mjs')} init \\
  --workspace . \\
  --run-id <run-id> \\
  --tema "<tema>"
\`\`\`

O comando não executa uma etapa do workflow. Adicione e confirme as fontes antes de iniciar o épico de negócio.

### Consultar status de uma execução

\`\`\`bash
${cmd('core/cli.mjs')} status \\
  --workspace . \\
  --run-id <run-id> \\
  --tema "<tema>" \\
  --input workspace/.discovery/<run-id>/input/business-stories/<arquivo>.md
\`\`\`

\`start\` e \`resume\` são sinônimos de \`status\` e criam o estado da execução se ele ainda não existir.

### Listar steps prontos para execução

\`\`\`bash
${cmd('core/cli.mjs')} ready \\
  --workspace . \\
  --run-id <run-id> \\
  --tema "<tema>" \\
  --input workspace/.discovery/<run-id>/input/business-stories/<arquivo>.md
\`\`\`

### Publicar artefatos de um step

Envie um objeto JSON com o Markdown de cada saída pela entrada padrão:

\`\`\`bash
${cmd('core/cli.mjs')} publish \\
  --workspace . \\
  --run-id <run-id> \\
  --tema "<tema>" \\
  --step business-epic \\
  --input workspace/.discovery/<run-id>/input/business-stories/<arquivo>.md \\
  << 'EOF'
{"business-epic": "# Épico\\n\\n...conteúdo completo em Markdown..."}
EOF
\`\`\`

O \`publish\` grava cada artefato no \`outputDirectory\` do step informado por \`ready\`. Para \`as-is-knowledge\`, o destino é \`workspace/.discovery/<run-id>/results/as-is-knowledge/\`; \`workspace/.knowledge/\` é apenas fonte de entrada.

### Registrar artefatos já existentes em disco

\`\`\`bash
${cmd('core/cli.mjs')} complete \\
  --workspace . \\
  --run-id <run-id> \\
  --tema "<tema>" \\
  --step business-epic \\
  --artifact business-epic=workspace/.discovery/<run-id>/results/business-epic/001-<tema>.md \\
  --input workspace/.discovery/<run-id>/input/business-stories/<arquivo>.md
\`\`\`

### Aprovar o gate de validação

\`\`\`bash
# Obtenha o fingerprint com ready:
${cmd('core/cli.mjs')} ready \\
  --workspace . \\
  --run-id <run-id> \\
  --tema "<tema>" \\
  --input workspace/.discovery/<run-id>/input/business-stories/<arquivo>.md

# Em seguida, aprove com o fingerprint retornado:
${cmd('core/cli.mjs')} approve \\
  --workspace . \\
  --run-id <run-id> \\
  --tema "<tema>" \\
  --input workspace/.discovery/<run-id>/input/business-stories/<arquivo>.md \\
  --approval-fingerprint <sha256-do-ready> \\
  --confirmation APPROVE
\`\`\`

## Utilitários do Plugin

### Instalar ou atualizar o plugin

\`\`\`bash
${cmd('installer/init.mjs')} \\
  --target /caminho/para/projeto \\
  --client vscode|jetbrains|copilot-cli \\
  [--shared-root /caminho/compartilhado] \\
  [--dry-run] \\
  [--activate] \\
  [--configure-mcp] \\
  [--include-multicli]
\`\`\`

### Diagnosticar a instalação

\`\`\`bash
${cmd('installer/doctor.mjs')} \\
  --target /caminho/para/projeto \\
  --client copilot-cli|vscode|jetbrains \\
  [--shared-root /caminho/compartilhado] \\
  [--sync-config /caminho/sync.json] \\
  [--mcp-config /caminho/mcp.json]
\`\`\`

### Sincronizar repositórios

\`\`\`bash
${cmd('utils/repository/sync/sync.mjs')} \\
  --config /caminho/para/sync.json \\
  --base-dir /caminho/base \\
  [--dry-run]
\`\`\`

Exemplo de arquivo de configuração de sincronização:

\`\`\`json
{
  "baseUrl": "https://github.com/minha-org/",
  "defaultBranch": "main",
  "projects": [
    { "folder": "meu-projeto", "gitPath": "meu-projeto.git", "name": "Meu Projeto" }
  ]
}
\`\`\`

### Configurar MCP (Model Context Protocol)

\`\`\`bash
${cmd('mcp/configure.mjs')} \\
  --client copilot-cli|vscode|jetbrains \\
  [--workspace /caminho/para/projeto] \\
  [--config /caminho/mcp.json] \\
  [--include-multicli] \\
  [--dry-run]
\`\`\`

${initialProjectPrompt.replaceAll('{{project-name}}', '<nome-do-projeto>').trim()}

## Visualizador de Execuções

Abra \`.smith/report/index.html\` no navegador e selecione a raiz do projeto para visualizar o estado das execuções, dependências e artefatos produzidos. Não há servidor nem conexão de rede; tudo é lido localmente pelo navegador.
`);
}

async function inspectReadme(target, content) {
  const segments = ['.smith', 'README.md'];
  const readmePath = join(target, ...segments);
  await assertNoSymlinkPath(target, segments);
  try {
    const info = await lstat(readmePath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`README is not a regular file: ${readmePath}`);
    const previous = await readFile(readmePath);
    if (previous.equals(content)) return { path: readmePath, content, status: 'unchanged' };
    if (previous.toString('utf8').startsWith(GENERATED_README_MARKER)) {
      return { path: readmePath, content, previous, status: 'update-planned' };
    }
    throw new Error(`README conflict; refusing to overwrite ${readmePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { path: readmePath, content, status: 'planned' };
  }
}

async function installReadme(target, readme) {
  const segments = ['.smith', 'README.md'];
  await assertNoSymlinkPath(target, segments);
  await mkdir(dirname(readme.path), { recursive: true });
  await assertNoSymlinkPath(target, segments);
  await atomicWrite(readme.path, readme.content, { previous: readme.previous, changedMessage: `README changed after preview: ${readme.path}` });
}

function getNextStep(client, installPath, promptDirectory) {
  if (client === 'copilot-cli') {
    return { action: 'Run doctor after explicitly activating the local plugin', path: installPath };
  }
  if (client === 'jetbrains') {
    return {
      action:
        'Open GitHub Copilot Chat in IntelliJ and use the Smith prompts from the project customizations; no native plugin activation or personal settings were changed',
      path: promptDirectory,
    };
  }
  return { action: 'Open GitHub Copilot Chat in VS Code and select an Smith project prompt', path: promptDirectory };
}

function parseCopilotPluginList(output) {
  const result = JSON.parse(output);
  const plugins = Array.isArray(result) ? result : result.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error('Copilot CLI returned an invalid plugin list');
  }
  return plugins;
}

function findCopilotPlugin(plugins, pluginName) {
  const matches = plugins.filter(({ name }) => name === pluginName);
  if (matches.length > 1) {
    throw new Error(`Copilot CLI returned multiple registrations named "${pluginName}"`);
  }
  return matches[0];
}

function matchesPluginPath(plugin, installPath, targetRoot) {
  return (
    typeof plugin?.source === 'string' &&
    resolve(targetRoot, plugin.source) === resolve(installPath)
  );
}

async function treesMatch(sourceRoot, destination, files, allowUnknownEntries = false) {
  const destinationFiles = await collectFiles(destination, destination, [], undefined, {
    allowUnknownDirectories: allowUnknownEntries,
    includeSymlinks: allowUnknownEntries,
  });
  if (JSON.stringify(files) !== JSON.stringify(destinationFiles)) {
    return false;
  }
  for (const file of files) {
    const [source, installed] = await Promise.all([
      readFile(join(sourceRoot, file)),
      readFile(join(destination, file)),
    ]);
    if (!source.equals(installed)) {
      return false;
    }
  }
  return true;
}

async function assertReplaceableRuntime(source, destination, files, manifest, { forceOverwrite = false } = {}) {
  const allowedDirectories = new Set(files.flatMap((file) => {
    const parts = file.split('/');
    return parts.slice(0, -1).map((_, index) => join(...parts.slice(0, index + 1)));
  }));
  const sourceEntries = await readdir(source, { recursive: true, withFileTypes: true });
  for (const entry of sourceEntries) {
    if (entry.isDirectory()) {
      allowedDirectories.add(relative(source, join(entry.parentPath, entry.name)).split(sep).join('/'));
    }
  }
  const installedFiles = await collectFiles(destination, destination, [], allowedDirectories, {
    allowUnknownDirectories: forceOverwrite,
    includeSymlinks: forceOverwrite,
  });
  if (!installedFiles.includes('plugin.json')) {
    throw new Error(`Installation conflict; refusing to overwrite unknown files at ${destination}`);
  }
  const allowedFiles = new Set(files);
  const unknownFiles = installedFiles.filter((file) => !allowedFiles.has(file));
  if (unknownFiles.length > 0 && !forceOverwrite) {
    if (!stdin.isTTY) {
      throw new Error(`Installation conflict; refusing to overwrite unknown files at ${destination}`);
    }
    const terminal = createInterface({ input: stdin, output: process.stderr });
    let confirmed;
    try {
      const answer = await terminal.question(
        `Arquivos personalizados ou de versões anteriores em ${destination} serão substituídos. Prosseguir? (s/n): `,
      );
      confirmed = answer.trim().toLowerCase() === 's';
    } finally {
      terminal.close();
    }
    if (!confirmed) {
      throw new Error(`Installation cancelled; refusing to overwrite unknown files at ${destination}`);
    }
  }
  const installed = await readManifest(destination);
  if (installed.name !== manifest.name || installed.version !== manifest.version) {
    throw new Error(`Installation conflict; unexpected plugin identity at ${destination}`);
  }
}

async function askForInstallConfirmation() {
  if (!stdin.isTTY) {
    throw new Error('External installation requires an interactive terminal; no changes were made');
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(
      'This will install Superpowers in your Copilot CLI user configuration. Type INSTALL to continue: ',
    );
    return answer.trim() === 'INSTALL';
  } finally {
    terminal.close();
  }
}

async function askForActivationConfirmation() {
  if (!stdin.isTTY) {
    throw new Error('Copilot CLI activation requires an interactive terminal; no changes were made');
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(
      'This will register smith in your Copilot CLI user configuration. Type ENABLE to continue: ',
    );
    return answer.trim() === 'ENABLE';
  } finally {
    terminal.close();
  }
}

async function askForMcpConfirmation(plan) {
  if (!stdin.isTTY) {
    throw new Error('MCP configuration requires an interactive terminal; no changes were made');
  }
  stdout.write(
    `MCP configuration preview:\n${JSON.stringify(
      { configPath: plan.configPath, servers: plan.additions, warnings: plan.warnings },
      null,
      2,
    )}\n`,
  );
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(
      'This writes MCP configuration; Multi-CLI may download its pinned package when started. Type CONFIGURE to continue: ',
    );
    return answer.trim() === 'CONFIGURE';
  } finally {
    terminal.close();
  }
}

async function installSuperpowers({ runCommand, targetRoot, installPath }) {
  const completedCommands = [];
  const commands = [
    ['copilot', ['plugin', 'marketplace', 'add', 'obra/superpowers-marketplace']],
    ['copilot', ['plugin', 'install', 'superpowers@superpowers-marketplace']],
  ];
  try {
    const { stdout: currentOutput } = await runCommand('copilot', ['plugin', 'list', '--json'], {
      cwd: targetRoot,
    });
    const currentPlugins = parseCopilotPluginList(currentOutput);
    const existing = findCopilotPlugin(currentPlugins, 'superpowers');
    if (existing?.enabled === true) {
      return true;
    }
    if (existing) {
      throw new Error('Superpowers is registered but disabled; enable it explicitly before retrying');
    }

    for (const [command, args] of commands) {
      await runCommand(command, args, { cwd: targetRoot });
      completedCommands.push(`${command} ${args.join(' ')}`);
    }
    const { stdout: output } = await runCommand('copilot', ['plugin', 'list', '--json'], {
      cwd: targetRoot,
    });
    const plugins = parseCopilotPluginList(output);
    if (findCopilotPlugin(plugins, 'superpowers')?.enabled !== true) {
      throw new Error('Superpowers was not enabled after installation');
    }
    return true;
  } catch (error) {
    throw new Error(
      `Superpowers installation failed after plugin setup at ${installPath}: ${error.message}. ` +
        `External commands completed: ${completedCommands.join('; ') || 'none'}.`,
      { cause: error },
    );
  }
}

async function registerPluginWithCopilot({ runCommand, targetRoot, installPath, pluginName }) {
  let registrationAttempted = false;
  try {
    const { stdout: currentOutput } = await runCommand('copilot', ['plugin', 'list', '--json'], {
      cwd: targetRoot,
    });
    const currentPlugins = parseCopilotPluginList(currentOutput);
    const existing = findCopilotPlugin(currentPlugins, pluginName);
    if (existing) {
      if (!matchesPluginPath(existing, installPath, targetRoot)) {
        throw new Error(`${pluginName} is already registered from a different source; refusing to replace it`);
      }
      if (existing.enabled === true) {
        return true;
      }
      registrationAttempted = true;
      await runCommand('copilot', ['plugin', 'enable', pluginName], { cwd: targetRoot });
      const { stdout: enabledOutput } = await runCommand(
        'copilot',
        ['plugin', 'list', '--json'],
        { cwd: targetRoot },
      );
      const enabledPlugin = findCopilotPlugin(parseCopilotPluginList(enabledOutput), pluginName);
      if (enabledPlugin?.enabled !== true || !matchesPluginPath(enabledPlugin, installPath, targetRoot)) {
        throw new Error(`${pluginName} was not enabled from the local package after activation`);
      }
      return true;
    }

    registrationAttempted = true;
    await runCommand('copilot', ['plugin', 'install', installPath], { cwd: targetRoot });
    const { stdout: output } = await runCommand('copilot', ['plugin', 'list', '--json'], {
      cwd: targetRoot,
    });
    const plugins = parseCopilotPluginList(output);
    const installedPlugin = findCopilotPlugin(plugins, pluginName);
    if (installedPlugin?.enabled !== true || !matchesPluginPath(installedPlugin, installPath, targetRoot)) {
      throw new Error(`${pluginName} was not enabled from the local package after activation`);
    }
    return true;
  } catch (error) {
    const partial =
      registrationAttempted
        ? 'The activation command may have changed Copilot CLI user configuration; verify its plugin list before retrying.'
        : 'No activation command was issued; Copilot CLI plugin status could not be verified.';
    throw new Error(
      `Copilot CLI activation failed after local plugin setup at ${installPath}: ${error.message} ${partial}`,
      { cause: error },
    );
  }
}

function parseFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const lines = match[1].split('\n');
  const result = {};
  let currentKey = null;
  for (const line of lines) {
    const keyValue = /^([\w][\w-]*):\s*(.*)$/.exec(line);
    if (keyValue) {
      currentKey = keyValue[1];
      const value = keyValue[2].trim();
      if (value === '') {
        result[currentKey] = [];
      } else if (value.startsWith('"') && value.endsWith('"')) {
        result[currentKey] = value.slice(1, -1);
      } else {
        result[currentKey] = value;
      }
    } else if (currentKey !== null && Array.isArray(result[currentKey])) {
      const item = /^\s+-\s+(.+)$/.exec(line);
      if (item) result[currentKey].push(item[1].trim());
    }
  }
  return result;
}

function deriveSlug(filename) {
  return filename.replace(/^\d+-/, '').replace(/\.prompt\.md$/, '');
}

function extractBody(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart();
}

async function findAgentDistDir(sourceRoot, agent) {
  const candidates = [
    join(sourceRoot, 'agents', agent),
    join(sourceRoot, '..', 'agents', agent),
    join(sourceRoot, 'dist', 'smith-plugin', 'agents', agent),
    join(sourceRoot, 'smith-plugin', 'agents', agent),
    join(sourceRoot, '..', agent),
    join(sourceRoot, 'dist', agent),
    join(sourceRoot, agent),
  ];
  for (const candidate of candidates) {
    try {
      const info = await lstat(candidate);
      if (info.isDirectory()) return candidate;
    } catch {}
  }
  return null;
}

async function resolveSourcePath(sourceRoot, primary, fallback) {
  try {
    const full = join(sourceRoot, primary);
    await lstat(full);
    return full;
  } catch {
    if (fallback) {
      try {
        const fullFallback = join(sourceRoot, fallback);
        await lstat(fullFallback);
        return fullFallback;
      } catch {}
    }
    const resPath = join(sourceRoot, "resources", primary);
    try {
      await lstat(resPath);
      return resPath;
    } catch {}
    return join(sourceRoot, primary);
  }
}

async function installAgentFiles({ sourceRoot, targetRoot, agent, manifest, forceOverwrite = false }) {
  const distDir = await findAgentDistDir(sourceRoot, agent);
  if (distDir) {
    const entries = await readdir(distDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const srcFile = join(entry.parentPath, entry.name);
        const rel = relative(distDir, srcFile);
        const destFile = join(targetRoot, rel);
        const content = await readFile(srcFile);
        await mkdir(dirname(destFile), { recursive: true });
        await atomicWrite(destFile, content, { force: forceOverwrite });
      }
    }
    return;
  }

  const overviewPath = await resolveSourcePath(
    sourceRoot,
    'agents/common/workflow-overview.md',
    'resources/agents/common/workflow-overview.md',
  );
  let workflowOverview = '';
  try {
    workflowOverview = (await readFile(overviewPath, 'utf8')).trimEnd();
  } catch {}

  const substitutions = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    'author-name': manifest.author?.name ?? '',
    'author-email': manifest.author?.email ?? '',
    homepage: manifest.homepage ?? '',
    repository: manifest.repository ?? '',
    'workflow-overview': workflowOverview,
    header: getAgentHeader(agent),
    'command-mapping': getAgentCommandMapping(agent),
    workflowCommand: '',
  };

  const fileSpecs = AGENT_FILE_MAP[agent] ?? [];
  for (const spec of fileSpecs) {
    let content;
    if (spec.template !== undefined) {
      const templatePath = await resolveSourcePath(sourceRoot, spec.template, spec.fallback ?? spec.template);
      content = await loadTemplate(templatePath, substitutions);
    } else {
      const srcPath = await resolveSourcePath(sourceRoot, spec.source, spec.fallback ?? spec.source);
      content = await readFile(srcPath, 'utf8');
    }
    const dest = join(targetRoot, spec.destination);
    await mkdir(dirname(dest), { recursive: true });
    await atomicWrite(dest, Buffer.from(content), { force: forceOverwrite });
  }

  const promptsDir = join(sourceRoot, 'workflows', 'prompts');
  let promptEntries;
  try {
    promptEntries = await readdir(promptsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        const altDir = join(sourceRoot, 'resources', 'prompts');
        promptEntries = await readdir(altDir, { withFileTypes: true });
      } catch (altError) {
        if (altError.code === 'ENOENT') return;
        throw altError;
      }
    } else {
      throw error;
    }
  }

  const promptFiles = promptEntries
    .filter((e) => e.isFile() && e.name.endsWith('.prompt.md'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const skillTemplatePath = await resolveSourcePath(
    sourceRoot,
    'agents/common/skill.md',
    'resources/agents/common/skill.md',
  );

  if (agent !== 'copilot') {
    const bootstrapTemplatePath = await resolveSourcePath(
      sourceRoot,
      'agents/common/skill-bootstrap.md',
      'resources/agents/common/skill-bootstrap.md',
    );
    try {
      const bootstrapContent = await loadTemplate(bootstrapTemplatePath, {
        'workflow-overview': workflowOverview,
      });
      const bootstrapDestRelative = AGENT_PROMPT_DEST[agent]('using-smith');
      const bootstrapDest = join(targetRoot, bootstrapDestRelative);
      await mkdir(dirname(bootstrapDest), { recursive: true });
      await atomicWrite(bootstrapDest, Buffer.from(bootstrapContent), { force: forceOverwrite });
    } catch {}
  }

  for (const entry of promptFiles) {
    const raw = (await readFile(join(entry.parentPath ?? promptsDir, entry.name), 'utf8')).replaceAll('\r\n', '\n');
    const slug = deriveSlug(entry.name);
    const destRelative = AGENT_PROMPT_DEST[agent](slug);
    const dest = join(targetRoot, destRelative);

    let content;
    if (agent === 'copilot') {
      content = raw.replaceAll('.copilot/plugins/smith/templates/', '');
    } else {
      const frontmatter = parseFrontmatter(raw);
      const triggers = Array.isArray(frontmatter.triggers) ? frontmatter.triggers : [];
      const triggersYaml = triggers.map((t) => `  - ${t}`).join('\n');
      content = await loadTemplate(skillTemplatePath, {
        'skill-name': frontmatter.name ?? slug,
        'description': frontmatter.description ?? '',
        'triggers': triggersYaml,
        'content': extractBody(raw).replaceAll('.copilot/plugins/smith/templates/', '').trimEnd(),
      });
    }

    await mkdir(dirname(dest), { recursive: true });
    await atomicWrite(dest, Buffer.from(content), { force: forceOverwrite });

    if (agent === 'codex') {
      const openaiTemplatePath = await resolveSourcePath(
        sourceRoot,
        'agents/codex/openai-skill.yaml',
        'resources/agents/codex/openai-skill.yaml',
      );
      try {
        const frontmatter = parseFrontmatter(raw);
        const openaiYaml = await loadTemplate(openaiTemplatePath, {
          'skill-name': frontmatter.name ?? slug,
          'description': frontmatter.description ?? '',
        });
        const openaiDest = join(dirname(dest), 'openai.yaml');
        await atomicWrite(openaiDest, Buffer.from(openaiYaml), { force: forceOverwrite });
      } catch {}
    }
  }
}

export async function installAgentPlugin({
  sourceRoot,
  targetRoot,
  agent,
  forceOverwrite = false,
} = {}) {
  if (!SUPPORTED_AGENTS.has(agent)) {
    throw new Error(`Unsupported agent: ${agent}. Supported: ${[...SUPPORTED_AGENTS].join(', ')}`);
  }
  if (typeof targetRoot !== 'string' || targetRoot.length === 0) {
    throw new TypeError('targetRoot is required');
  }

  if (sourceRoot === undefined) {
    const oneUp = fileURLToPath(new URL('..', import.meta.url));
    try {
      await readFile(join(oneUp, 'plugin.json'), 'utf8');
      sourceRoot = oneUp;
    } catch {
      sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
    }
  }

  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  await assertDirectory(source, 'Plugin source');
  await assertDirectory(target, 'Target workspace');
  const manifest = await readManifest(source);

  await installAgentFiles({ sourceRoot: source, targetRoot: target, agent, manifest, forceOverwrite });
  await initializeWorkspaceDirectories(target);

  return { status: 'installed', agent, target, workspaceDirectories: DEFAULT_WORKSPACE_DIRECTORIES };
}

export async function initializePlugin({
  sharedRoot,
  sourceRoot,
  targetRoot,
  client,
  dryRun = false,
  forceOverwrite = false,
  nodeVersion = process.versions.node,
  installSuperpowers: shouldInstallSuperpowers = false,
  activatePlugin: shouldActivatePlugin = false,
  configureMcpServers: shouldConfigureMcpServers = false,
  includeMultiCli = false,
  confirmExternalInstall,
  confirmPluginActivation,
  confirmMcpChanges,
  confirmLegacyCleanup,
  confirmForceOverwrite,
  runCommand = (command, args, options) => execFileAsync(command, args, options),
} = {}) {
  if (!SUPPORTED_CLIENTS.has(client)) {
    throw new Error(`Unsupported or incompatible plugin client: ${client}`);
  }
  if (nodeMajor(nodeVersion) < MIN_NODE_MAJOR) {
    throw new Error(`Node.js ${MIN_NODE_MAJOR} or later is required; found ${nodeVersion}`);
  }
  if (typeof targetRoot !== 'string' || targetRoot.length === 0) {
    throw new TypeError('targetRoot is required');
  }
  if (includeMultiCli && !shouldConfigureMcpServers) {
    throw new Error('--include-multicli requires --configure-mcp');
  }

  if (sourceRoot === undefined) {
    const oneUp = fileURLToPath(new URL('..', import.meta.url));
    try {
      await readFile(join(oneUp, 'plugin.json'), 'utf8');
      sourceRoot = oneUp;
    } catch {
      sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
    }
  }
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  await assertDirectory(source, 'Plugin source');
  await assertDirectory(target, 'Target workspace');
  const manifest = await readManifest(source);
  const files = await collectFiles(source);
  const shared = isSharedClient(client);
  const destination = shared ? sharedDestination(manifest.version, sharedRoot) : join(target, '.copilot', 'plugins', manifest.name);
  const readmePluginPath = shared ? destination : join('.copilot', 'plugins', manifest.name);
  const command = shared ? workflowCommand(manifest.version, sharedRoot) : undefined;
  const initialProjectPrompt = await readFile(join(source, 'instructions', 'initial-project.md'), 'utf8');
  const promptHistory = shared ? await readPromptHistory(source) : undefined;
  const packageInstructions = await readInstructions(source, manifest.name);
  const instructionCandidates = [
    join(source, 'agents', 'copilot', '.github', 'instructions', 'smith.instructions.md'),
    join(source, 'instructions', 'smith.instructions.md'),
    join(source, '..', 'agents', 'copilot', '.github', 'instructions', 'smith.instructions.md'),
    join(source, '..', 'copilot', '.github', 'instructions', 'smith.instructions.md'),
    join(source, 'dist', 'copilot', '.github', 'instructions', 'smith.instructions.md'),
    join(source, 'resources', 'instructions', 'smith.instructions.md'),
    join(source, '.github', 'instructions', 'smith.instructions.md'),
  ];
  let instructionsTemplatePath = null;
  for (const candidate of instructionCandidates) {
    try {
      const info = await lstat(candidate);
      if (!info.isSymbolicLink() && info.isFile()) {
        instructionsTemplatePath = candidate;
        break;
      }
    } catch {}
  }
  if (shared && !instructionsTemplatePath) {
    throw new Error(`Copilot instructions template is required: ${join(source, 'instructions', 'smith.instructions.md')}`);
  }
  let workflowProjectInstructions = shared && instructionsTemplatePath
    ? await loadTemplate(instructionsTemplatePath, {
        version: manifest.version,
        workflowCommand: command ?? '',
        header: `---\napplyTo: "**"\n---\n\n<!-- Smith Plugin v${manifest.version} — workflow command: ${command ?? ''} -->\n`,
        'command-mapping': getAgentCommandMapping('copilot'),
      })
    : undefined;
  if (workflowProjectInstructions) {
    const runtimePrefix = shared ? destination.split(sep).join("/") : `.copilot/plugins/${manifest.name}`;
    workflowProjectInstructions = workflowProjectInstructions
      .replaceAll('plugin/templates/', `${runtimePrefix}/templates/`)
      .replaceAll('plugin/core/', `${runtimePrefix}/core/`)
      .replaceAll('plugin/dynamic-workflow/', `${runtimePrefix}/core/`)
      .replaceAll('plugin/installer/', `${runtimePrefix}/installer/`)
      .replaceAll('plugin/mcp/', `${runtimePrefix}/mcp/`)
      .replaceAll('plugin/utils/repository/sync/', `${runtimePrefix}/utils/repository/sync/`)
      .replaceAll('plugin/repository-sync/', `${runtimePrefix}/utils/repository/sync/`)
      .replaceAll('plugin/workflows/', `${runtimePrefix}/workflows/`);
  }
  const instructions = shared ? workflowProjectInstructions : packageInstructions;
  const copilotInstructionsPath = join(target, '.github', 'copilot-instructions.md');
  const supplementalInstructionsPath = join(
    target,
    '.github',
    'instructions',
    `${manifest.name}.instructions.md`,
  );
  const existingSupplement = instructions === undefined
    ? undefined
    : await readExistingInstructions(supplementalInstructionsPath);
  const existingProjectInstructions = instructions === undefined
    ? undefined
    : await readExistingInstructions(copilotInstructionsPath);
  const supplementIsSmithManaged = existingSupplement !== undefined &&
    (
      existingSupplement === instructions ||
      existingSupplement === packageInstructions ||
      (shared && /<!-- Smith Plugin v[\s\S]*? -->/.test(existingSupplement))
    );
  const projectInstructionsAreSmithManaged = existingProjectInstructions !== undefined &&
    (
      existingProjectInstructions === instructions ||
      existingProjectInstructions === packageInstructions ||
      (shared && /<!-- Smith Plugin v[\s\S]*? -->/.test(existingProjectInstructions))
    );
  const instructionsPath = (
    (existingProjectInstructions !== undefined && !projectInstructionsAreSmithManaged) ||
    (existingSupplement !== undefined && !supplementIsSmithManaged)
  )
    ? supplementalInstructionsPath
    : copilotInstructionsPath;
  const promptAssets = shared
    ? await readJetBrainsPromptAssets(source, command, promptHistory)
    : [];
  const updatingInstalledRuntime = shared && source === destination && forceOverwrite;
  if (within(source, destination) && !updatingInstalledRuntime) {
    throw new Error('Plugin installation target cannot be inside its source directory');
  }
  await assertNoSymlinkPath(target, ['.copilot', 'plugins', manifest.name]);
  if (shared) await assertSharedPath(source, target, destination, updatingInstalledRuntime);
  if (instructions !== undefined) {
    await assertNoSymlinkPath(
      target,
      instructionsPath === copilotInstructionsPath
        ? ['.github', 'copilot-instructions.md']
        : ['.github', 'instructions', `${manifest.name}.instructions.md`],
    );
  }

  let destinationExists = false;
  try {
    const info = await lstat(destination);
    destinationExists = true;
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Installation destination is not a real directory: ${destination}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  let viewer = await inspectViewer(target, source, destination, destinationExists, forceOverwrite, initialProjectPrompt);
  let readme = await inspectReadme(target, renderReadme(readmePluginPath, manifest.version, initialProjectPrompt));
  let reinstallRuntime = false;
  if (destinationExists) {
    if (shared) await assertReplaceableRuntime(source, destination, files, manifest, { forceOverwrite });
    if (!(await treesMatch(source, destination, files, forceOverwrite))) {
      if (!shared) {
        throw new Error(`Installation conflict; refusing to overwrite existing files at ${destination}`);
      }
      reinstallRuntime = true;
      const installedPrompts = (await collectFiles(destination, destination, [], undefined, {
        allowUnknownDirectories: forceOverwrite,
        includeSymlinks: forceOverwrite,
      })).filter((file) => file.startsWith('workflows/prompts/'));
      if (JETBRAINS_PROMPTS.every(({ source: asset }) => installedPrompts.includes(`workflows/prompts/${asset}`))) {
        const previous = await readJetBrainsPromptAssets(destination, command, promptHistory);
        for (const [index, prompt] of promptAssets.entries()) {
          prompt.previousContents.push(previous[index].content);
        }
      }
    }
  }
  let instructionsExist = false;
  let replaceInstructions = false;
  let originalInstructions;
  if (instructions !== undefined) {
    try {
      const info = await lstat(instructionsPath);
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error(`Instructions destination is not a regular file: ${instructionsPath}`);
      }
      instructionsExist = true;
      const existing = await readFile(instructionsPath, 'utf8');
      if (existing !== instructions) {
        replaceInstructions = true;
        originalInstructions = existing;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  let prompts = await inspectJetBrainsPromptDestinations(target, promptAssets, forceOverwrite);
  const legacyRoot = join(target, '.copilot', 'plugins', manifest.name);
  let hasSupplement = instructionsExist;
  if (client === 'jetbrains') {
    try {
      await lstat(instructionsPath);
      hasSupplement = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const automaticCleanup = client === 'jetbrains' && !hasSupplement && prompts.some(({ previous, path }) =>
    previous && !promptAssets.find(({ destination }) => destination === basename(path))?.previousContents?.some((content) => content.equals(previous)),
  );
  let legacy = shared ? await inspectLegacy(legacyRoot, { owned: true }) : undefined;
  const requiresConfirmation = shared && !automaticCleanup && legacy.planned.length > 0;
  let cleanupAuthorized = automaticCleanup;
  if (shouldInstallSuperpowers && client !== 'copilot-cli') {
    throw new Error('No verified Superpowers installation command is available for this client');
  }
  if (shouldActivatePlugin && client !== 'copilot-cli') {
    throw new Error('Automatic plugin activation is only verified for Copilot CLI');
  }
  let mcpConfiguration;
  if (shouldConfigureMcpServers) {
    mcpConfiguration = await previewMcpConfiguration({
      client,
      workspaceRoot: target,
      includeMultiCli,
    });
    if (!dryRun && mcpConfiguration.status === 'planned') {
      const confirm = confirmMcpChanges ?? askForMcpConfirmation;
      if (!(await confirm(mcpConfiguration))) {
        throw new Error('MCP configuration was not authorized; no changes were made');
      }
    }
  }
  if (shouldInstallSuperpowers && !dryRun) {
    const confirm = confirmExternalInstall ?? askForInstallConfirmation;
    if (!(await confirm())) {
      throw new Error('External Superpowers installation was not authorized; no changes were made');
    }
  }
  if (shouldActivatePlugin && !dryRun) {
    const confirm = confirmPluginActivation ?? askForActivationConfirmation;
    if (!(await confirm())) {
      throw new Error('Copilot CLI activation was not authorized; no changes were made');
    }
  }

  if (!dryRun && forceOverwrite) {
    const confirm = confirmForceOverwrite ?? askForForceOverwriteConfirmation;
    if (!(await confirm({ runtimePath: destination, targetRoot: target }))) {
      throw new Error('Force overwrite was not authorized; no changes were made');
    }
    cleanupAuthorized = true;
  }

  if (!dryRun) {
    if (requiresConfirmation && !cleanupAuthorized) {
      const confirm = confirmLegacyCleanup ?? askForLegacyCleanupConfirmation;
      cleanupAuthorized = await confirm({ root: legacyRoot, files: legacy.planned });
    }
    prompts = await inspectJetBrainsPromptDestinations(target, promptAssets, forceOverwrite);
  }

  if (dryRun) {
    const instructionsNeedInstall = instructions !== undefined && (!instructionsExist || replaceInstructions);
    const promptsNeedInstall = prompts.some(({ status }) => status !== 'unchanged');
    return {
      status: destinationExists && !reinstallRuntime && !instructionsNeedInstall && !promptsNeedInstall && viewer.status === 'unchanged' && viewer.css?.status === 'unchanged' && viewer.js?.status === 'unchanged' && readme.status === 'unchanged' && !legacy?.planned.length ? 'unchanged' : 'planned',
      runtimeStatus: reinstallRuntime ? 'reinstall-planned' : destinationExists ? 'unchanged' : 'planned',
      client,
      installPath: destination,
      viewerPath: viewer.path,
      viewerStatus: viewer.status,
      readmePath: readme.path,
      readmeStatus: readme.status,
      legacy: legacy && { ...legacy, requiresConfirmation },
      mcpConfiguration,
      files,
      prompts: prompts.map(({ path: promptPath, status }) => ({ path: promptPath, status })),
      instructionFile: instructionsPath,
      instructionStatus:
        instructions === undefined
          ? 'not-in-package'
          : replaceInstructions ? 'update-planned' : instructionsExist
            ? 'unchanged'
            : 'planned',
      externalCommands: shouldInstallSuperpowers
        ? [
            'copilot plugin list --json',
            'copilot plugin marketplace add obra/superpowers-marketplace',
            'copilot plugin install superpowers@superpowers-marketplace',
            'copilot plugin list --json',
          ]
        : [],
      activationCommand:
        client === 'copilot-cli' && (dryRun || !shouldActivatePlugin)
          ? {
              command: 'copilot',
              args: ['plugin', 'install', destination],
              requiresAuthorization: true,
              warning: 'This command changes Copilot CLI user configuration.',
            }
          : undefined,
      nextStep: getNextStep(client, destination, join(target, '.github', 'prompts')),
      workspaceDirectories: DEFAULT_WORKSPACE_DIRECTORIES,
    };
  }

  let status = 'unchanged';
  const changedFiles = [];
  viewer = await inspectViewer(target, source, destination, destinationExists, forceOverwrite, initialProjectPrompt);
  readme = await inspectReadme(target, renderReadme(readmePluginPath, manifest.version, initialProjectPrompt));
  if (!destinationExists || reinstallRuntime) {
    const parent = dirname(destination);
    if (shared) await assertSharedPath(source, target, destination);
    await mkdir(parent, { recursive: true });
    if (shared) await assertSharedPath(source, target, destination);
    else await assertNoSymlinkPath(target, ['.copilot', 'plugins', manifest.name]);
    const temporary = join(parent, `.${manifest.name}.${randomUUID()}.tmp`);
    const backup = `${temporary}.previous`;
    const lock = `${destination}.install-lock`;
    if (shared) await mkdir(lock);
    try {
      await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
      if (reinstallRuntime) {
        await assertSharedPath(source, target, destination);
        await assertReplaceableRuntime(source, destination, files, manifest, { forceOverwrite });
        await rename(destination, backup);
      }
      try {
        await rename(temporary, destination);
      } catch (error) {
        if (reinstallRuntime) {
          try {
            await rename(backup, destination);
          } catch (restoreError) {
            throw new AggregateError([error, restoreError], `Runtime update failed; previous runtime is preserved at ${backup}`);
          }
        }
        throw error;
      }
      if (reinstallRuntime) await rm(backup, { recursive: true });
    } catch (error) {
      try {
        await rm(temporary, { recursive: true, force: true });
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          throw cleanupError;
        }
      }
      throw error;
    } finally {
      if (shared) await rmdir(lock);
    }
    status = 'installed';
    changedFiles.push(destination);
  }

  if (instructions !== undefined && (!instructionsExist || replaceInstructions)) {
    const previous = replaceInstructions ? Buffer.from(originalInstructions, 'utf8') : undefined;
    try {
      await mkdir(dirname(instructionsPath), { recursive: true });
      await assertNoSymlinkPath(
        target,
        instructionsPath === copilotInstructionsPath
          ? ['.github', 'copilot-instructions.md']
          : ['.github', 'instructions', `${manifest.name}.instructions.md`],
      );
      await atomicWrite(instructionsPath, instructions, { previous, changedMessage: `Instructions changed after preview: ${instructionsPath}` });
      status = 'installed';
      changedFiles.push(instructionsPath);
    } catch (error) {
      const partial = changedFiles.length
        ? `Plugin package is installed at ${destination}, but its instructions were not installed`
        : 'Instructions were not installed';
      throw new Error(`${partial}: ${error.message}`, { cause: error });
    }
  }

  for (const prompt of prompts) {
    if (prompt.status === 'unchanged') {
      continue;
    }
    try {
      await installPromptWithoutOverwrite(target, prompt.path, prompt.content, prompt.previous);
      prompt.status = prompt.previous ? 'updated' : 'installed';
      status = 'installed';
      changedFiles.push(prompt.path);
    } catch (error) {
      const updated = changedFiles.length ? ` Files already installed: ${changedFiles.join(', ')}.` : '';
      throw new Error(`Plugin files are installed, but prompt installation failed: ${error.message}${updated}`, {
        cause: error,
      });
    }
  }

  if (viewer.status !== 'unchanged') {
    if (viewer.status === 'conflict') {
      throw new Error(`Workflow viewer conflict; refusing to overwrite user-modified file at ${viewer.path}`);
    }
    try {
      await installViewer(target, viewer);
      viewer.status = viewer.previous ? 'updated' : 'installed';
      status = 'installed';
      changedFiles.push(viewer.path);
    } catch (error) {
      const updated = changedFiles.length ? ` Files already installed: ${changedFiles.join(', ')}.` : '';
      throw new Error(`Plugin files are installed, but workflow viewer installation failed: ${error.message}${updated}`, { cause: error });
    }
  }

  if (readme.status !== 'unchanged') {
    try {
      await installReadme(target, readme);
      readme.status = readme.previous ? 'updated' : 'installed';
      status = 'installed';
      changedFiles.push(readme.path);
    } catch (error) {
      const updated = changedFiles.length ? ` Files already installed: ${changedFiles.join(', ')}.` : '';
      throw new Error(`Plugin files are installed, but README installation failed: ${error.message}${updated}`, { cause: error });
    }
  }

  if (shared) {
    await assertNoSymlinkPath(target, ['.copilot', 'plugins', manifest.name]);
    legacy = {
      ...await inspectLegacy(legacyRoot, { owned: cleanupAuthorized, apply: true }),
      requiresConfirmation: requiresConfirmation && !cleanupAuthorized,
    };
    if (legacy.removed.length) status = 'installed';
    changedFiles.push(...legacy.removed);
  }

  await initializeWorkspaceDirectories(target);

  let pluginActivated = false;
  if (shouldActivatePlugin) {
    try {
      pluginActivated = await registerPluginWithCopilot({
            runCommand,
            targetRoot: target,
            installPath: destination,
            pluginName: manifest.name,
      });
    } catch (error) {
      const updated = changedFiles.length ? ` Files already installed: ${changedFiles.join(', ')}.` : '';
      throw new Error(`${error.message}${updated}`, { cause: error });
    }
  }

  let superpowersInstalled = false;
  if (shouldInstallSuperpowers) {
    try {
      superpowersInstalled = await installSuperpowers({
        runCommand,
        targetRoot: target,
        installPath: destination,
      });
    } catch (error) {
      const updated = changedFiles.length ? ` Files already installed: ${changedFiles.join(', ')}.` : '';
      throw new Error(`${error.message}${updated}`, { cause: error });
    }
  }

  if (shouldConfigureMcpServers && mcpConfiguration?.status === 'planned') {
    try {
      mcpConfiguration = await configureMcpServers({
        client,
        workspaceRoot: target,
        includeMultiCli,
        approvedPlan: mcpConfiguration,
      });
    } catch (error) {
      const updated = changedFiles.length ? ` Files already installed: ${changedFiles.join(', ')}.` : '';
      throw new Error(`Plugin files are installed, but MCP configuration failed: ${error.message}${updated}`, {
        cause: error,
      });
    }
  }

  return {
    status,
    runtimeStatus: reinstallRuntime ? 'reinstalled' : destinationExists ? 'unchanged' : 'installed',
    client,
    installPath: destination,
    viewerPath: viewer.path,
    viewerStatus: viewer.status,
    readmePath: readme.path,
    readmeStatus: readme.status,
    legacy,
    files,
    instructionFile: instructionsPath,
    instructionStatus:
      instructions === undefined
        ? 'not-in-package'
        : replaceInstructions ? 'updated' : instructionsExist
          ? 'unchanged'
          : 'installed',
    pluginActivated,
    superpowersInstalled,
    mcpConfiguration,
    prompts: prompts.map(({ path: promptPath, status }) => ({ path: promptPath, status })),
    activationCommand:
      client === 'copilot-cli' && !pluginActivated
        ? {
            command: 'copilot',
            args: ['plugin', 'install', destination],
            requiresAuthorization: true,
            warning: 'This command changes Copilot CLI user configuration.',
          }
        : undefined,
    changedFiles,
    externalCommands: [],
    nextStep: getNextStep(client, destination, join(target, '.github', 'prompts')),
    workspaceDirectories: DEFAULT_WORKSPACE_DIRECTORIES,
  };
}

async function askForForceOverwriteConfirmation({ runtimePath, targetRoot }) {
  const terminal = createInterface({ input: stdin, output: process.stderr });
  try {
    const answer = await terminal.question(
      `--force substituirá o runtime em ${runtimePath} e os arquivos gerenciados do projeto em ${targetRoot}. ` +
      'Conteúdo personalizado no runtime será removido. Prosseguir? (s/n): ',
    );
    return answer.trim().toLowerCase() === 's';
  } finally {
    terminal.close();
  }
}

async function askForLegacyCleanupConfirmation({ root, files, instructionsPath }) {
  if (!stdin.isTTY) return false;
  const terminal = createInterface({ input: stdin, output: process.stderr });
  try {
    const paths = [...files, ...(instructionsPath ? [instructionsPath] : [])];
    const answer = await terminal.question(
      `Legacy Smith files in ${root} may still be used by Copilot CLI or an activated IDE plugin.\n` +
      `Only these verified files are eligible for removal or replacement:\n${paths.join('\n')}\n` +
      'If no other client depends on them, type MIGRATE to continue; otherwise press Enter to keep them: ',
    );
    return answer.trim() === 'MIGRATE';
  } finally {
    terminal.close();
  }
}

function parseArguments(args) {
  const options = {
    dryRun: false,
    installSuperpowers: false,
    activatePlugin: false,
    configureMcpServers: false,
    includeMultiCli: false,
    forceOverwrite: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--install-superpowers') {
      options.installSuperpowers = true;
      continue;
    }
    if (argument === '--activate') {
      options.activatePlugin = true;
      continue;
    }
    if (argument === '--configure-mcp') {
      options.configureMcpServers = true;
      continue;
    }
    if (argument === '--include-multicli') {
      options.includeMultiCli = true;
      continue;
    }
    if (argument === '--force') {
      options.forceOverwrite = true;
      continue;
    }
    const key = argument === '--target' ? 'targetRoot' : argument === '--client' ? 'client' : argument === '--agent' ? 'agent' : argument === '--shared-root' ? 'sharedRoot' : null;
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`Invalid or incomplete option: ${argument}`);
    }
    if (options[key] !== undefined) {
      throw new Error(`${argument} can only be provided once`);
    }
    options[key] = args[index + 1];
    index += 1;
  }
  if (!options.targetRoot || (!options.client && !options.agent)) {
    throw new Error(
      'Usage: node plugin/installer/init.mjs --target DIR --client jetbrains|copilot-cli|vscode [--agent AGENT] [--shared-root DIR] [--dry-run] [--activate] [--configure-mcp] [--include-multicli] [--force]\n' +
      '       node plugin/installer/init.mjs --target DIR --agent copilot|claude-code|cursor|gemini-cli|antigravity|codex',
    );
  }
  if (options.includeMultiCli && !options.configureMcpServers) {
    throw new Error('--include-multicli requires --configure-mcp');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.client) {
    const result = await installAgentPlugin({ targetRoot: options.targetRoot, agent: options.agent, forceOverwrite: options.forceOverwrite });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const result = await initializePlugin({
    ...options,
    confirmExternalInstall: options.installSuperpowers ? askForInstallConfirmation : undefined,
    confirmPluginActivation: options.activatePlugin ? askForActivationConfirmation : undefined,
  });
  if (options.agent) {
    await installAgentPlugin({ targetRoot: options.targetRoot, agent: options.agent, forceOverwrite: options.forceOverwrite });
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function isCurrentProcess(fileUrl) {
  if (!process.argv[1]) return false;
  const target = fileURLToPath(fileUrl);
  if (process.argv[1] === target) return true;
  try {
    return realpathSync(process.argv[1]) === realpathSync(target);
  } catch {
    return false;
  }
}

if (isCurrentProcess(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
