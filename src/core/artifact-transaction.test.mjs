import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { removeArtifactFile, replaceArtifactFile } from './artifact-transaction.mjs';

test('replacement restores the original artifact when state persistence fails', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smith-artifact-transaction-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'artifact.md');
  await writeFile(destination, 'original');

  await assert.rejects(replaceArtifactFile({
    destination,
    content: 'replacement',
    commit: async () => { throw new Error('state persistence failed'); },
  }), /state persistence failed/);

  assert.equal(await readFile(destination, 'utf8'), 'original');
  assert.deepEqual(await readdir(directory), ['artifact.md']);
});

test('removal restores the artifact when state persistence fails', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smith-artifact-transaction-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'artifact.md');
  await writeFile(destination, 'original');

  await assert.rejects(removeArtifactFile({
    destination,
    commit: async () => { throw new Error('state persistence failed'); },
  }), /state persistence failed/);

  assert.equal(await readFile(destination, 'utf8'), 'original');
  assert.deepEqual(await readdir(directory), ['artifact.md']);
});
