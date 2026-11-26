import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { stdout, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadTemplate } from './src/utils/template-loader.mjs';
import { buildPromptContent } from './src/installer/prompt-builder.mjs';
import { WORKFLOW_STEPS } from './src/workflows/project-lifecycle.mjs';

const SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const PUBLISHABLE_EXTENSIONS = new Set(['.mjs', '.md', '.json', '.html', '.css', '.js']);

const COPILOT_COMMAND_MAPPING = [
  "Quando o usuário invocar um comando `/Smith: ...`, leia o arquivo correspondente em `.github/prompts/` por inteiro e siga suas instruções. A lista do seletor não garante que o corpo do prompt tenha sido incluído na mensagem; portanto, não diga que faltam instruções antes de consultar o arquivo correspondente.",
  "Os arquivos de comando seguem o padrão `.github/prompts/smith-*.prompt.md` e estão mapeados abaixo.",
  "",
  "| Comando | Arquivo |",
  "|---|---|",
  "| `/Smith: Consolidação` | `.github/prompts/smith-discovery-consolidation.prompt.md` |",
  "| `/Smith: Knowledge As-Is` | `.github/prompts/smith-as-is-knowledge.prompt.md` |",
  "| `/Smith: Consolidar épico` | `.github/prompts/smith-business-epic.prompt.md` |",
  "| `/Smith: Especificação de Solução` | `.github/prompts/smith-tech-solution-specification.prompt.md` |",
  "| `/Smith: Registro de decisão` | `.github/prompts/smith-decision-record.prompt.md` |",
  "| `/Smith: Gate de validação` | `.github/prompts/smith-validation-gate.prompt.md` |",
  "| `/Smith: Quebra de histórias e plano` | `.github/prompts/smith-story-task-breakdown.prompt.md` |",
  "| `/Smith: Detalhamento técnico` | `.github/prompts/smith-technical-refinement.prompt.md` |",
  "| `/Smith: Knowledge Flow` | `.github/prompts/smith-knowledge-flow.prompt.md` |",
  "| `/Smith: Knowledge API` | `.github/prompts/smith-api-knowledge.prompt.md` |",
  "",
  "Só leia esses arquivos quando o usuário invocar um dos comandos Smith.",
].join("\n");

const AGENT_COMMAND_MAPPING = 'Mencione o trigger correspondente na conversa para ativar a etapa desejada. O gate de validação (`validation gate`) requer confirmação explícita com `APPROVE` para prosseguir para downstream.\n';

export const COPILOT_PROMPTS = [
  { source: '00-discovery-consolidation.prompt.md', destination: 'smith-discovery-consolidation.prompt.md' },
  { source: '01-business-epic.prompt.md', destination: 'smith-business-epic.prompt.md' },
  { source: '02-as-is-knowledge.prompt.md', destination: 'smith-as-is-knowledge.prompt.md' },
  { source: '04-decision-record.prompt.md', destination: 'smith-decision-record.prompt.md' },
  { source: '05-validation-gate.prompt.md', destination: 'smith-validation-gate.prompt.md' },
  { source: '06-tech-solution-specification.prompt.md', destination: 'smith-tech-solution-specification.prompt.md' },
  { source: '07-story-task-breakdown.prompt.md', destination: 'smith-story-task-breakdown.prompt.md' },
  { source: '08-technical-refinement.prompt.md', destination: 'smith-technical-refinement.prompt.md' },
  { source: '09-knowledge-flow.prompt.md', destination: 'smith-knowledge-flow.prompt.md' },
  { source: '10-api-knowledge.prompt.md', destination: 'smith-api-knowledge.prompt.md' },
];

