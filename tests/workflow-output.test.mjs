import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../src/core/cli.mjs', import.meta.url));
const results = 'workspace/.discovery/motor-recorrencia/results/business-epic';
const epicTemplate = readFileSync(new URL('../resources/templates/004-business-epic.md', import.meta.url), 'utf8');
const epicDocument = (tema) => epicTemplate
  .replaceAll('<tema>', tema)
  .replaceAll('<tema ou domínio>', tema);

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-output-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = 'workspace/.discovery/motor-recorrencia/results/business-epic/story.txt';
  const write = (file, content) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  write(source, 'source');
  const run = (command, args = [], input, tema = 'Regra da Primeira Parcela', inputPath = source) => spawnSync(process.execPath, [
    cli, command, '--workspace', root, '--run-id', 'motor-recorrencia',
    ...(tema === null ? [] : ['--tema', tema]), '--input', inputPath, ...args,
  ], { encoding: 'utf8', input });
  return { root, run, write };
}

test('complete rejects a document in docs or another discovery topic', (t) => {
  const { run, write } = fixture(t);
  for (const file of ['docs/superpowers/plans/epic.md', 'workspace/.discovery/other/results/business-epic/epic.md']) {
    write(file, 'epic');
    const result = run('complete', ['--step', 'business-epic', '--artifact', `business-epic=${file}`]);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(results), result.stderr);
  }
});

test('workflow CLI requires an explicit topic for initiative subnodes', (t) => {
  const { run } = fixture(t);
  const result = run('ready', [], undefined, null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--tema/);
});

test('publish chooses the initiative directory and writes the next result without overwriting', (t) => {
  const { root, run, write } = fixture(t);
  write(`${results}/004-existing.md`, 'keep');
  const ready = run('ready');
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(JSON.parse(ready.stdout).readyStepDetails[0].outputDirectory, results);
  assert.equal(
    existsSync(join(root, '.smith/runs/motor-recorrencia.json')),
    true,
  );
  const document = epicDocument('Regra da Primeira Parcela');
  const publication = run('publish', ['--step', 'business-epic'], JSON.stringify({ 'business-epic': document }));
  assert.equal(publication.status, 0, publication.stderr);
  const file = `${results}/005-regra-da-primeira-parcela.md`;
  assert.equal(JSON.parse(publication.stdout).steps['business-epic'].artifacts[0].path, file);
  assert.equal(readFileSync(join(root, file), 'utf8'), document);
  assert.equal(readFileSync(join(root, results, '004-existing.md'), 'utf8'), 'keep');
  assert.equal(existsSync(join(root, 'docs')), false);
  write('docs/incorrect.md', '# Not the epic');
  const incorrect = run('complete', ['--step', 'business-epic', '--artifact', 'business-epic=docs/incorrect.md']);
  assert.notEqual(incorrect.status, 0);
  assert.ok(incorrect.stderr.includes(results), incorrect.stderr);
});

test('one initiative publishes different topic artifacts flat with shared numbering', (t) => {
  const { root, run } = fixture(t);
  const publish = (tema) => run(
    'publish',
    ['--step', 'business-epic'],
    JSON.stringify({ 'business-epic': epicDocument(tema) }),
    tema,
  );
  const first = publish('Cadastro e Ciclo de Vida do Contrato');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(
    JSON.parse(first.stdout).steps['business-epic'].artifacts[0].path,
    `${results}/001-cadastro-e-ciclo-de-vida-do-contrato.md`,
  );

  const second = publish('Regra da Primeira Parcela');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(
    JSON.parse(second.stdout).steps['business-epic'].artifacts[0].path,
    `${results}/002-regra-da-primeira-parcela.md`,
  );
  assert.equal(
    readFileSync(join(root, results, '001-cadastro-e-ciclo-de-vida-do-contrato.md'), 'utf8'),
    epicDocument('Cadastro e Ciclo de Vida do Contrato'),
  );
  assert.equal(
    readFileSync(join(root, results, '002-regra-da-primeira-parcela.md'), 'utf8'),
    epicDocument('Regra da Primeira Parcela'),
  );
});

test('publish rejects a business epic that omits template headings', (t) => {
  const { root, run } = fixture(t);
  const publication = run(
    'publish',
    ['--step', 'business-epic'],
    JSON.stringify({ 'business-epic': '# Épico de negócio — Regra da Primeira Parcela\n## Metadados\n' }),
  );
  assert.notEqual(publication.status, 0);
  assert.match(publication.stderr, /template/i);
  assert.equal(existsSync(join(root, results, '001-regra-da-primeira-parcela.md')), false);
});

test('publish rejects a business epic that omits a template table', (t) => {
  const { root, run } = fixture(t);
  const document = epicDocument('Regra da Primeira Parcela')
    .replace(/\| Ator\/área.*\n\|[-| ]+\|\n\|.*\n/, '');
  const publication = run('publish', ['--step', 'business-epic'], JSON.stringify({ 'business-epic': document }));
  assert.notEqual(publication.status, 0);
  assert.match(publication.stderr, /template/i);
  assert.equal(existsSync(join(root, results, '001-regra-da-primeira-parcela.md')), false);
});

test('publish refuses a symlinked output folder', (t) => {
  const { root, run, write } = fixture(t);
  write('workspace/src/story.md', 'source');
  rmSync(join(root, results), { recursive: true, force: true });
  write('docs/keep.txt', 'keep');
  symlinkSync(join(root, 'docs'), join(root, results), 'dir');
  const publication = run(
    'publish',
    ['--step', 'business-epic'],
    JSON.stringify({ 'business-epic': epicDocument('Regra da Primeira Parcela') }),
    'Regra da Primeira Parcela',
    'workspace/src/story.md',
  );
  assert.notEqual(publication.status, 0);
  assert.match(publication.stderr, /symlink/i);
  assert.equal(existsSync(join(root, 'docs', '001-business-epic.md')), false);
});
