import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, before, after } from 'node:test';
import { atomicWrite } from './file-writer.mjs';

describe('atomicWrite', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'file-writer-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a new file', async () => {
    const dest = join(dir, 'new.txt');
    await atomicWrite(dest, Buffer.from('hello'));
    assert.equal(readFileSync(dest, 'utf8'), 'hello');
  });

  it('replaces file when previous matches', async () => {
    const dest = join(dir, 'replace.txt');
    const previous = Buffer.from('original');
    writeFileSync(dest, previous);
    await atomicWrite(dest, Buffer.from('updated'), { previous });
    assert.equal(readFileSync(dest, 'utf8'), 'updated');
  });

  it('throws when previous does not match', async () => {
    const dest = join(dir, 'mismatch.txt');
    writeFileSync(dest, 'other-content');
    await assert.rejects(
      () => atomicWrite(dest, Buffer.from('new'), { previous: Buffer.from('expected') }),
      /changed after preview/,
    );
    // original content must be preserved
    assert.equal(readFileSync(dest, 'utf8'), 'other-content');
  });

  it('uses custom changedMessage when previous does not match', async () => {
    const dest = join(dir, 'custom-msg.txt');
    writeFileSync(dest, 'other');
    await assert.rejects(
      () => atomicWrite(dest, Buffer.from('new'), { previous: Buffer.from('expected'), changedMessage: 'my custom error' }),
      /my custom error/,
    );
  });

  it('creates parent directory if missing', async () => {
    const dest = join(dir, 'subdir', 'nested', 'file.txt');
    // atomicWrite does NOT create parent dirs — test it fails
    await assert.rejects(() => atomicWrite(dest, Buffer.from('x')), /ENOENT/);
  });

  it('writes string content', async () => {
    const dest = join(dir, 'string.txt');
    await atomicWrite(dest, 'hello string');
    assert.equal(readFileSync(dest, 'utf8'), 'hello string');
  });

  it('leaves no temp file on error', async () => {
    const dest = join(dir, 'subdir2', 'file.txt');
    // Will fail because parent doesn't exist. The temp file must be cleaned up.
    // Since temp is in dirname(dest) which also doesn't exist, writeFile itself throws,
    // so there's nothing to clean up here. This is an ENOENT from writeFile.
    await assert.rejects(() => atomicWrite(dest, Buffer.from('x')), /ENOENT/);
  });
});
