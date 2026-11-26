import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTemplate } from './template-loader.mjs';

let fixtureDir;

before(async () => {
  fixtureDir = join(tmpdir(), `template-loader-test-${Date.now()}`);
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(join(fixtureDir, 'hello.md'), 'Hello {{name}}, version {{version}}!\n');
  await writeFile(join(fixtureDir, 'hyphen.md'), 'Author: {{author-name}} <{{author-email}}>\n');
  await writeFile(join(fixtureDir, 'no-newline.md'), 'no trailing newline');
  await writeFile(join(fixtureDir, 'empty.md'), 'No placeholders here.\n');
});

after(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe('loadTemplate', () => {
  it('substitutes all placeholders', async () => {
    const result = await loadTemplate(join(fixtureDir, 'hello.md'), { name: 'World', version: '1.0' });
    assert.equal(result, 'Hello World, version 1.0!\n');
  });

  it('ensures trailing newline', async () => {
    const result = await loadTemplate(join(fixtureDir, 'no-newline.md'), {});
    assert.ok(result.endsWith('\n'));
  });

  it('works with no substitutions when no placeholders', async () => {
    const result = await loadTemplate(join(fixtureDir, 'empty.md'), {});
    assert.equal(result, 'No placeholders here.\n');
  });

  it('substitutes hyphenated placeholders', async () => {
    const result = await loadTemplate(join(fixtureDir, 'hyphen.md'), { 'author-name': 'Alice', 'author-email': 'alice@example.com' });
    assert.equal(result, 'Author: Alice <alice@example.com>\n');
  });

  it('throws for missing placeholder', async () => {
    await assert.rejects(
      () => loadTemplate(join(fixtureDir, 'hello.md'), { name: 'X' }),
      /placeholder not provided: version/,
    );
  });

  it('throws for nonexistent file', async () => {
    await assert.rejects(
      () => loadTemplate(join(fixtureDir, 'does-not-exist.md'), {}),
      { code: 'ENOENT' },
    );
  });
});
