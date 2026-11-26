import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { access, constants, lstat, mkdir, open, readFile, rename, rm, link } from 'node:fs/promises';
import { homedir } from 'node:os';
import { stdin, stdout, stderr } from 'node:process';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { isDeepStrictEqual } from 'node:util';
import { MULTI_CLI_VERSION, GITHUB_MCP_READONLY_URL } from '../config/env.mjs';
import { InstallStatus } from '../domain/status.mjs';
import { ConfigError } from '../domain/errors.mjs';

const GITHUB_READONLY_URL = GITHUB_MCP_READONLY_URL;
const MULTI_CLI_TOOLS = [
  'Ask-Antigravity',
  'Antigravity-Help',
  'Fetch-Antigravity-Chunk',
  'List-Antigravity-Models',
  'Ask-Claude',
  'Claude-Help',
  'List-Claude-Models',
];
const CLIENTS = new Set(['copilot-cli', 'vscode', 'jetbrains']);

function assertClient(client) {
  if (!CLIENTS.has(client)) {
    throw new ConfigError('INVALID_MCP_CONFIG', `Unsupported MCP client: ${client}`);
  }
}

export function getMcpConfigPath({
  client,
  workspaceRoot,
  homeDir = homedir(),
  configPath,
  platform = process.platform,
} = {}) {
  assertClient(client);
  if (configPath !== undefined) {
    if (typeof configPath !== 'string' || configPath.length === 0) {
      throw new TypeError('configPath must be a non-empty path');
    }
    return resolve(configPath);
  }
  if (client === 'jetbrains') {
    if (platform === 'win32') {
      throw new ConfigError(
        'INVALID_MCP_CONFIG',
        'JetBrains MCP config path is not verified on Windows; provide an explicit configPath',
      );
    }
    return join(homeDir, '.config', 'github-copilot', 'intellij', 'mcp.json');
  }
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new TypeError('workspaceRoot is required for project-level MCP configuration');
  }
  return join(resolve(workspaceRoot), '.mcp.json');
}

