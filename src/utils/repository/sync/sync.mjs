import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { stdout, stderr } from 'node:process';
import { SyncStatus } from '../../../domain/status.mjs';
import { SyncError } from '../../../domain/errors.mjs';

const execFileAsync = promisify(execFile);
const USAGE = `Usage: node plugin/utils/repository/sync/sync.mjs --config FILE --base-dir DIR [--dry-run]

Config JSON:
{
  "baseUrl": "https://github.com/example/",
  "defaultBranch": "main",
  "projects": [
    { "folder": "example-project", "gitPath": "project.git", "name": "Project" }
  ]
}

Each project may override defaultBranch with branch and request a local branch on clone with localBranch.`;

class GitExecutionError extends Error {}

function isWithin(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

function validateBranch(branch, label) {
  if (
    typeof branch !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.includes('@{')
  ) {
    throw new SyncError('INVALID_CONFIG', `${label} must be a valid Git branch name`);
  }
}

function validateRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment === '..' || segment === '.' || segment.length === 0)
  ) {
    throw new SyncError('INVALID_CONFIG', `${label} must be a non-empty relative path without traversal segments`);
  }
  return value.split('/');
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SyncError('INVALID_CONFIG', 'Configuration must define baseUrl');
  }
  let url;
  try {
    url = new URL(value.endsWith('/') ? value : `${value}/`);
  } catch (error) {
    throw new SyncError('INVALID_CONFIG', 'baseUrl must be an absolute URL', { cause: error });
  }
  if (!['file:', 'http:', 'https:', 'ssh:'].includes(url.protocol)) {
    throw new SyncError('INVALID_CONFIG', 'baseUrl must use file, http, https, or ssh');
  }
  const usernameIsSshIdentity = url.protocol === 'ssh:' && url.username === 'git' && !url.password;
  if ((url.username && !usernameIsSshIdentity) || url.password || url.search || url.hash) {
    throw new SyncError('INVALID_CONFIG', 'baseUrl must not contain credentials, query parameters, or fragments');
  }
  return url;
}

export function validateSyncConfig(config, baseDir) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new SyncError('INVALID_CONFIG', 'Configuration must be a JSON object');
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    throw new SyncError('INVALID_CONFIG', 'Configuration must contain a non-empty projects array');
  }
  if (config.defaultBranch !== undefined) {
    validateBranch(config.defaultBranch, 'defaultBranch');
  }

  const base = resolve(baseDir);
  const destinations = new Set();
  const projects = config.projects.map((project, index) => {
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      throw new SyncError('INVALID_CONFIG', `projects[${index}] must be an object`);
    }
    if (typeof project.name !== 'string' || project.name.trim().length === 0) {
      throw new SyncError('INVALID_CONFIG', `projects[${index}].name is required`);
    }
    const folderSegments = validateRelativePath(project.folder, `projects[${index}].folder`);
    const gitPathSegments = validateRelativePath(project.gitPath, `projects[${index}].gitPath`);
    const branch = project.branch ?? config.defaultBranch;
    validateBranch(branch, `projects[${index}].branch or defaultBranch`);
    if (project.localBranch !== undefined) {
      validateBranch(project.localBranch, `projects[${index}].localBranch`);
    }

    const remoteUrl = new URL(gitPathSegments.join('/'), baseUrl);
    if (
      remoteUrl.origin !== baseUrl.origin ||
      !remoteUrl.pathname.startsWith(baseUrl.pathname) ||
      remoteUrl.search ||
      remoteUrl.hash
    ) {
      throw new SyncError('INVALID_CONFIG', `projects[${index}].gitPath must stay inside baseUrl`);
    }

    const destination = resolve(base, ...folderSegments);
    if (!isWithin(base, destination) || destination === base) {
      throw new SyncError('INVALID_CONFIG', `projects[${index}].folder escapes baseDir`);
    }
    const destinationKey = process.platform === 'win32' ? destination.toLowerCase() : destination;
    if (destinations.has(destinationKey)) {
      throw new SyncError('INVALID_CONFIG', `Multiple projects resolve to the same destination: ${project.folder}`);
    }
    destinations.add(destinationKey);

    return {
      name: project.name,
      folder: project.folder,
      destination,
      remoteUrl: remoteUrl.href,
      branch,
      localBranch: project.localBranch,
    };
  });

  return { baseUrl: baseUrl.href, projects };
}

