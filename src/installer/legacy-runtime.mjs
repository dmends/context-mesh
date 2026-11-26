// Scheduled for removal in v2.0 — migration from v1.1.0/v1.2.0 local install
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
function readHashesSync() {
  for (const candidate of [
    join(__dir, 'legacy-hashes.txt'),                          // installed: installer/legacy-hashes.txt
    join(__dir, '..', '..', 'resources', 'legacy-hashes.txt'), // dev source: resources/legacy-hashes.txt
  ]) {
    try { return readFileSync(candidate, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  throw new Error('legacy-hashes.txt not found');
}

const legacyHashes = new Map(
  readHashesSync().trim().split('\n').map((line) => [line.slice(65), line.slice(0, 64)]),
);

export function matchesLegacy(relativePath, bytes) {
  const expected = legacyHashes.get(relativePath);
  if (!expected) return false;
  const hash = (content) => createHash('sha256').update(content).digest('hex');
  if (hash(bytes) === expected) return true;
  const original = bytes.toString('utf8');
  const lf = original.replaceAll('\r\n', '\n');
  return lf.replaceAll('\n', '\r\n') === original && hash(lf) === expected;
}

export async function inspectLegacy(root, { apply = false, owned = false } = {}) {
  const result = { planned: [], removed: [], retained: [] };
  const knownDirectories = new Set([...legacyHashes.keys()].flatMap((file) => {
    const parts = file.split('/');
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }));
  async function visit(path, relativePath) {
    const info = await lstat(path);
    if (info.isDirectory() && (!relativePath || knownDirectories.has(relativePath))) {
      for (const name of (await readdir(path)).sort()) {
        await visit(join(path, name), relativePath ? `${relativePath}/${name}` : name);
      }
      if (apply && owned && (await readdir(path)).length === 0) await rmdir(path);
    } else if (owned && info.isFile() && matchesLegacy(relativePath, await readFile(path))) {
      if (apply) {
        await unlink(path);
        result.removed.push(path);
      } else {
        result.planned.push(path);
      }
    } else {
      result.retained.push(path);
    }
  }
  try {
    await lstat(root);
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  await visit(root, '');
  return result;
}