function serverDefinitions({ client, includeMultiCli }) {
  const servers = {};
  const warnings = [];
  if (client === 'vscode' || client === 'jetbrains') {
    servers['github-readonly'] =
      client === 'jetbrains'
        ? { url: GITHUB_READONLY_URL }
        : { type: 'http', url: GITHUB_READONLY_URL };
  }
  if (includeMultiCli && client !== 'jetbrains') {
    servers['smith-multi-cli'] = {
      type: 'stdio',
      command: 'npx',
      args: ['--yes', `@osanoai/multicli@${MULTI_CLI_VERSION}`],
      tools: MULTI_CLI_TOOLS,
    };
  } else if (includeMultiCli) {
    warnings.push(
      'Multi-CLI was not added because JetBrains MCP configuration has no verified tool allowlist; only Claude and Antigravity may be exposed.',
    );
  }
  if (client === 'copilot-cli') {
    warnings.push('GitHub MCP is built into Copilot CLI and was not duplicated in project configuration.');
  }
  if (client === 'vscode') {
    warnings.push(
      'The workspace .mcp.json is also read by Copilot CLI; its read-only GitHub entry may be redundant with the built-in server there.',
    );
  }
  if (includeMultiCli && client !== 'jetbrains') {
    warnings.push(
      `Starting Multi-CLI may download @osanoai/multicli@${MULTI_CLI_VERSION}; no download or MCP server process was started by configuration.`,
    );
  }
  return { servers, warnings };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function isExecutableAvailable(command, pathValue, platform) {
  const suffixes = platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.com'] : [''];
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const suffix of suffixes) {
      try {
        await access(
          join(directory, `${command}${suffix}`),
          platform === 'win32' ? constants.F_OK : constants.X_OK,
        );
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

async function multiCliDependencyChecks(pathValue, platform) {
  return Promise.all(
    [
      [
        'multicli-runtime',
        'npx',
        'npx is required; the pinned MCP package downloads only when started',
      ],
      ['claude-cli', 'claude', 'Claude Code CLI is available; authentication was not verified'],
      ['antigravity-cli', 'agy', 'Antigravity CLI is available; sign-in was not verified'],
    ].map(async ([id, command, presentMessage]) => {
      const available = await isExecutableAvailable(command, pathValue, platform);
      return {
        id,
        ok: available,
        required: false,
        message: available ? presentMessage : `${command} is not available on PATH`,
      };
    }),
  );
}

async function readExistingConfig(configPath) {
  let info;
  try {
    info = await lstat(configPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { config: {}, info: undefined, raw: undefined };
    }
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new ConfigError('INVALID_MCP_CONFIG', `Refusing symlink MCP configuration: ${configPath}`);
  }
  if (!info.isFile()) {
    throw new ConfigError('INVALID_MCP_CONFIG', `Refusing MCP configuration that is not a regular file: ${configPath}`);
  }
  const raw = await readFile(configPath, 'utf8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError('INVALID_MCP_CONFIG', `MCP configuration is not valid JSON: ${configPath}`, { cause: error });
  }
  if (!isObject(config)) {
    throw new ConfigError('INVALID_MCP_CONFIG', `MCP configuration must contain a JSON object: ${configPath}`);
  }
  if (config.mcpServers !== undefined && !isObject(config.mcpServers)) {
    throw new ConfigError('INVALID_MCP_CONFIG', `mcpServers must be a JSON object: ${configPath}`);
  }
  return { config, info, raw };
}

function mergeServers(config, requestedServers) {
  const mcpServers = { ...(config.mcpServers ?? {}) };
  const additions = {};
  for (const [name, definition] of Object.entries(requestedServers)) {
    const existing = mcpServers[name];
    if (existing === undefined) {
      additions[name] = definition;
      continue;
    }
    if (!isDeepStrictEqual(existing, definition)) {
      throw new ConfigError('INVALID_MCP_CONFIG', `MCP server name collision for "${name}"; refusing to replace the existing entry`);
    }
  }
  return {
    config: Object.keys(additions).length
      ? { ...config, mcpServers: { ...mcpServers, ...additions } }
      : config,
    additions,
  };
}

async function writeConfigAtomically(configPath, contents, previous) {
  const parent = dirname(configPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  let latest;
  try {
    latest = await lstat(configPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (previous.info) {
    if (
      !latest ||
      latest.isSymbolicLink() ||
      latest.dev !== previous.info.dev ||
      latest.ino !== previous.info.ino ||
      latest.mtimeMs !== previous.info.mtimeMs ||
      latest.size !== previous.info.size ||
      (await readFile(configPath, 'utf8')) !== previous.raw
    ) {
      throw new ConfigError('MISSING_PLAN_APPROVAL', `MCP configuration changed while awaiting confirmation: ${configPath}`);
    }
  } else if (latest) {
    throw new ConfigError('MISSING_PLAN_APPROVAL', `MCP configuration appeared while awaiting confirmation: ${configPath}`);
  }

  const temporary = join(parent, `.mcp-${randomUUID()}.tmp`);
  const mode = previous.info ? previous.info.mode & 0o777 : 0o600;
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (previous.info) {
      await rename(temporary, configPath);
    } else {
      await link(temporary, configPath);
      await rm(temporary);
    }
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    try {
      await rm(temporary, { force: true });
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw cleanupError;
      }
    }
    throw error;
  }
}

export async function previewMcpConfiguration({
  client,
  workspaceRoot,
  homeDir = homedir(),
  configPath,
  includeMultiCli = false,
  platform = process.platform,
} = {}) {
  assertClient(client);
  const resolvedConfigPath = getMcpConfigPath({ client, workspaceRoot, homeDir, configPath, platform });
  const { servers, warnings } = serverDefinitions({ client, includeMultiCli });
  if (Object.keys(servers).length === 0) {
    return {
      status: InstallStatus.NOT_NEEDED,
      client,
      configPath: resolvedConfigPath,
      servers,
      warnings,
    };
  }

  const existing = await readExistingConfig(resolvedConfigPath);
  const { additions } = mergeServers(existing.config, servers);
  const snapshotHash = createHash('sha256')
    .update(existing.raw ?? '<missing-mcp-config>')
    .digest('hex');
  const preview = Object.keys(additions).length
    ? JSON.stringify(
        { configPath: resolvedConfigPath, servers: additions, warnings },
        null,
        2,
      )
    : undefined;
  return {
    status: Object.keys(additions).length ? InstallStatus.PLANNED : InstallStatus.UNCHANGED,
    client,
    configPath: resolvedConfigPath,
    servers,
    warnings,
    additions,
    snapshotHash,
    changes: Object.keys(additions).length > 0,
    preview,
  };
}

export async function configureMcp({
  client,
  workspaceRoot,
  homeDir = homedir(),
  configPath,
  includeMultiCli = false,
  dryRun = false,
  confirmChanges,
  approvedPlan,
  platform = process.platform,
} = {}) {
  const resolvedConfigPath = getMcpConfigPath({ client, workspaceRoot, homeDir, configPath, platform });
  const { servers } = serverDefinitions({ client, includeMultiCli });
  const plan = approvedPlan
    ? approvedPlan
    : await previewMcpConfiguration({
        client,
        workspaceRoot,
        homeDir,
        configPath,
        includeMultiCli,
        platform,
      });
  if (
    plan.client !== client ||
    plan.configPath !== resolvedConfigPath ||
    !isDeepStrictEqual(plan.servers, servers) ||
    (plan.status !== InstallStatus.NOT_NEEDED && typeof plan.snapshotHash !== 'string')
  ) {
    throw new ConfigError('MISSING_PLAN_APPROVAL', 'Approved MCP preview does not match the requested configuration');
  }
  if (dryRun || plan.status === InstallStatus.UNCHANGED || plan.status === InstallStatus.NOT_NEEDED) {
    return plan;
  }
  if (!approvedPlan && typeof confirmChanges !== 'function') {
    throw new ConfigError('MISSING_PLAN_APPROVAL', 'MCP configuration changes require explicit confirmation; no changes were made');
  }
  if (!approvedPlan && !(await confirmChanges(plan))) {
    throw new ConfigError('MISSING_PLAN_APPROVAL', 'MCP configuration was not authorized; no changes were made');
  }

  const existing = await readExistingConfig(plan.configPath);
  const currentSnapshotHash = createHash('sha256')
    .update(existing.raw ?? '<missing-mcp-config>')
    .digest('hex');
  if (currentSnapshotHash !== plan.snapshotHash) {
    throw new ConfigError('MISSING_PLAN_APPROVAL', `MCP configuration changed after preview; no changes were made: ${plan.configPath}`);
  }
  const { config, additions } = mergeServers(existing.config, plan.servers);
  if (!isDeepStrictEqual(additions, plan.additions)) {
    throw new ConfigError('MISSING_PLAN_APPROVAL', `MCP configuration additions changed after preview; no changes were made: ${plan.configPath}`);
  }
  if (Object.keys(additions).length === 0) {
    return { ...plan, status: InstallStatus.UNCHANGED, changes: false };
  }
  await writeConfigAtomically(plan.configPath, `${JSON.stringify(config, null, 2)}\n`, existing);
  return {
    ...plan,
    status: InstallStatus.CONFIGURED,
    changes: true,
    preview: undefined,
  };
}

export async function diagnoseMcpConfiguration({
  client,
  workspaceRoot,
  homeDir = homedir(),
  configPath,
  pathValue = process.env.PATH ?? '',
  platform = process.platform,
} = {}) {
  assertClient(client);
  const resolvedConfigPath = getMcpConfigPath({ client, workspaceRoot, homeDir, configPath, platform });
  if (client === 'copilot-cli') {
    let mcpServers = {};
    try {
      const existing = await readExistingConfig(resolvedConfigPath);
      mcpServers = existing.config.mcpServers ?? {};
    } catch (error) {
      return {
        ok: false,
        client,
        configPath: resolvedConfigPath,
        checks: [
          { id: 'github-mcp', ok: true, required: true, message: 'GitHub MCP is built into Copilot CLI' },
          { id: 'multicli', ok: false, required: false, message: error.message },
        ],
      };
    }
    const multiCli = mcpServers['smith-multi-cli'];
    const multiCliValid =
      multiCli === undefined ||
      isDeepStrictEqual(
        multiCli,
        serverDefinitions({ client, includeMultiCli: true }).servers['smith-multi-cli'],
      );
    const checks = [
      { id: 'github-mcp', ok: true, required: true, message: 'GitHub MCP is built into Copilot CLI' },
      {
        id: 'multicli',
        ok: multiCliValid,
        required: false,
        message: multiCli === undefined
          ? 'Multi-CLI is not configured; only Claude/Antigravity may be enabled as an opt-in'
          : multiCliValid
            ? 'Pinned Multi-CLI configuration and tool allowlist are present; client authentication is not verified'
            : 'Multi-CLI config does not match the pinned version and authorized tool allowlist',
      },
      ...(multiCli === undefined || !multiCliValid
        ? []
        : await multiCliDependencyChecks(pathValue, platform)),
    ];
    return {
      ok: checks.every(({ ok }) => ok),
      client,
      configPath: resolvedConfigPath,
      checks,
    };
  }

  let mcpServers = {};
  let readError;
  try {
    const existing = await readExistingConfig(resolvedConfigPath);
    mcpServers = existing.config.mcpServers ?? {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      readError = error.message;
    }
  }
  const github = mcpServers['github-readonly'];
  const expectedGithub =
    client === 'jetbrains'
      ? { url: GITHUB_READONLY_URL }
      : { type: 'http', url: GITHUB_READONLY_URL };
  const githubConfigured = isDeepStrictEqual(github, expectedGithub);
  const multiCli = mcpServers['smith-multi-cli'];
  const multiCliExpected =
    client === 'vscode'
      ? serverDefinitions({ client, includeMultiCli: true }).servers['smith-multi-cli']
      : undefined;
  const multiCliValid =
    multiCli === undefined ||
    (multiCliExpected !== undefined && isDeepStrictEqual(multiCli, multiCliExpected));
  const checks = [
    {
      id: 'github-mcp',
      ok: githubConfigured,
      required: true,
      message: readError
        ? `GitHub MCP configuration could not be read: ${readError}`
        : githubConfigured
          ? 'Read-only GitHub MCP endpoint is configured; sign-in and connection must be verified in the client'
          : 'Read-only GitHub MCP is not configured; client-supported authentication remains pending',
    },
    {
      id: 'multicli',
      ok: multiCliValid,
      required: false,
      message:
        multiCli === undefined
          ? client === 'jetbrains'
            ? 'Multi-CLI is intentionally disabled because JetBrains tool filtering was not verified'
            : 'Multi-CLI is optional and is not configured'
          : multiCliValid
            ? 'Pinned Multi-CLI and Claude/Antigravity allowlist are configured; agent authentication is not verified'
            : 'Multi-CLI config does not match the pinned version and authorized tool allowlist',
    },
    ...(multiCli === undefined || !multiCliValid
      ? []
      : await multiCliDependencyChecks(pathValue, platform)),
  ];
  return {
    ok: checks.every(({ ok }) => ok),
    client,
    configPath: resolvedConfigPath,
    checks,
  };
}

async function askForConfirmation(plan) {
  if (!stdin.isTTY) {
    throw new ConfigError('MISSING_PLAN_APPROVAL', 'MCP configuration requires an interactive terminal; no changes were made');
  }
  stdout.write(`MCP configuration preview:\n${plan.preview ?? JSON.stringify(plan.servers, null, 2)}\n`);
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(
      'This writes MCP configuration; Multi-CLI can download its pinned package when started. Type CONFIGURE to continue: ',
    );
    return answer.trim() === 'CONFIGURE';
  } finally {
    terminal.close();
  }
}

function parseArguments(args) {
  const options = { dryRun: false, includeMultiCli: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--include-multicli') {
      options.includeMultiCli = true;
      continue;
    }
    const key =
      argument === '--client'
        ? 'client'
        : argument === '--workspace'
          ? 'workspaceRoot'
          : argument === '--config'
            ? 'configPath'
            : null;
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new ConfigError('INVALID_MCP_CONFIG', `Invalid or incomplete option: ${argument}`);
    }
    if (options[key] !== undefined) {
      throw new ConfigError('INVALID_MCP_CONFIG', `${argument} can only be provided once`);
    }
    options[key] = args[index + 1];
    index += 1;
  }
  if (!options.client) {
    throw new ConfigError('INVALID_MCP_CONFIG', 'Usage: node plugin/mcp/configure.mjs --client copilot-cli|vscode|jetbrains [--workspace DIR] [--config FILE] [--include-multicli] [--dry-run]');
  }
  if (options.client !== 'jetbrains' && options.workspaceRoot === undefined) {
    options.workspaceRoot = process.cwd();
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await configureMcp({
    ...options,
    confirmChanges: askForConfirmation,
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