async function assertRealDirectory(directory, label) {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SyncError('INVALID_CONFIG', `${label} does not exist: ${directory}`, { cause: error });
    }
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new SyncError('INVALID_CONFIG', `${label} must be a real directory, not a symlink or file`);
  }
}

async function assertNoSymlinkPath(baseDir, destination) {
  const relativePath = relative(baseDir, destination);
  const segments = relativePath.split(sep);
  let current = baseDir;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new SyncError('CLONE_FAILED', `Refusing symlink in repository destination: ${current}`);
      }
      if (index < segments.length - 1 && !info.isDirectory()) {
        throw new SyncError('CLONE_FAILED', `Repository destination component is not a directory: ${current}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
}

function commandFailure(error, action) {
  if (error.code === 'ENOENT') {
    return 'Git executable not found';
  }
  const output = `${error.stderr ?? ''}\n${error.message ?? ''}`;
  if (/authentication|permission denied|could not read username|access denied/i.test(output)) {
    return `Git ${action} failed because authentication or remote access was denied`;
  }
  if (/repository .* not found|not found.*repository/i.test(output)) {
    return `Git ${action} failed because the remote repository was not found or accessible`;
  }
  const code = typeof error.code === 'number' ? ` (exit ${error.code})` : '';
  return `Git ${action} failed${code}`;
}

async function runGit(runCommand, args, options = {}) {
  try {
    return await runCommand('git', args, options);
  } catch (error) {
    throw new GitExecutionError(commandFailure(error, args[0]), { cause: error });
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function outputOf(result) {
  return String(result?.stdout ?? '').trim();
}

function drawProgressBar(percent, width = 15) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const filled = Math.floor((width * clampedPercent) / 100);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
  return `[${bar}] ${String(clampedPercent).padStart(3, ' ')}%`;
}

function progressLine(current, total, details) {
  const percent = total > 0 ? Math.floor((current * 100) / total) : 0;
  return `\r\u001b[Ksync   ❯❯ ${drawProgressBar(percent)} (${current}/${total}) ${details}`;
}

function emitProgress(onProgress, current, total, details) {
  onProgress(progressLine(current, total, details));
}

function progressDetails(result) {
  if (result.status === SyncStatus.PLANNED) {
    return `⚠ [planned: ${result.action}] ${result.name}`;
  }
  if (result.status === SyncStatus.FAILED) {
    return `✗ ${result.name}`;
  }
  if (result.status === SyncStatus.SKIPPED) {
    return `⚠ ${result.name}`;
  }
  if (result.status === SyncStatus.CLONED) {
    return `✓ [clone] ${result.name}`;
  }
  if (result.status === SyncStatus.UPDATED) {
    return `✓ [update] ${result.name}`;
  }
  return `✓ [unchanged] ${result.name}`;
}

async function ensureNoOperationInProgress(runCommand, destination) {
  const result = await runGit(runCommand, ['rev-parse', '--git-dir'], { cwd: destination });
  const gitDirectory = resolve(destination, outputOf(result));
  const markers = [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_LOG',
    'rebase-merge',
    'rebase-apply',
  ];
  for (const marker of markers) {
    if (await pathExists(join(gitDirectory, marker))) {
      throw new SyncError('LOCAL_CHANGES', `Git operation in progress (${marker}); resolve it manually before syncing`);
    }
  }
}

async function cloneProject(project, baseDir, runCommand) {
  await assertNoSymlinkPath(baseDir, project.destination);
  await mkdir(dirname(project.destination), { recursive: true });
  await assertNoSymlinkPath(baseDir, project.destination);
  try {
    await runGit(
      runCommand,
      ['clone', '--branch', project.branch, '--single-branch', project.remoteUrl, project.destination],
    );
  } catch (error) {
    if (await pathExists(project.destination)) {
      throw new GitExecutionError(
        `${error.message}; clone may have left a partial directory at ${project.destination}`,
        { cause: error },
      );
    }
    throw error;
  }
  if (project.localBranch && project.localBranch !== project.branch) {
    try {
      await runGit(runCommand, ['switch', '--create', project.localBranch], {
        cwd: project.destination,
      });
    } catch (error) {
      throw new GitExecutionError(
        `Repository was cloned at ${project.destination}, but local branch ${project.localBranch} was not created: ${error.message}`,
        { cause: error },
      );
    }
  }
  return {
    name: project.name,
    folder: project.folder,
    status: SyncStatus.CLONED,
    message: project.localBranch
      ? `Cloned ${project.branch} and created local branch ${project.localBranch}`
      : `Cloned branch ${project.branch}`,
  };
}

function normalizeRemote(value) {
  try {
    return new URL(value).href;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

async function updateProject(project, runCommand) {
  let inside;
  try {
    inside = outputOf(
      await runGit(runCommand, ['rev-parse', '--is-inside-work-tree'], { cwd: project.destination }),
    );
  } catch (error) {
    if (
      error.message === 'Git executable not found' ||
      !/not a git repository/i.test(error.cause?.stderr ?? '')
    ) {
      throw error;
    }
    throw new SyncError('CLONE_FAILED', 'Destination is not a Git repository', { cause: error });
  }
  if (inside !== 'true') {
    throw new SyncError('CLONE_FAILED', 'Destination is not a Git repository');
  }
  const repositoryRoot = outputOf(
    await runGit(runCommand, ['rev-parse', '--show-toplevel'], { cwd: project.destination }),
  );
  const [canonicalRepositoryRoot, canonicalDestination] = await Promise.all([
    realpath(repositoryRoot),
    realpath(project.destination),
  ]);
  if (canonicalRepositoryRoot !== canonicalDestination) {
    throw new SyncError('CLONE_FAILED', 'Destination is inside another Git repository, not its repository root');
  }
  await ensureNoOperationInProgress(runCommand, project.destination);

  const currentBranch = outputOf(
    await runGit(runCommand, ['branch', '--show-current'], { cwd: project.destination }),
  );
  const expectedLocalBranch = project.localBranch ?? project.branch;
  if (currentBranch !== expectedLocalBranch) {
    throw new SyncError(
      'LOCAL_CHANGES',
      `Current branch is "${currentBranch || 'detached HEAD'}", not configured branch "${expectedLocalBranch}"; no branch was changed`,
    );
  }

  const status = outputOf(
    await runGit(
      runCommand,
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd: project.destination },
    ),
  );
  if (status.length > 0) {
    throw new SyncError('LOCAL_CHANGES', 'Repository has local changes; they were preserved and no update was attempted');
  }

  let origin;
  try {
    origin = outputOf(
      await runGit(runCommand, ['remote', 'get-url', 'origin'], { cwd: project.destination }),
    );
  } catch (error) {
    if (/No such remote|no remote/i.test(error.cause?.stderr ?? '')) {
      throw new SyncError('CLONE_FAILED', 'Repository has no origin remote; no remote was added');
    }
    throw error;
  }
  if (normalizeRemote(origin) !== normalizeRemote(project.remoteUrl)) {
    throw new SyncError('CLONE_FAILED', 'Configured origin differs from the requested remote; no remote was changed');
  }

  const remoteRef = `refs/smith-sync/${randomUUID()}`;
  try {
    await runGit(
      runCommand,
      [
        'fetch',
        '--no-tags',
        'origin',
        `+refs/heads/${project.branch}:${remoteRef}`,
      ],
      { cwd: project.destination },
    );
    const remoteCommit = outputOf(
      await runGit(runCommand, ['rev-parse', `${remoteRef}^{commit}`], {
        cwd: project.destination,
      }),
    );
    const counts = outputOf(
      await runGit(
        runCommand,
        ['rev-list', '--left-right', '--count', `HEAD...${remoteCommit}`],
        { cwd: project.destination },
      ),
    ).split(/\s+/);
    if (counts.length !== 2 || counts.some((count) => !/^\d+$/.test(count))) {
      throw new SyncError('MERGE_FAILED', 'Git returned an invalid ahead/behind comparison');
    }
    const [ahead, behind] = counts.map(Number);

    if (ahead > 0 && behind > 0) {
      throw new SyncError('DIVERGED', 'Local and remote histories have diverged; no merge or rebase was attempted');
    }
    if (ahead > 0) {
      throw new SyncError('AHEAD', 'Repository contains local commits; they were preserved and no reset was attempted');
    }
    if (behind === 0) {
      return {
        name: project.name,
        folder: project.folder,
        status: SyncStatus.UNCHANGED,
        message: 'Local branch already matches the configured remote branch',
      };
    }

    try {
      await runGit(
        runCommand,
        ['merge', '--ff-only', '--no-overwrite-ignore', remoteCommit],
        { cwd: project.destination },
      );
    } catch (error) {
      if (/would be overwritten by merge|ignored/i.test(error.cause?.stderr ?? '')) {
        throw new SyncError(
          'MERGE_FAILED',
          'Fast-forward was blocked to preserve locally ignored files; no update was applied',
          { cause: error },
        );
      }
      throw error;
    }
    return {
      name: project.name,
      folder: project.folder,
      status: SyncStatus.UPDATED,
      message: `Fast-forwarded ${project.branch} by ${behind} commit(s)`,
    };
  } finally {
    await runGit(runCommand, ['update-ref', '-d', remoteRef], { cwd: project.destination });
  }
}

function summarize(projects) {
  const failed = projects.filter(({ status }) => status === SyncStatus.FAILED || status === SyncStatus.SKIPPED).length;
  return {
    ok: failed === 0,
    total: projects.length,
    failed,
    cloned: projects.filter(({ status }) => status === SyncStatus.CLONED).length,
    updated: projects.filter(({ status }) => status === SyncStatus.UPDATED).length,
    unchanged: projects.filter(({ status }) => status === SyncStatus.UNCHANGED).length,
    skipped: projects.filter(({ status }) => status === SyncStatus.SKIPPED).length,
    projects,
  };
}

function formatSummary(result, errorLogPath, errorLogFailure) {
  const projectFailures = result.projects.filter(({ status }) => status === SyncStatus.FAILED).length;
  const planned = result.projects.filter(({ status }) => status === SyncStatus.PLANNED).length;
  const lines = [
    '========================================',
    'Resumo da sincronização:',
    '========================================',
    `Total de projetos: ${result.total}`,
    `Clonados: ${result.cloned}`,
    `Atualizados: ${result.updated}`,
    `Sem alterações: ${result.unchanged}`,
  ];
  if (planned > 0) {
    lines.push(`Planejados: ${planned}`);
  }
  lines.push(
    `Falhas: ${projectFailures}`,
    `Ignorados: ${result.skipped}`,
    `Erros: ${result.failed}`,
  );
  if (errorLogPath) {
    lines.push(`Log de erros: ${errorLogPath}`);
  } else if (errorLogFailure) {
    lines.push(`Log de erros: não foi possível gravar (${errorLogFailure})`);
  }
  lines.push('========================================');
  return lines.join('\n');
}

function getErrorLogPath(configPath) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\.(\d{3})Z$/, '-$1Z');
  const configFile = resolve(configPath);
  const logName = `${basename(configFile, extname(configFile))}.errors.${timestamp}.log`;
  return join(dirname(configFile), logName);
}

async function writeErrorLog(configPath, result) {
  const errors = result.projects.filter(
    ({ status }) => status === SyncStatus.FAILED || status === SyncStatus.SKIPPED,
  );
  if (errors.length === 0) {
    return null;
  }
  const content = errors
    .map(({ status, name, folder, message }) => `[${status}] ${name} (${folder})\n  ${message}`)
    .join('\n\n');
  const initialPath = getErrorLogPath(configPath);
  let suffix = 0;
  while (true) {
    const logPath =
      suffix === 0 ? initialPath : initialPath.replace(/\.log$/, `-${suffix}.log`);
    try {
      await writeFile(logPath, `${content}\n`, { encoding: 'utf8', flag: 'wx' });
      return logPath;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      suffix += 1;
    }
  }
}

export async function syncRepositories({
  configPath,
  baseDir,
  dryRun = false,
  onProgress = () => {},
  runCommand = (command, args, options) => execFileAsync(command, args, options),
} = {}) {
  if (typeof configPath !== 'string' || configPath.length === 0) {
    throw new TypeError('configPath is required');
  }
  if (typeof baseDir !== 'string' || baseDir.length === 0) {
    throw new TypeError('baseDir is required');
  }
  const base = resolve(baseDir);
  await assertRealDirectory(base, 'baseDir');

  let rawConfig;
  try {
    rawConfig = JSON.parse(await readFile(resolve(configPath), 'utf8'));
  } catch (error) {
    throw new SyncError('INVALID_CONFIG', `Cannot read valid repository configuration: ${configPath}`, { cause: error });
  }
  const config = validateSyncConfig(rawConfig, base);
  for (const project of config.projects) {
    await assertNoSymlinkPath(base, project.destination);
  }

  if (dryRun) {
    const planned = [];
    for (const [index, project] of config.projects.entries()) {
      const current = index;
      emitProgress(onProgress, current, config.projects.length, project.name);
      const exists = await pathExists(project.destination);
      const result = {
        name: project.name,
        folder: project.folder,
        action: exists ? 'inspect' : 'clone',
        remoteState: 'not-queried',
        status: SyncStatus.PLANNED,
        message: 'Remote state was not queried; dry-run performed no Git operations',
      };
      planned.push(result);
      emitProgress(onProgress, current + 1, config.projects.length, progressDetails(result));
    }
    onProgress('\n');
    return summarize(planned);
  }

  const results = [];
  for (const [index, project] of config.projects.entries()) {
    const current = index;
    emitProgress(onProgress, current, config.projects.length, project.name);
    try {
      const exists = await pathExists(project.destination);
      const result = exists
        ? await updateProject(project, runCommand)
        : await cloneProject(project, base, runCommand);
      results.push(result);
      emitProgress(onProgress, current + 1, config.projects.length, progressDetails(result));
    } catch (error) {
      const result = {
        name: project.name,
        folder: project.folder,
        status: error instanceof GitExecutionError ? SyncStatus.FAILED : SyncStatus.SKIPPED,
        message: error.message,
      };
      results.push(result);
      emitProgress(onProgress, current + 1, config.projects.length, progressDetails(result));
    }
  }
  onProgress('\n');
  return summarize(results);
}

function parseArguments(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    return { help: true };
  }
  const options = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const key = argument === '--config' ? 'configPath' : argument === '--base-dir' ? 'baseDir' : null;
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new SyncError('INVALID_CONFIG', `Invalid or incomplete option: ${argument}`);
    }
    if (options[key] !== undefined) {
      throw new SyncError('INVALID_CONFIG', `${argument} can only be provided once`);
    }
    options[key] = args[index + 1];
    index += 1;
  }
  if (!options.configPath || !options.baseDir) {
    throw new SyncError('INVALID_CONFIG', USAGE);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return;
  }
  const result = await syncRepositories({
    ...options,
    onProgress: (output) => stderr.write(output),
  });
  let errorLogPath = null;
  let errorLogFailure = null;
  try {
    errorLogPath = await writeErrorLog(options.configPath, result);
  } catch (error) {
    errorLogFailure = error.message;
  }
  stdout.write(`${formatSummary(result, errorLogPath, errorLogFailure)}\n`);
  if (!result.ok || errorLogFailure) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
