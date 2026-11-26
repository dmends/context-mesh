import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RUN_LOCK_TIMEOUT_MS, RUN_LOCK_STALE_MS } from '../config/env.mjs';
import { WorkflowError } from '../domain/errors.mjs';

const STALE_LOCK_AGE_MS = RUN_LOCK_STALE_MS;

export async function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    if (error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

export async function acquireRunLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const lockId = randomUUID();
  const startedAt = Date.now();
  await mkdir(dirname(filePath), { recursive: true });

  while (Date.now() - startedAt < RUN_LOCK_TIMEOUT_MS) {
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ lockId, pid: process.pid }));
      await handle.close();
      handle = undefined;
      return async () => {
        try {
          const owner = JSON.parse(await readFile(lockPath, 'utf8'));
          if (owner.lockId === lockId) {
            await unlink(lockPath);
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      };
    } catch (error) {
      if (handle) {
        await handle.close();
      }
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }

    try {
      const [contents, info] = await Promise.all([
        readFile(lockPath, 'utf8'),
        stat(lockPath),
      ]);
      if (Date.now() - info.mtimeMs > STALE_LOCK_AGE_MS) {
        let owner;
        try {
          owner = JSON.parse(contents);
        } catch (error) {
          if (!(error instanceof SyntaxError)) {
            throw error;
          }
        }
        if (!(await processIsAlive(owner?.pid))) {
          if ((await readFile(lockPath, 'utf8')) === contents) {
            await unlink(lockPath);
            continue;
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      continue;
    }

    await delay(25);
  }

  throw new WorkflowError('STEP_LOCKED', `Workflow run is locked by another process: ${filePath}`);
}
