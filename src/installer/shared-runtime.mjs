import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export function isSharedClient(client) {
  return client === 'jetbrains' || client === 'vscode';
}

function defaultRoot(join, isAbsolute, home, platform, env) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Smith');
  if (platform === 'win32') {
    const data = env.LOCALAPPDATA;
    return join(data && isAbsolute(data) ? data : join(home, 'AppData', 'Local'), 'Smith');
  }
  const data = env.XDG_DATA_HOME;
  return join(data && isAbsolute(data) ? data : join(home, '.local', 'share'), 'smith');
}

export function sharedDestination(version, sharedRoot) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/.test(version)) {
    throw new Error('Invalid shared runtime version');
  }
  const root = sharedRoot ?? defaultRoot(join, isAbsolute, homedir(), process.platform, process.env);
  if (!isAbsolute(root)) throw new Error('Shared runtime root must be absolute');
  return resolve(root, 'versions', version);
}

export function workflowCommand(version, sharedRoot) {
  return `node "${join(sharedDestination(version, sharedRoot), 'installer', 'run-workflow.mjs')}"`;
}