export const AGENT_BUILD_RECIPES = {
  copilot: {
    targetDir: 'copilot',
    instructions: [
      {
        template: 'resources/instructions/smith.instructions.md',
        destination: '.github/instructions/smith.instructions.md',
        header: '---\napplyTo: "**"\n---\n',
        commandMapping: COPILOT_COMMAND_MAPPING,
        workflowCommand: '{{workflowCommand}}',
      },
      {
        template: 'resources/instructions/smith.instructions.md',
        destination: '.github/copilot-instructions.md',
        header: '---\napplyTo: "**"\n---\n',
        commandMapping: COPILOT_COMMAND_MAPPING,
        workflowCommand: '',
      },
    ],
    prompts: {
      sourceDir: 'resources/prompts',
      destinationDir: '.github/prompts',
      workflowCommand: '{{workflowCommand}}',
      items: COPILOT_PROMPTS,
    },
  },
  'claude-code': {
    targetDir: 'claude-code',
    manifest: {
      source: 'resources/agents/claude-code/plugin.json',
      destination: '.claude-plugin/plugin.json',
    },
    instructions: [
      {
        template: 'resources/instructions/smith.instructions.md',
        destination: 'CLAUDE.md',
        header: '',
        commandMapping: AGENT_COMMAND_MAPPING,
        workflowCommand: '',
      },
    ],
    skills: {
      prefix: '.claude/skills',
      includeOpenAiYaml: false,
    },
  },
  antigravity: {
    targetDir: 'antigravity',
    manifest: {
      source: 'resources/agents/antigravity/plugin.json',
      destination: '.antigravity-plugin/plugin.json',
    },
    instructions: [
      {
        template: 'resources/instructions/smith.instructions.md',
        destination: 'AGENTS.md',
        header: '',
        commandMapping: AGENT_COMMAND_MAPPING,
        workflowCommand: '',
      },
    ],
    skills: {
      prefix: 'skills',
      includeOpenAiYaml: false,
    },
  },
  codex: {
    targetDir: 'codex',
    manifest: {
      source: 'resources/agents/codex/plugin.json',
      destination: '.codex-plugin/plugin.json',
    },
    instructions: [
      {
        template: 'resources/instructions/smith.instructions.md',
        destination: 'AGENTS.md',
        header: '',
        commandMapping: AGENT_COMMAND_MAPPING,
        workflowCommand: '',
      },
    ],
    skills: {
      prefix: '.agents/skills',
      includeOpenAiYaml: true,
    },
  },
  cursor: {
    targetDir: 'cursor',
    manifest: {
      source: 'resources/agents/cursor/plugin.json',
      destination: '.cursor-plugin/plugin.json',
    },
    instructions: [
      {
        template: 'resources/instructions/smith.instructions.md',
        destination: '.cursor/rules/smith.mdc',
        header: '---\ndescription: Smith workflow instructions\nalwaysApply: true\n---\n',
        commandMapping: AGENT_COMMAND_MAPPING,
        workflowCommand: '',
      },
    ],
    skills: {
      prefix: '.cursor/skills',
      includeOpenAiYaml: false,
    },
  },
  'gemini-cli': {
    targetDir: 'gemini-cli',
    manifest: {
      source: 'resources/agents/gemini-cli/gemini-extension.json',
      destination: 'gemini-extension.json',
    },
    instructions: [
      {
        template: 'resources/instructions/smith.instructions.md',
        destination: 'GEMINI.md',
        header: '',
        commandMapping: AGENT_COMMAND_MAPPING,
        workflowCommand: '',
      },
    ],
    skills: {
      prefix: '.gemini/skills',
      includeOpenAiYaml: false,
    },
  },
};

async function discoverSourceFiles(repositoryRoot) {
  const srcDir = join(repositoryRoot, 'src');
  const entries = await readdir(srcDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => {
      const sourcePath = relative(srcDir, join(e.parentPath, e.name)).split(sep).join('/');
      return e.isFile() && !sourcePath.startsWith('report/prototipe/') &&
        PUBLISHABLE_EXTENSIONS.has(extname(e.name)) && !e.name.endsWith('.test.mjs') && !e.name.endsWith('.mjs.md');
    })
    .map((e) => `src/${relative(srcDir, join(e.parentPath, e.name)).split(sep).join('/')}`)
    .sort();
}

async function discoverTemplates(repositoryRoot) {
  const templatesDir = join(repositoryRoot, 'resources', 'templates');
  const entries = await readdir(templatesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `resources/templates/${entry.name}`)
    .sort();
}

