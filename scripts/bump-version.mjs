import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdout, stderr } from 'node:process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function bumpVersion(current, type) {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid version: ${current}`);
  }
  if (type === 'major') return `${parts[0] + 1}.0.0`;
  if (type === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  if (type === 'patch') return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  throw new Error(`Invalid bump type: ${type}. Use major, minor, or patch.`);
}

async function main() {
  const type = process.argv[2];
  if (!type || !['major', 'minor', 'patch'].includes(type)) {
    throw new Error('Usage: node scripts/bump-version.mjs major|minor|patch');
  }

  const packagePath = join(REPO_ROOT, 'package.json');
  const pluginPath = join(REPO_ROOT, 'plugin.json');

  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const plugin = JSON.parse(await readFile(pluginPath, 'utf8'));

  if (pkg.version !== plugin.version) {
    throw new Error(`Version mismatch: package.json=${pkg.version}, plugin.json=${plugin.version}`);
  }

  const previous = pkg.version;
  const next = bumpVersion(previous, type);

  pkg.version = next;
  plugin.version = next;

  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);

  stdout.write(JSON.stringify({ previous, version: next, files: ['package.json', 'plugin.json'] }, null, 2) + '\n');
}

main().catch((error) => {
  stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
