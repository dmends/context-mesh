import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'core', 'cli.mjs');
const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
