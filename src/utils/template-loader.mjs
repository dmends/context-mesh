import { readFile } from 'node:fs/promises';

export async function loadTemplate(absolutePath, substitutions = {}) {
  const raw = await readFile(absolutePath, 'utf8');
  const result = raw.replace(/\{\{([\w-]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(substitutions, key)) {
      throw new Error(`Template placeholder not provided: ${key} in ${absolutePath}`);
    }
    return substitutions[key];
  });
  return result.endsWith('\n') ? result : `${result}\n`;
}
