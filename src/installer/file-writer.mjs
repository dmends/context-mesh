import { link, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWrite(dest, content, { previous, changedMessage, force = false } = {}) {
  const temporary = join(dirname(dest), `.smith-tmp-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    if (previous !== undefined) {
      if (!force && !(await readFile(dest)).equals(previous)) {
        throw new Error(changedMessage ?? `File changed after preview: ${dest}`);
      }
      await rename(temporary, dest);
    } else if (force) {
      await rename(temporary, dest);
    } else {
      await link(temporary, dest);
      await rm(temporary);
    }
  } catch (error) {
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
