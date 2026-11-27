import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, before, after } from 'node:test';
import { buildPromptContent } from './prompt-builder.mjs';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';

const REAL_PROMPT_DIR = fileURLToPath(new URL('../../resources/prompts', import.meta.url));

describe('buildPromptContent', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'prompt-builder-test-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('returns Buffer content and sourceContent', async () => {
    const sourcePath = join(REAL_PROMPT_DIR, '00-discovery-consolidation.prompt.md');
    const result = await buildPromptContent(sourcePath, { stage: 'discovery-consolidation', workflowCommand: 'node /plugin/cli.mjs', step: undefined });
    assert.ok(Buffer.isBuffer(result.content));
    assert.ok(Buffer.isBuffer(result.sourceContent));
  });

  it('replaces OLD_WORKFLOW_COMMAND with workflowCommand', async () => {
    const fixture = join(dir, 'fixture.prompt.md');
    const oldCmd = 'node .copilot/plugins/smith/core/cli.mjs';
    writeFileSync(fixture, `---\nname: "test"\ndescription: "d"\n---\n\n${oldCmd} ready\n`);
    const result = await buildPromptContent(fixture, { stage: 'discovery-consolidation', workflowCommand: 'my-launcher', step: undefined });
    assert.match(result.content.toString('utf8'), /my-launcher/);
    assert.doesNotMatch(result.content.toString('utf8'), /smith\/dynamic-workflow/);
  });

  it('injects guidance text into ---\\n---\\n block', async () => {
    const fixture = join(dir, 'with-frontmatter.prompt.md');
    writeFileSync(fixture, `---\nname: "test"\ndescription: "d"\n---\n\nbody text\n`);
    const result = await buildPromptContent(fixture, { stage: 'business-epic', workflowCommand: 'my-launcher', step: undefined });
    assert.match(result.content.toString('utf8'), /Use somente as fontes/);
  });

  it('sourceContent matches original file bytes', async () => {
    const sourcePath = join(REAL_PROMPT_DIR, '00-discovery-consolidation.prompt.md');
    const result = await buildPromptContent(sourcePath, { stage: 'discovery-consolidation', workflowCommand: 'cmd', step: undefined });
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(sourcePath).toString('utf8').replaceAll('\r\n', '\n');
    assert.deepEqual(result.sourceContent, Buffer.from(raw));
  });

  it('strips **Templates instalado** lines for non-AIK stages', async () => {
    const fixture = join(dir, 'templates-line.prompt.md');
    writeFileSync(fixture, `---\nname: "test"\ndescription: "d"\n---\n\n**Templates instalado:** foo\nbody\n`);
    const result = await buildPromptContent(fixture, { stage: 'business-epic', workflowCommand: 'cmd', step: undefined });
    assert.doesNotMatch(result.content.toString('utf8'), /Templates instalado/);
  });

  it('keeps **Templates instalado** lines for as-is-knowledge stage', async () => {
    const fixture = join(dir, 'templates-aik.prompt.md');
    writeFileSync(fixture, `---\nname: "test"\ndescription: "d"\n---\n\n**Templates instalado:** foo\nbody\n`);
    const result = await buildPromptContent(fixture, { stage: 'as-is-knowledge', workflowCommand: 'cmd', step: undefined });
    assert.match(result.content.toString('utf8'), /Templates instalado/);
  });

  it('publishes As-Is knowledge as a workflow artifact, not a knowledge category', async () => {
    const sourcePath = join(REAL_PROMPT_DIR, '02-as-is-knowledge.prompt.md');
    const step = WORKFLOW_STEPS.find(({ id }) => id === 'as-is-knowledge');
    const result = await buildPromptContent(sourcePath, {
      stage: 'as-is-knowledge',
      workflowCommand: 'node plugin/core/cli.mjs',
      step,
    });
    const content = result.content.toString('utf8');
    assert.match(content, /--step as-is-knowledge --input/);
    assert.doesNotMatch(content, /--knowledge-category/);
    assert.match(content, /workspace\/\.discovery\/<run-id>\/results\/as-is-knowledge/);
  });

  it('renders alias prompts with the canonical workflow step for templates and publication', async () => {
    const aliases = [
      ['03-discovery-result.prompt.md', 'discovery-result', 'discovery-consolidation'],
      ['10-api-knowledge.prompt.md', 'api-knowledge', 'as-is-knowledge'],
    ];

    for (const [filename, alias, stepId] of aliases) {
      const sourcePath = join(REAL_PROMPT_DIR, filename);
      const result = await buildPromptContent(sourcePath, {
        stage: alias,
        workflowCommand: 'node plugin/core/cli.mjs',
      });
      const content = result.content.toString('utf8');

      assert.match(content, new RegExp(`template --step ${stepId}`), filename);
      assert.match(content, new RegExp(`publish --workspace \\. --run-id <run-id> --tema "<tema>" --step ${stepId}`), filename);
      assert.doesNotMatch(content, new RegExp(`template --step ${alias}(?:\\s|$)`), filename);
      assert.doesNotMatch(content, / complete --workspace /, filename);
    }
  });

  it('keeps Analysis independent from workflow steps and directs output to the analysis directory', async () => {
    const sourcePath = join(REAL_PROMPT_DIR, '09-analysis.prompt.md');
    const result = await buildPromptContent(sourcePath, {
      stage: 'analysis',
      workflowCommand: 'node plugin/core/cli.mjs',
    });
    const content = result.content.toString('utf8');

    assert.match(content, /não é uma etapa do workflow/i);
    assert.match(content, /workspace\/\.analysis\//);
    assert.match(content, /008-analysis\.md/);
    assert.doesNotMatch(content, /template --step|ready --workspace|publish --workspace|complete --workspace/);
    assert.doesNotMatch(content, /workspace\/\.knowledge|results\/as-is-knowledge/);
  });

  it('throws ENOENT for missing source file', async () => {
    await assert.rejects(
      () => buildPromptContent(join(dir, 'nonexistent.prompt.md'), { stage: 'x', workflowCommand: 'cmd', step: undefined }),
      { code: 'ENOENT' },
    );
  });
});
