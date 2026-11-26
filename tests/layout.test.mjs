import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const templates = [
  '000-knowledge-api.md',
  '001-knowledge-as-is.md',
  '002-discovery-result.md',
  '003-decision-record.md',
  '004-business-epic.md',
  '005-technical-specification.md',
  '006-story-task-breakdown.md',
  '007-execution-plan.md',
];

test('plugin package keeps templates outside the workspace', () => {
  assert.ok(existsSync(path.join(root, '.github')), '.github must remain at the repository root');
  assert.equal(existsSync(path.join(root, 'workspace', '.templates')), false);

  for (const template of templates) {
    assert.ok(
      existsSync(path.join(root, 'resources', 'templates', template)),
      `resources/templates/${template} must exist`,
    );
  }
});

test('git ignores the client-identifying project input file', () => {
  const result = spawnSync('git', ['check-ignore', '-q', 'input-projects-full.json'], {
    cwd: root,
  });

  assert.equal(result.status, 0, 'input-projects-full.json must not be added to the repository');
});

test('project does not depend on removed personal and Spec Kit paths', () => {
  for (const legacyPath of ['.specify', '.github/agents', '.github/prompts']) {
    assert.equal(existsSync(path.join(root, legacyPath)), false, `${legacyPath} must be absent`);
  }

  assert.equal(readdirSync(root).includes('.scripts'), false, 'personal .scripts link must be absent');
});

test('persisted workflow state is excluded from version control', () => {
  for (const statePath of [
    '.smith/runs/example.json',
    'workspace/.workflow/runs/example.json',
  ]) {
    const result = spawnSync('git', ['check-ignore', '-q', statePath], { cwd: root });
    assert.equal(result.status, 0, `${statePath} must be ignored`);
  }
});