async function discoverPrompts(repositoryRoot) {
  const promptsDir = join(repositoryRoot, 'resources', 'prompts');
  const entries = await readdir(promptsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `resources/prompts/${entry.name}`)
    .sort();
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

async function generateSkillContent(root) {
  const commonAgentsDir = join(root, 'resources', 'agents', 'common');
  const codexAgentsDir = join(root, 'resources', 'agents', 'codex');
  const promptsDir = join(root, 'resources', 'prompts');

  const workflowOverview = (await readFile(join(commonAgentsDir, 'workflow-overview.md'), 'utf8')).trimEnd();

  const promptEntries = (await readdir(promptsDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.prompt.md'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const skillContent = new Map();

  const bootstrapContent = await loadTemplate(join(commonAgentsDir, 'skill-bootstrap.md'), {
    'workflow-overview': workflowOverview,
  });
  skillContent.set('using-smith/SKILL.md', Buffer.from(bootstrapContent));

  for (const entry of promptEntries) {
    const raw = (await readFile(join(promptsDir, entry.name), 'utf8')).replaceAll('\r\n', '\n');
    const frontmatter = parseFrontmatter(raw);
    const slug = deriveSlug(entry.name);
    const triggers = Array.isArray(frontmatter.triggers) ? frontmatter.triggers : [];
    const triggersYaml = triggers.map((t) => `  - ${t}`).join('\n');

    const skillMd = await loadTemplate(join(commonAgentsDir, 'skill.md'), {
      'skill-name': frontmatter.name ?? slug,
      'description': frontmatter.description ?? '',
      'triggers': triggersYaml,
      'content': extractBody(raw).replaceAll('.copilot/plugins/smith/templates/', '').trimEnd(),
    });
    skillContent.set(`${slug}/SKILL.md`, Buffer.from(skillMd));

    const openaiYaml = await loadTemplate(join(codexAgentsDir, 'openai-skill.yaml'), {
      'skill-name': frontmatter.name ?? slug,
      'description': frontmatter.description ?? '',
    });
    skillContent.set(`${slug}/openai.yaml`, Buffer.from(openaiYaml));
  }

  return skillContent;
}

function isWithin(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

async function readRegularFile(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    throw new Error(`${label} is missing: ${path}`, { cause: error });
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${label} must be a regular file, not a symlink: ${path}`);
  }
  return readFile(path);
}

async function readPackageFile(repositoryRoot, relativePath, label) {
  let current = repositoryRoot;
  for (const segment of relativePath.split('/')) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`${label} path must not contain symlinks: ${current}`);
    }
  }
  return readRegularFile(current, label);
}

async function readAndValidateManifest(repositoryRoot) {
  let manifest;
  try {
    manifest = JSON.parse(
      (await readPackageFile(repositoryRoot, 'plugin.json', 'Plugin manifest')).toString('utf8'),
    );
  } catch (error) {
    throw new Error(`Plugin manifest is invalid: ${error.message}`, { cause: error });
  }
  const allowedProperties = new Set([
    '$schema',
    'name',
    'version',
    'description',
    'author',
    'homepage',
    'repository',
    'license',
    'keywords',
    'extensions',
  ]);
  if (
    manifest.$schema !== SCHEMA_URL ||
    manifest.name !== 'smith' ||
    manifest.name.length > 64 ||
    /--|\.\./.test(manifest.name) ||
    typeof manifest.version !== 'string' ||
    typeof manifest.description !== 'string' ||
    (manifest.keywords !== undefined &&
      (!Array.isArray(manifest.keywords) || !manifest.keywords.every((keyword) => typeof keyword === 'string'))) ||
    Object.keys(manifest).some((key) => !allowedProperties.has(key))
  ) {
    throw new Error('plugin.json must follow Agent Plugins 1.0 and the smith package identity');
  }
  return manifest;
}

async function resolveExistingPath(output) {
  let current = output;
  const missingSegments = [];
  while (true) {
    try {
      return resolve(await realpath(current), ...missingSegments);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new Error(`Build output path contains a dangling symlink: ${current}`);
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') {
          throw statError;
        }
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      missingSegments.unshift(relative(parent, current));
      current = parent;
    }
  }
}

async function resolveOutput(repositoryRoot, output) {
  const resolvedRoot = resolve(repositoryRoot);
  const srcRoot = join(resolvedRoot, 'src');
  const defaultOutput = join(resolvedRoot, 'dist', 'smith-plugin');
  if (typeof output !== 'string' || output.length === 0) {
    throw new TypeError('output must be a non-empty path');
  }
  const resolvedOutput = resolve(output);
  const [realSrcRoot, realOutput] = await Promise.all([
    realpath(srcRoot),
    resolveExistingPath(resolvedOutput),
  ]);
  if (
    (isWithin(realSrcRoot, realOutput) || isWithin(realOutput, realSrcRoot)) &&
    resolvedOutput !== defaultOutput
  ) {
    throw new Error('Build output must not overlap the plugin source directory');
  }
  return resolvedOutput;
}

async function assertDefaultOutputParentsAreSafe(repositoryRoot, output) {
  const defaultOutput = join(repositoryRoot, 'dist', 'smith-plugin');
  if (output !== defaultOutput) {
    return;
  }
  const distDir = join(repositoryRoot, 'dist');
  try {
    const info = await lstat(distDir);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Default build output parent must be a real directory: ${distDir}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function inspectOutput(output, replaceableFiles) {
  let info;
  try {
    info = await lstat(output);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
  const conflict = `Build output already exists; refusing to overwrite: ${output}`;
  if (!replaceableFiles || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(conflict);
  }
  const entries = await readdir(output, { recursive: true, withFileTypes: true });
  if (!entries.some((entry) => entry.parentPath === output && entry.name === 'plugin.json')) {
    throw new Error(`${conflict}; no package manifest`);
  }
  const manifest = JSON.parse((await readRegularFile(join(output, 'plugin.json'), 'Existing package manifest')).toString('utf8'));
  if (manifest?.name !== 'smith' || manifest.$schema !== SCHEMA_URL) {
    throw new Error(`${conflict}; not an Smith package`);
  }
  return true;
}

export async function buildAgentArtifacts({
  repositoryRoot = fileURLToPath(new URL('.', import.meta.url)),
  distRoot,
} = {}) {
  const root = await realpath(resolve(repositoryRoot));
  const destinationRoot = resolve(distRoot ?? join(root, 'dist', 'smith-plugin', 'agents'));
  const manifest = await readAndValidateManifest(root);
  const skillContent = await generateSkillContent(root);

  const results = {};

  for (const [agentName, recipe] of Object.entries(AGENT_BUILD_RECIPES)) {
    const agentDir = join(destinationRoot, recipe.targetDir);
    const contentByRelativePath = new Map();

    // 1. Manifest
    if (recipe.manifest) {
      const rendered = await loadTemplate(join(root, recipe.manifest.source), {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        'author-name': manifest.author?.name ?? '',
        'author-email': manifest.author?.email ?? '',
        homepage: manifest.homepage ?? '',
        repository: manifest.repository ?? '',
      });
      contentByRelativePath.set(recipe.manifest.destination, Buffer.from(rendered));
    }

    // 2. Instructions
    if (recipe.instructions) {
      for (const instr of recipe.instructions) {
        const rendered = await loadTemplate(join(root, instr.template), {
          header: instr.header,
          'command-mapping': instr.commandMapping,
          version: manifest.version,
          workflowCommand: instr.workflowCommand ?? '',
        });
        contentByRelativePath.set(instr.destination, Buffer.from(rendered));
      }
    }

    // 3. Skills
    if (recipe.skills) {
      for (const [skillRelPath, buffer] of skillContent) {
        if (!recipe.skills.includeOpenAiYaml && skillRelPath.endsWith('.yaml')) {
          continue;
        }
        const fullRelPath = `${recipe.skills.prefix}/${skillRelPath}`;
        contentByRelativePath.set(fullRelPath, buffer);
      }
    }

    // 4. Prompts (Copilot)
    if (recipe.prompts) {
      for (const { source, destination } of recipe.prompts.items) {
        const stage = destination.slice('smith-'.length, -'.prompt.md'.length);
        const step = WORKFLOW_STEPS.find(({ id }) => id === stage);
        const sourcePath = join(root, recipe.prompts.sourceDir, source);
        const { content } = await buildPromptContent(sourcePath, {
          stage,
          workflowCommand: recipe.prompts.workflowCommand,
          step,
        });
        const fullRelPath = `${recipe.prompts.destinationDir}/${destination}`;
        contentByRelativePath.set(fullRelPath, content);
      }
    }

    const parent = dirname(agentDir);
    await mkdir(parent, { recursive: true });
    const temporary = join(parent, `.${recipe.targetDir}.${randomUUID()}.tmp`);
    try {
      await mkdir(temporary, { mode: 0o755 });
      for (const [relPath, buffer] of contentByRelativePath) {
        const filePath = join(temporary, relPath);
        await mkdir(dirname(filePath), { recursive: true, mode: 0o755 });
        await writeFile(filePath, buffer, { flag: 'wx', mode: 0o644 });
      }
      await rm(agentDir, { recursive: true, force: true });
      await rename(temporary, agentDir);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }

    const files = [...contentByRelativePath.keys()].sort();
    results[agentName] = { output: agentDir, files };
  }

  return { status: 'built', agents: results };
}

export async function buildPackage({
  repositoryRoot = fileURLToPath(new URL('.', import.meta.url)),
  output,
} = {}) {
  const requestedRoot = resolve(repositoryRoot);
  const rootInfo = await lstat(requestedRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error(`Repository root must be a real directory: ${requestedRoot}`);
  }
  const root = await realpath(requestedRoot);
  const defaultOutput = join(root, 'dist', 'smith-plugin');
  const destination = await resolveOutput(root, output ?? defaultOutput);
  await assertDefaultOutputParentsAreSafe(root, destination);
  const manifest = await readAndValidateManifest(root);
  const files = [];
  const contentByDestination = new Map([
    ['plugin.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
  ]);

  const packageFiles = [
    'README.md',
    'resources/instructions/initial-project.md',
    'resources/prompt-history.json',
    'resources/legacy-hashes.txt',
    ...await discoverSourceFiles(root),
    ...await discoverTemplates(root),
    ...await discoverPrompts(root),
  ];
  for (const sourceRelativePath of packageFiles) {
    const content = await readPackageFile(root, sourceRelativePath, 'Package file');
    const destinationRelativePath = sourceRelativePath
      .replace(/^src\//, '')
      .replace(/^resources\/instructions\//, 'instructions/')
      .replace(/^resources\/templates\//, 'templates/')
      .replace(/^resources\/prompts\//, 'workflows/prompts/')
      .replace(/^resources\/prompt-history\.json$/, 'prompt-history.json')
      .replace(/^resources\/legacy-hashes\.txt$/, 'installer/legacy-hashes.txt');
    contentByDestination.set(destinationRelativePath, content);
  }
  files.push(...contentByDestination.keys());
  files.sort();
  const replaceableFiles = destination === defaultOutput ? files : undefined;
  await inspectOutput(destination, replaceableFiles);

  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporary = join(parent, `.${destination.split(sep).at(-1)}.${randomUUID()}.tmp`);
  try {
    await mkdir(temporary, { mode: 0o755 });
    for (const [relativePath, content] of contentByDestination) {
      const filePath = join(temporary, relativePath);
      const directory = dirname(filePath);
      if (directory !== temporary) {
        await mkdir(directory, { recursive: true, mode: 0o755 });
      }
      await writeFile(filePath, content, { flag: 'wx', mode: 0o644 });
    }
    await assertDefaultOutputParentsAreSafe(root, destination);
    if (await inspectOutput(destination, replaceableFiles)) {
      await rm(destination, { recursive: true });
    }
    await rename(temporary, destination);
  } catch (error) {
    try {
      await rm(temporary, { recursive: true, force: true });
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw cleanupError;
      }
    }
    throw error;
  }

  const agentResults = await buildAgentArtifacts({ repositoryRoot: root, distRoot: join(destination, 'agents') });
  for (const [agentName, { files: agentFiles }] of Object.entries(agentResults.agents)) {
    for (const f of agentFiles) {
      files.push(`agents/${agentName}/${f}`);
    }
  }
  files.sort();

  return { status: 'built', output: destination, files };
}

export async function buildAgentPackages({
  repositoryRoot = fileURLToPath(new URL('.', import.meta.url)),
  output,
} = {}) {
  return buildAgentArtifacts({ repositoryRoot, distRoot: output ? dirname(output) : undefined });
}

function parseArguments(args) {
  let output;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--output' || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`Invalid or incomplete option: ${args[index]}`);
    }
    if (output !== undefined) {
      throw new Error('--output can only be provided once');
    }
    output = args[index + 1];
    index += 1;
  }
  return { output };
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    stdout.write(
      'Usage: node build.mjs [--output DIR]\n' +
      'Builds from the current checkout and replaces the generated package at dist/smith-plugin.\n' +
      'Custom destinations must not exist; the default destination is fully replaced on each build.\n',
    );
    return;
  }
  const result = await buildPackage(parseArguments(process.argv.slice(2)));
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
