import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { WorkflowError } from '../domain/errors.mjs';

async function removeIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function restoreArtifact(destination, backup, originalError) {
  try {
    await removeIfPresent(destination);
    await rename(backup, destination);
  } catch (rollbackError) {
    throw new WorkflowError(
      'ARTIFACT_ROLLBACK_FAILED',
      `Artifact operation failed and the original file could not be restored: ${destination}`,
      { cause: new AggregateError([originalError, rollbackError]) },
    );
  }
}

function assertOperation({ destination, commit }) {
  if (typeof destination !== 'string' || !destination || typeof commit !== 'function') {
    throw new WorkflowError('INVALID_ARGUMENT', 'Artifact transaction requires a destination and commit callback');
  }
}

export async function replaceArtifactFile({ destination, content, commit }) {
  assertOperation({ destination, commit });
  if (typeof content !== 'string') {
    throw new WorkflowError('INVALID_ARGUMENT', 'Artifact content must be a string');
  }
  const absolutePath = resolve(destination);
  const temporary = `${absolutePath}.${randomUUID()}.tmp`;
  const backup = `${absolutePath}.${randomUUID()}.bak`;
  let originalMoved = false;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(absolutePath, backup);
    originalMoved = true;
    await rename(temporary, absolutePath);
    await commit();
  } catch (error) {
    if (originalMoved) await restoreArtifact(absolutePath, backup, error);
    throw error;
  } finally {
    await removeIfPresent(temporary);
  }
  try {
    await unlink(backup);
  } catch (error) {
    throw new WorkflowError(
      'ARTIFACT_CLEANUP_FAILED',
      `Artifact was updated but its temporary backup could not be removed: ${backup}`,
      { cause: error },
    );
  }
}

export async function removeArtifactFile({ destination, commit }) {
  assertOperation({ destination, commit });
  const absolutePath = resolve(destination);
  const backup = `${absolutePath}.${randomUUID()}.bak`;
  await rename(absolutePath, backup);
  try {
    await commit();
  } catch (error) {
    await restoreArtifact(absolutePath, backup, error);
    throw error;
  }
  try {
    await unlink(backup);
  } catch (error) {
    throw new WorkflowError(
      'ARTIFACT_CLEANUP_FAILED',
      `Artifact reference was removed but its temporary backup could not be deleted: ${backup}`,
      { cause: error },
    );
  }
}
