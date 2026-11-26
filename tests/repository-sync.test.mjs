import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const syncUrl = new URL('../src/utils/repository/sync/sync.mjs', import.meta.url);
const syncCliPath = new URL('../src/utils/repository/sync/sync.mjs', import.meta.url);
const doctorUrl = new URL('../src/installer/doctor.mjs', import.meta.url);

function directory(t, prefix) {
  const result = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(result, { recursive: true, force: true }));
  return result;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function initRepository(cwd, branch = 'main') {
  mkdirSync(cwd, { recursive: true });
  git(cwd, 'init');
  git(cwd, 'checkout', '-b', branch);
  git(cwd, 'config', 'user.name', 'Repository Sync Tests');
  git(cwd, 'config', 'user.email', 'repo-sync-tests@example.invalid');
}

function commitFile(cwd, name, content, message) {
  writeFileSync(path.join(cwd, name), content);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-m', message);
}

function createRemote(t, { branch = 'main', name = 'project.git' } = {}) {
  const root = directory(t, 'repo-sync-');
  const baseDir = path.join(root, 'workspace');
  const remoteDirectory = path.join(root, 'remotes');
  const remotePath = path.join(remoteDirectory, name);
  const seedPath = path.join(root, 'seed');
  mkdirSync(baseDir);
  mkdirSync(remoteDirectory);
  git(root, 'init', '--bare', remotePath);
  git(root, '--git-dir', remotePath, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  initRepository(seedPath, branch);
  commitFile(seedPath, 'README.txt', 'initial\n', 'initial commit');
  git(seedPath, 'remote', 'add', 'origin', pathToFileURL(remotePath).href);
  git(seedPath, 'push', '--set-upstream', 'origin', branch);
  const configPath = path.join(root, 'repositories.json');
  const config = {
    baseUrl: pathToFileURL(`${remoteDirectory}${path.sep}`).href,
    defaultBranch: branch,
    projects: [{ folder: 'project with spaces', gitPath: name, name: 'Project', branch }],
  };
  writeFileSync(configPath, JSON.stringify(config));
  return { root, baseDir, remoteDirectory, remotePath, seedPath, configPath, config };
}

async function loadSync() {
  assert.ok(existsSync(fileURLToPath(syncUrl)), 'repository synchronizer entry point must exist');
  return import(syncUrl.href);
}

test('dry-run reads explicit config without creating directories or invoking Git', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  let commands = 0;

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
    dryRun: true,
    runCommand: async () => {
      commands += 1;
      throw new Error('Git must not run during dry-run');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.projects[0].action, 'clone');
  assert.equal(result.projects[0].remoteState, 'not-queried');
  assert.equal(commands, 0);
  assert.equal(existsSync(path.join(scenario.baseDir, 'project with spaces')), false);
});

test('missing branch and invalid configuration fail before any Git operation', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  const invalidConfig = {
    ...scenario.config,
    defaultBranch: undefined,
    projects: [{ ...scenario.config.projects[0], branch: undefined }],
  };
  writeFileSync(scenario.configPath, JSON.stringify(invalidConfig));
  let commands = 0;

  await assert.rejects(
    syncRepositories({
      configPath: scenario.configPath,
      baseDir: scenario.baseDir,
      runCommand: async () => {
        commands += 1;
      },
    }),
    /branch/i,
  );
  assert.equal(commands, 0);
});

test('clone uses configured URL and branch and supports paths with spaces', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  scenario.config.defaultBranch = 'unused-default';
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });
  const destination = path.join(scenario.baseDir, 'project with spaces');

  assert.equal(result.ok, true);
  assert.equal(result.projects[0].status, 'cloned');
  assert.equal(readFileSync(path.join(destination, 'README.txt'), 'utf8'), 'initial\n');
  assert.equal(git(destination, 'branch', '--show-current'), 'main');
  assert.equal(git(destination, 'remote', 'get-url', 'origin'), pathToFileURL(scenario.remotePath).href);
});

