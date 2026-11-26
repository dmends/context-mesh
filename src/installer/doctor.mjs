import { execFile } from 'node:child_process';
import { access, lstat, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { stdout, stderr } from 'node:process';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';
import { validateSyncConfig } from '../utils/repository/sync/sync.mjs';
import { diagnoseMcpConfiguration } from '../mcp/configure.mjs';
import { isSharedClient, sharedDestination, workflowCommand } from './shared-runtime.mjs';
import { MIN_NODE_VERSION } from '../config/env.mjs';
import { InstallError } from '../domain/errors.mjs';

const execFileAsync = promisify(execFile);
const MIN_NODE_MAJOR = MIN_NODE_VERSION;
const SUPPORTED_CLIENTS = new Set(['copilot-cli', 'jetbrains', 'vscode']);
const JETBRAINS_PROMPTS = [
  'smith-discovery-consolidation.prompt.md',
  'smith-business-epic.prompt.md',
  'smith-as-is-knowledge.prompt.md',
  'smith-decision-record.prompt.md',
  'smith-validation-gate.prompt.md',
  'smith-tech-solution-specification.prompt.md',
  'smith-story-task-breakdown.prompt.md',
  'smith-technical-refinement.prompt.md',
];

function nodeMajor(version) {
  const match = /^v?(\d+)\./.exec(version);
  return match ? Number(match[1]) : NaN;
}

async function isExecutableAvailable(command, pathValue = process.env.PATH ?? '') {
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd'] : [''];
  for (const directory of pathValue.split(delimiter)) {
    for (const suffix of suffixes) {
      try {
        await access(join(directory, `${command}${suffix}`), constants.X_OK);
        return true;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
          throw error;
        }
      }
    }
  }
  return false;
}

