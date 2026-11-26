import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_SCHEMA_VERSION } from '../config/env.mjs';
import { WORKFLOW_ID, WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';
import { StepStatus } from '../domain/status.mjs';

export function statePath({ workspaceRoot, runId }) {
  return resolve(workspaceRoot, '.smith', 'runs', `${runId}.json`);
}

export function createInitialNodeState({ runId, tema, nodeId, createdAt = new Date().toISOString() }) {
  return {
    id: nodeId,
    tema,
    createdAt,
    updatedAt: createdAt,
    steps: WORKFLOW_STEPS.map(({ id, name }) => ({
      name: name ?? id,
      type: id,
      status: StepStatus.PENDING,
      artifacts: [],
      items: [],
    })),
  };
}

export function createInitialState({ runId, createdAt = new Date().toISOString() }) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    workflowId: WORKFLOW_ID,
    runId,
    createdAt,
    updatedAt: createdAt,
    sources: [],
    nodes: [],
  };
}

export async function saveState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw cleanupError;
      }
    }
    throw error;
  }
}