test('default branch is used when a project branch is absent', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t, { branch: 'release' });
  scenario.config.defaultBranch = 'release';
  scenario.config.projects[0].branch = undefined;
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.projects[0].status, 'cloned');
  assert.equal(
    git(path.join(scenario.baseDir, 'project with spaces'), 'branch', '--show-current'),
    'release',
  );
});

test('configured target paths with shell-special characters are handled as arguments', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  scenario.config.projects[0].folder = 'project & release #1';
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.projects[0].status, 'cloned');
  assert.equal(
    readFileSync(path.join(scenario.baseDir, 'project & release #1', 'README.txt'), 'utf8'),
    'initial\n',
  );
});

test('explicit local branch creation is applied when cloning', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  scenario.config.projects[0].localBranch = 'work/topic';
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.projects[0].status, 'cloned');
  assert.equal(git(path.join(scenario.baseDir, 'project with spaces'), 'branch', '--show-current'), 'work/topic');
});

test('clean existing branch advances only by fast-forward', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  commitFile(scenario.seedPath, 'README.txt', 'updated remotely\n', 'remote update');
  git(scenario.seedPath, 'push', 'origin', 'main');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.projects[0].status, 'updated');
  assert.equal(
    readFileSync(path.join(scenario.baseDir, 'project with spaces', 'README.txt'), 'utf8'),
    'updated remotely\n',
  );
});

test('fast-forward refuses to overwrite a locally ignored file', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  const ignoredPath = path.join(destination, 'local-settings.json');
  writeFileSync(path.join(destination, '.git', 'info', 'exclude'), 'local-settings.json\n');
  writeFileSync(ignoredPath, 'keep local settings\n');
  const localHead = git(destination, 'rev-parse', 'HEAD');
  commitFile(scenario.seedPath, 'local-settings.json', 'remote replacement\n', 'add remote settings');
  git(scenario.seedPath, 'push', 'origin', 'main');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.notEqual(result.projects[0].status, 'updated');
  assert.match(result.projects[0].message, /ignored/i);
  assert.equal(git(destination, 'rev-parse', 'HEAD'), localHead);
  assert.equal(readFileSync(ignoredPath, 'utf8'), 'keep local settings\n');
});

test('a configured folder inside another repository is not treated as its root', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  git(scenario.root, 'clone', pathToFileURL(scenario.remotePath).href, scenario.baseDir);
  const destination = path.join(scenario.baseDir, 'nested destination');
  mkdirSync(destination);
  scenario.config.projects[0].folder = 'nested destination';
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));
  const parentHead = git(scenario.baseDir, 'rev-parse', 'HEAD');
  commitFile(scenario.seedPath, 'README.txt', 'new remote state\n', 'remote update');
  git(scenario.seedPath, 'push', 'origin', 'main');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /repository root|destination/i);
  assert.equal(git(scenario.baseDir, 'rev-parse', 'HEAD'), parentHead);
  assert.equal(readFileSync(path.join(scenario.baseDir, 'README.txt'), 'utf8'), 'initial\n');
});

test('update uses the fetched branch even when origin fetch refspec excludes it', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  git(destination, 'config', '--unset-all', 'remote.origin.fetch');
  git(destination, 'config', '--add', 'remote.origin.fetch', '+refs/heads/other:refs/remotes/origin/other');
  git(destination, 'update-ref', '-d', 'refs/remotes/origin/main');
  commitFile(scenario.seedPath, 'README.txt', 'fresh fetched state\n', 'remote update');
  git(scenario.seedPath, 'push', 'origin', 'main');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.projects[0].status, 'updated');
  assert.equal(readFileSync(path.join(destination, 'README.txt'), 'utf8'), 'fresh fetched state\n');
});

test('dirty tracked and untracked files are preserved and block updates', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  writeFileSync(path.join(destination, 'README.txt'), 'local edit\n');
  writeFileSync(path.join(destination, 'untracked.txt'), 'keep me\n');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /local change/i);
  assert.equal(readFileSync(path.join(destination, 'README.txt'), 'utf8'), 'local edit\n');
  assert.equal(readFileSync(path.join(destination, 'untracked.txt'), 'utf8'), 'keep me\n');
});