async function inspectPlugin(pluginRoot, version) {
  try {
    const info = await lstat(pluginRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return { ok: false, pluginRoot, message: 'Plugin path is not a real directory' };
    }
    const manifest = JSON.parse(await readFile(join(pluginRoot, 'plugin.json'), 'utf8'));
    if (
      manifest.$schema !== 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' ||
      manifest.name !== 'smith' || (version !== undefined && manifest.version !== version)
    ) {
      return { ok: false, pluginRoot, message: 'Plugin manifest is missing or incompatible' };
    }
    return { ok: true, pluginRoot, message: 'Compatible plugin manifest is present' };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      return { ok: false, pluginRoot, message: 'Plugin package or manifest is missing' };
    }
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    const info = await lstat(filePath);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function listCopilotPlugins({ copilotAvailable, runCommand }) {
  if (!copilotAvailable) {
    return { ok: false, plugins: [], message: 'Copilot CLI unavailable; plugins were not checked' };
  }
  try {
    const { stdout: output } = await runCommand('copilot', ['plugin', 'list', '--json']);
    const result = JSON.parse(output);
    const plugins = Array.isArray(result) ? result : result.plugins;
    if (!Array.isArray(plugins)) {
      throw new InstallError('UNSUPPORTED_CLIENT', 'Copilot CLI returned an invalid plugin list');
    }
    return { ok: true, plugins, message: 'Copilot CLI plugin list is readable' };
  } catch (error) {
    return {
      ok: false,
      plugins: [],
      message: `Could not read the Copilot CLI plugin list: ${error.message}`,
    };
  }
}

function pluginMatchesPath(plugin, expectedPath, targetRoot) {
  return (
    typeof plugin?.source === 'string' &&
    resolve(targetRoot, plugin.source) === resolve(expectedPath)
  );
}

async function validateRepositoryConfig(configPath, baseDir) {
  try {
    const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
    validateSyncConfig(config, baseDir);
    return { ok: true, required: false, message: 'Repository catalog is valid' };
  } catch {
    return { ok: false, required: false, message: 'Repository catalog is missing, invalid, or unsafe' };
  }
}

export async function diagnoseProject({
  sharedRoot,
  targetRoot,
  client,
  nodeVersion = process.versions.node,
  copilotAvailable,
  gitAvailable,
  syncConfigPath,
  mcpConfigPath,
  mcpHomeDir,
  runCommand = (command, args) => execFileAsync(command, args),
} = {}) {
  if (typeof targetRoot !== 'string' || targetRoot.length === 0) {
    throw new TypeError('targetRoot is required');
  }
  const target = resolve(targetRoot);
  const checks = [];
  let targetIsValid = false;
  try {
    const info = await lstat(target);
    targetIsValid = info.isDirectory() && !info.isSymbolicLink();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  checks.push({
    id: 'target',
    ok: targetIsValid,
    required: true,
    message: targetIsValid ? 'Target workspace is available' : 'Target must be an existing real directory',
  });

  const clientSupported = SUPPORTED_CLIENTS.has(client);
  checks.push({
    id: 'client',
    ok: clientSupported,
    required: true,
    message: clientSupported
      ? `Package has an installation path for ${client}; runtime compatibility is not verified by this check`
      : `${client ?? 'Unknown client'} is not supported by this plugin package`,
  });

  const versionSupported = nodeMajor(nodeVersion) >= MIN_NODE_MAJOR;
  checks.push({
    id: 'node',
    ok: versionSupported,
    required: true,
    message: versionSupported
      ? `Node.js ${nodeVersion} satisfies the >=${MIN_NODE_MAJOR} requirement`
      : `Node.js >=${MIN_NODE_MAJOR} is required; found ${nodeVersion}`,
  });

  const shared = isSharedClient(client);
  let version;
  if (shared) {
    for (const rel of ['../plugin.json', '../../plugin.json']) {
      try {
        version = JSON.parse(await readFile(new URL(rel, import.meta.url), 'utf8')).version;
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (version === undefined) throw new InstallError('TARGET_NOT_FOUND', 'Plugin manifest not found');
  }
  const pluginRoot = shared ? sharedDestination(version, sharedRoot) : join(target, '.copilot', 'plugins', 'smith');
  const plugin = targetIsValid
    ? await inspectPlugin(pluginRoot, version)
    : { ok: false, pluginRoot, message: 'Target is unavailable' };
  checks.push({ id: 'plugin', ok: plugin.ok, required: true, message: plugin.message });
  const instructionsRequired = SUPPORTED_CLIENTS.has(client);
  const instructionsAvailable =
    targetIsValid &&
    (await fileExists(join(target, '.github', 'instructions', 'smith.instructions.md')));
  checks.push({
    id: 'instructions',
    ok: instructionsRequired ? instructionsAvailable : true,
    required: instructionsRequired,
    message:
      instructionsAvailable
        ? 'Supplemental Copilot instructions are installed'
        : 'Supplemental Copilot instructions are missing; install from a built plugin package',
  });
  let jetbrainsPromptsAvailable = false;
  let promptsMatchRuntime = false;
  if (shared) {
    jetbrainsPromptsAvailable =
      targetIsValid &&
      (
        await Promise.all(
          JETBRAINS_PROMPTS.map((prompt) =>
            fileExists(join(target, '.github', 'prompts', prompt)),
          ),
        )
      ).every(Boolean);
    if (jetbrainsPromptsAvailable) {
      const command = workflowCommand(version, sharedRoot);
      promptsMatchRuntime = (await Promise.all(JETBRAINS_PROMPTS.map(async (prompt) =>
        (await readFile(join(target, '.github', 'prompts', prompt), 'utf8')).includes(command),
      ))).every(Boolean);
    }
    checks.push({
      id: 'prompts',
      ok: promptsMatchRuntime,
      required: true,
      message: jetbrainsPromptsAvailable
        ? promptsMatchRuntime ? 'All seven Smith prompts reference the expected shared runtime'
          : `Project prompts do not reference the expected shared runtime at ${pluginRoot}`
        : 'One or more Smith project prompt files are missing',
    });
  }
  const gitPresent = gitAvailable ?? (await isExecutableAvailable('git'));
  checks.push({
    id: 'git',
    ok: gitPresent,
    required: true,
    message: gitPresent ? 'Git is available for repository synchronization' : 'Git was not found on PATH',
  });
  const repositorySyncAvailable =
    plugin.ok && (await fileExists(join(plugin.pluginRoot, 'utils', 'repository', 'sync', 'sync.mjs')));
  checks.push({
    id: 'repository-sync',
    ok: repositorySyncAvailable,
    required: true,
    message: repositorySyncAvailable
      ? 'Repository synchronizer is available'
      : 'Repository synchronizer is missing from the installed plugin',
  });
  checks.push(
    syncConfigPath
      ? { id: 'repository-config', ...(await validateRepositoryConfig(syncConfigPath, target)) }
      : {
          id: 'repository-config',
          ok: false,
          required: false,
          message: 'No repository catalog configured; pass --sync-config to validate one',
        },
  );
  const executorAvailable =
    plugin.ok &&
    (await fileExists(join(plugin.pluginRoot, 'core', 'engine.mjs'))) &&
    (await fileExists(join(plugin.pluginRoot, 'core', 'cli.mjs'))) &&
    (await fileExists(join(plugin.pluginRoot, 'workflows', 'project-lifecycle.mjs')));
  checks.push({
    id: 'executor',
    ok: executorAvailable,
    required: true,
    message: executorAvailable
      ? 'Dynamic Workflow executor and stage definition files are present; execution in the client is not verified'
      : 'Dynamic Workflow executor or stage definitions are missing',
  });
  const requiredTemplates = [...new Set(WORKFLOW_STEPS.flatMap(({ templates }) => templates))];
  const templatesAvailable =
    plugin.ok &&
    (await Promise.all(
      requiredTemplates.map((template) => fileExists(join(plugin.pluginRoot, template))),
    )).every(Boolean);
  checks.push({
    id: 'templates',
    ok: templatesAvailable,
    required: true,
    message: templatesAvailable ? 'Installed templates are available' : 'Installed templates are missing',
  });

  if (client === 'copilot-cli') {
    const hasCopilot = copilotAvailable ?? (await isExecutableAvailable('copilot'));
    checks.push({
      id: 'copilot-cli',
      ok: hasCopilot,
      required: true,
      message: hasCopilot ? 'Copilot CLI is available' : 'Copilot CLI was not found on PATH',
    });
    const pluginList = await listCopilotPlugins({ copilotAvailable: hasCopilot, runCommand });
    const namedPlugin = pluginList.plugins.find(({ name }) => name === 'smith');
    const registered =
      namedPlugin?.enabled === true &&
      pluginMatchesPath(namedPlugin, plugin.pluginRoot, target);
    const clientIntegrationAvailable = pluginList.ok && registered;
    checks.push({
      id: 'client-integration',
      ok: clientIntegrationAvailable,
      required: true,
      message: clientIntegrationAvailable
        ? 'smith is enabled in Copilot CLI from the installed package'
        : pluginList.ok
          ? namedPlugin
            ? 'smith is disabled or registered from another source; local activation is not verified'
            : 'smith is not registered; explicit activation changes Copilot CLI user configuration'
          : pluginList.message,
    });
    checks.push({
      id: 'superpowers',
      ok: pluginList.plugins.some(({ name, enabled }) => name === 'superpowers' && enabled === true),
      required: true,
      message: !hasCopilot
        ? 'Copilot CLI unavailable; Superpowers installation was not checked'
        : !pluginList.ok
          ? pluginList.message
          : pluginList.plugins.some(({ name, enabled }) => name === 'superpowers' && enabled === true)
            ? 'Superpowers is enabled in Copilot CLI'
            : 'Superpowers is not enabled; use the documented command only after authorizing installation',
    });
  } else if (shared) {
    checks.push({
      id: 'client-integration',
      ok: promptsMatchRuntime && instructionsAvailable && plugin.ok,
      required: true,
      message: promptsMatchRuntime
        ? instructionsAvailable
          ? plugin.ok ? 'Project Copilot prompts, automatic workflow instructions, and shared runtime are present; IDE chat execution is not verified'
            : 'Project Copilot prompts and automatic workflow instructions are present, but the shared runtime is missing or incompatible'
          : 'Project Copilot prompts are present, but automatic workflow instructions are missing'
        : 'Project Copilot prompts are missing or target a different runtime; check the prompts diagnostic',
    });
    checks.push({
      id: 'superpowers',
      ok: false,
      required: false,
      message: 'No Superpowers activation is configured for this client',
    });
  }

  if (['copilot-cli', 'vscode', 'jetbrains'].includes(client)) {
    const mcpDiagnosis = await diagnoseMcpConfiguration({
      client,
      workspaceRoot: target,
      homeDir: mcpHomeDir,
      configPath: mcpConfigPath,
    });
    checks.push({
      id: 'mcp-configuration',
      ok: mcpDiagnosis.ok,
      required: false,
      message: mcpDiagnosis.ok
        ? 'MCP configuration is present; server connection and authentication were not tested'
        : 'MCP configuration is incomplete; review the GitHub/Multi-CLI checks',
    });
    checks.push(...mcpDiagnosis.checks.map((check) => ({ ...check, required: false })));
  }

  return {
    ok: checks.filter(({ required }) => required).every(({ ok }) => ok),
    client,
    targetRoot: target,
    checks,
  };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const key =
      argument === '--target'
        ? 'targetRoot'
        : argument === '--client'
          ? 'client'
          : argument === '--sync-config'
            ? 'syncConfigPath'
            : argument === '--mcp-config'
              ? 'mcpConfigPath'
              : argument === '--shared-root' ? 'sharedRoot' : null;
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new InstallError('INVALID_CLI_OPTION', `Invalid or incomplete option: ${argument}`);
    }
    if (options[key] !== undefined) {
      throw new InstallError('INVALID_CLI_OPTION', `${argument} can only be provided once`);
    }
    options[key] = args[index + 1];
    index += 1;
  }
  if (!options.targetRoot || !options.client) {
    throw new InstallError(
      'INVALID_CLI_OPTION',
      'Usage: node plugin/installer/doctor.mjs --target DIR --client copilot-cli|vscode|jetbrains [--shared-root DIR] [--sync-config FILE] [--mcp-config FILE]',
    );
  }
  return options;
}

async function main() {
  const diagnosis = await diagnoseProject(parseArguments(process.argv.slice(2)));
  stdout.write(`${JSON.stringify(diagnosis, null, 2)}\n`);
  if (!diagnosis.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