test('local commits ahead of remote are preserved without reset or checkout', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  commitFile(destination, 'local.txt', 'local commit\n', 'local commit');
  const localHead = git(destination, 'rev-parse', 'HEAD');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /local commits/i);
  assert.equal(git(destination, 'rev-parse', 'HEAD'), localHead);
  assert.equal(existsSync(path.join(destination, 'local.txt')), true);
});

test('a different current branch is not changed implicitly', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  git(destination, 'checkout', '-b', 'user-branch');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /not configured branch/i);
  assert.equal(git(destination, 'branch', '--show-current'), 'user-branch');
});

test('diverged history is reported without modifying the local commit', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  commitFile(destination, 'local.txt', 'local\n', 'local change');
  const localHead = git(destination, 'rev-parse', 'HEAD');
  commitFile(scenario.seedPath, 'remote.txt', 'remote\n', 'remote change');
  git(scenario.seedPath, 'push', 'origin', 'main');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /diverged/i);
  assert.equal(git(destination, 'rev-parse', 'HEAD'), localHead);
  assert.equal(existsSync(path.join(destination, 'remote.txt')), false);
});

test('operation in progress blocks synchronization without being aborted', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  const mergeHead = path.join(destination, '.git', 'MERGE_HEAD');
  writeFileSync(mergeHead, 'in-progress\n');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /operation in progress/i);
  assert.equal(existsSync(mergeHead), true);
});

test('non-Git destination and remote mismatch are reported without replacement', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  const destination = path.join(scenario.baseDir, 'project with spaces');
  mkdirSync(destination);
  writeFileSync(path.join(destination, 'keep.txt'), 'keep\n');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /not a Git repository/i);
  assert.equal(readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'keep\n');
});

test('a configured origin mismatch is skipped without changing the existing repository', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  await syncRepositories({ configPath: scenario.configPath, baseDir: scenario.baseDir });
  const destination = path.join(scenario.baseDir, 'project with spaces');
  const otherRemote = path.join(scenario.remoteDirectory, 'other.git');
  git(scenario.root, 'init', '--bare', otherRemote);
  git(destination, 'remote', 'set-url', 'origin', pathToFileURL(otherRemote).href);
  const localHead = git(destination, 'rev-parse', 'HEAD');

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.projects[0].status, 'skipped');
  assert.match(result.projects[0].message, /origin differs/i);
  assert.equal(git(destination, 'rev-parse', 'HEAD'), localHead);
});

test('duplicate targets, path traversal, absolute paths, and symlinks fail before Git', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  const duplicate = {
    ...scenario.config,
    projects: [scenario.config.projects[0], { ...scenario.config.projects[0], name: 'Duplicate' }],
  };
  writeFileSync(scenario.configPath, JSON.stringify(duplicate));
  let commands = 0;
  await assert.rejects(
    syncRepositories({
      configPath: scenario.configPath,
      baseDir: scenario.baseDir,
      runCommand: async () => {
        commands += 1;
      },
    }),
    /duplicate|same destination/i,
  );
  assert.equal(commands, 0);

  for (const folder of ['../outside', path.join(scenario.root, 'absolute')]) {
    scenario.config.projects = [{ folder, gitPath: 'project.git', name: 'Invalid', branch: 'main' }];
    writeFileSync(scenario.configPath, JSON.stringify(scenario.config));
    await assert.rejects(
      syncRepositories({
        configPath: scenario.configPath,
        baseDir: scenario.baseDir,
        runCommand: async () => {
          commands += 1;
        },
      }),
      /relative path|escapes/i,
    );
  }
  assert.equal(commands, 0);

  const outside = path.join(scenario.root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, path.join(scenario.baseDir, 'linked'));
  scenario.config.projects = [{ folder: 'linked/project', gitPath: 'project.git', name: 'Linked', branch: 'main' }];
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));
  await assert.rejects(
    syncRepositories({
      configPath: scenario.configPath,
      baseDir: scenario.baseDir,
      runCommand: async () => {
        commands += 1;
      },
    }),
    /symlink|symbolic link/i,
  );
  assert.equal(commands, 0);
  assert.equal(lstatSync(path.join(scenario.baseDir, 'linked')).isSymbolicLink(), true);
});

test('Git absence or clone failure is reported in the aggregate result', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
    runCommand: async () => {
      const error = new Error('spawn git ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.equal(result.projects[0].status, 'failed');
  assert.match(result.projects[0].message, /Git executable not found/i);
});

test('project failures are aggregated while other projects continue', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  scenario.config.projects.push({
    folder: 'unavailable project',
    gitPath: 'missing.git',
    name: 'Unavailable',
    branch: 'main',
  });
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));

  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.total, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.projects[0].status, 'cloned');
  assert.equal(result.projects[1].status, 'failed');
});

test('authentication failures are summarized without printing remote credentials', async (t) => {
  const { syncRepositories } = await loadSync();
  const scenario = createRemote(t);
  const result = await syncRepositories({
    configPath: scenario.configPath,
    baseDir: scenario.baseDir,
    runCommand: async () => {
      const error = new Error('remote access denied');
      error.code = 128;
      error.stderr = 'Permission denied while accessing https://user:secret@example.invalid/repo.git';
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.projects[0].message, /authentication or remote access was denied/i);
  assert.doesNotMatch(result.projects[0].message, /secret|user:secret/i);
});

test('doctor checks Git and validates a configured catalog without running synchronization', async (t) => {
  const { diagnoseProject } = await import(doctorUrl.href);
  const scenario = createRemote(t);
  let commands = 0;

  const diagnosis = await diagnoseProject({
    targetRoot: scenario.baseDir,
    client: 'jetbrains',
    syncConfigPath: scenario.configPath,
    gitAvailable: false,
    runCommand: async () => {
      commands += 1;
      throw new Error('doctor must not synchronize repositories');
    },
  });

  assert.equal(diagnosis.checks.find((check) => check.id === 'git').ok, false);
  assert.equal(diagnosis.checks.find((check) => check.id === 'repository-config').ok, true);
  assert.equal(commands, 0);
  assert.equal(existsSync(path.join(scenario.baseDir, 'project with spaces')), false);
});

test('doctor reports invalid repository catalogs without exposing their contents', async (t) => {
  const { diagnoseProject } = await import(doctorUrl.href);
  const scenario = createRemote(t);
  writeFileSync(scenario.configPath, '{"baseUrl":"https://user:secret@example.invalid/"}');

  const diagnosis = await diagnoseProject({
    targetRoot: scenario.baseDir,
    client: 'jetbrains',
    syncConfigPath: scenario.configPath,
    gitAvailable: true,
  });
  const check = diagnosis.checks.find((item) => item.id === 'repository-config');

  assert.equal(check.ok, false);
  assert.doesNotMatch(check.message, /secret|user:secret/i);
});

test('CLI dry-run returns nonzero for invalid configuration and does not create targets', async (t) => {
  const scenario = createRemote(t);
  const invalidConfig = { ...scenario.config, projects: [] };
  writeFileSync(scenario.configPath, JSON.stringify(invalidConfig));

  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(syncCliPath),
      '--config',
      scenario.configPath,
      '--base-dir',
      scenario.baseDir,
      '--dry-run',
    ],
    { encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /projects/i);
  assert.equal(existsSync(path.join(scenario.baseDir, 'project with spaces')), false);
});

test('CLI reports clone progress and a formatted summary without creating an error log', (t) => {
  const scenario = createRemote(t);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(syncCliPath),
      '--config',
      scenario.configPath,
      '--base-dir',
      scenario.baseDir,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /\(0\/1\) Project/);
  assert.match(result.stderr, /\(1\/1\).*Project/);
  assert.match(result.stderr, /\[clone\] Project/);
  assert.match(result.stdout, /Resumo da sincronização/);
  assert.match(result.stdout, /Clonados:\s+1/);
  assert.doesNotMatch(result.stdout, /^\s*\{/);
  assert.equal(readdirSync(scenario.root).some((name) => name.includes('.errors.')), false);
});

test('CLI reports a formatted dry-run summary without creating an error log', (t) => {
  const scenario = createRemote(t);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(syncCliPath),
      '--config',
      scenario.configPath,
      '--base-dir',
      scenario.baseDir,
      '--dry-run',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /\(1\/1\).*Project/);
  assert.match(result.stderr, /planned/i);
  assert.match(result.stdout, /Resumo da sincronização/);
  assert.match(result.stdout, /Planejados:\s+1/);
  assert.doesNotMatch(result.stdout, /^\s*\{/);
  assert.equal(readdirSync(scenario.root).some((name) => name.includes('.errors.')), false);
});

test('CLI writes only project errors to a timestamped log beside the source config', (t) => {
  const scenario = createRemote(t);
  const fixedClockPath = path.join(scenario.root, 'fixed-clock.cjs');
  writeFileSync(
    fixedClockPath,
    "Date.prototype.toISOString = () => '2024-01-02T03:04:05.678Z';\n",
  );
  scenario.config.projects.push({
    folder: 'unavailable project',
    gitPath: 'missing.git',
    name: 'Unavailable',
    branch: 'main',
  });
  writeFileSync(scenario.configPath, JSON.stringify(scenario.config));
  const results = Array.from({ length: 2 }, () =>
    spawnSync(
      process.execPath,
      [
        '--require',
        fixedClockPath,
        fileURLToPath(syncCliPath),
        '--config',
        scenario.configPath,
        '--base-dir',
        scenario.baseDir,
      ],
      { encoding: 'utf8' },
    ),
  );
  const errorLogs = readdirSync(scenario.root).filter((name) =>
    /^repositories\.errors\.20240102-030405-678Z(?:-[0-9a-f-]+)?\.log$/.test(name),
  );

  assert.equal(results.every(({ status }) => status === 1), true);
  assert.equal(errorLogs.length, 2);
  for (const result of results) {
    assert.match(result.stdout, /Resumo da sincronização/);
    assert.match(result.stdout, /Erros:\s+1/);
    assert.doesNotMatch(result.stdout, /Unavailable|not found|not accessible/i);
    assert.doesNotMatch(result.stdout, /^\s*\{/);
  }

  for (const logName of errorLogs) {
    const errorLog = readFileSync(path.join(scenario.root, logName), 'utf8');
    assert.match(errorLog, /Unavailable/);
    assert.match(errorLog, /failed/);
    assert.match(errorLog, /unavailable project/);
    assert.doesNotMatch(errorLog, /Project/);
  }
});

test('CLI still prints the summary when the error log cannot be written', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('read-only directory permissions are not enforceable in this environment');
  }
  const scenario = createRemote(t);
  scenario.config.projects.push({
    folder: 'unavailable project',
    gitPath: 'missing.git',
    name: 'Unavailable',
    branch: 'main',
  });
  const configDir = path.join(scenario.root, 'readonly-config');
  mkdirSync(configDir);
  const configPath = path.join(configDir, 'repositories.json');
  writeFileSync(configPath, JSON.stringify(scenario.config));
  chmodSync(configDir, 0o555);

  let result;
  try {
    result = spawnSync(
      process.execPath,
      [
        fileURLToPath(syncCliPath),
        '--config',
        configPath,
        '--base-dir',
        scenario.baseDir,
      ],
      { encoding: 'utf8' },
    );
  } finally {
    chmodSync(configDir, 0o755);
  }

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Resumo da sincronização/);
  assert.match(result.stdout, /Erros:\s+1/);
  assert.match(result.stdout, /Log de erros: não foi possível gravar/);
  assert.doesNotMatch(result.stdout, /Unavailable|not found|not accessible/i);
});

test('CLI help documents the explicit external configuration contract', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(syncCliPath), '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /baseUrl/);
  assert.match(result.stdout, /defaultBranch/);
  assert.match(result.stdout, /localBranch/);
});
