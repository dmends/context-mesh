import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { StepStatus } from '../src/domain/status.mjs';
import { WORKFLOW_STEPS } from '../src/workflows/project-lifecycle.mjs';

class Element {
  constructor(tag = '') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.text = '';
    this.listeners = {};
    this.files = [];
    this.attributes = {};
    this.style = {};
    this.value = '';
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this._className = '';
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name) => {
        if (classes.has(name)) { classes.delete(name); return false; }
        classes.add(name);
        return true;
      },
      contains: (name) => classes.has(name),
    };
    Object.defineProperty(this, 'className', {
      get: () => [...classes].join(' ') || this._className,
      set: (value) => {
        this._className = value;
        classes.clear();
        value.split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
      },
    });
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    const matches = (item) => selector.startsWith('.')
      ? item.classList.contains(selector.slice(1))
      : item.tagName.toLowerCase() === selector;
    return descendants(this).slice(1).find(matches) || null;
  }
  remove() { this.removed = true; }
}

const descendants = (node) => [node, ...node.children.flatMap(descendants)];
const stepStatuses = Object.fromEntries(Object.entries(StepStatus).map(([key, value]) => [key, {
  value,
  label: key.toLowerCase(),
  className: {
    PENDING: 'waiting',
    RUNNING: 'active',
    COMPLETED: 'done',
    FAILED: 'error',
    ACCUMULATING: 'recorded',
    BLOCKED: 'blocked',
    READY: 'ready',
    SKIPPED: 'skipped',
  }[key],
}]));

async function viewer(options = {}) {
  const [html, js] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
  ]);
  const inlineScript = html.match(/<script>([^<]*)<\/script>/)[1]
    .replace('__WORKFLOW_STEPS__', JSON.stringify(WORKFLOW_STEPS.map(({ id, kind, requires, outputs }) => ({ id, ...(kind && { kind }), requires, outputs }))))
    .replace('__STEP_STATUSES__', JSON.stringify(stepStatuses));
  const script = `${inlineScript}\n${js}`;
  const ids = ['folder', 'choose-folder', 'restore-folder', 'refresh-folder', 'initiative', 'message', 'notice', 'content', 'details', 'overlay'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.initiative.disabled = true;
  const document = {
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    createTextNode: (text) => { const node = new Element(); node.textContent = text; return node; },
  };
  vm.runInNewContext(script, { document, ...options });
  return elements;
}

const makeNode = (id, tema, overrides = {}) => ({
  id,
  tema,
  steps: WORKFLOW_STEPS.map(({ id: type, kind }) => ({
    name: type,
    type,
    status: StepStatus.PENDING,
    artifacts: [],
    items: [],
    ...(kind === 'approval' ? { approvedArtifacts: [] } : {}),
    ...overrides[type],
  })),
});

const state = (runId, nodes = [makeNode('node-1', 'Tema de teste')], sources = []) => ({
  schemaVersion: 1,
  workflowId: 'project-lifecycle',
  runId,
  sources,
  nodes,
});
const runFile = (name, data) => ({
  name,
  webkitRelativePath: `projeto/.smith/runs/${name}`,
  text: async () => typeof data === 'string' ? data : JSON.stringify(data),
});
async function selectFiles(elements, files) {
  elements.folder.files = files;
  await elements.folder.listeners.change();
}

test('Schema 1 exibe fontes, temas, status e dependências do workflow', async () => {
  const nodes = [
    makeNode('id-1', 'Tema Alfa', { 'business-epic': { status: StepStatus.COMPLETED } }),
    makeNode('id-2', 'Tema Beta', { 'business-epic': { status: StepStatus.FAILED } }),
  ];
  const sources = [
    { id: 'legacy-code', path: 'workspace/src/legado', kind: 'repository', role: 'legacy', stack: 'Java', scope: 'src', description: 'Código existente.' },
    { id: 'requirements', path: 'workspace/requisitos.md', kind: 'document', role: 'documentation' },
  ];
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('iniciativa', nodes, sources))]);
  assert.match(elements.content.textContent, /Iniciativa: iniciativa/);
  assert.match(elements.content.textContent, /Tema Alfa/);
  assert.match(elements.content.textContent, /Tema Beta/);
  assert.match(elements.content.textContent, /Fontes de Código e Insumos \(2\)/);
  assert.match(elements.content.textContent, /legacy-code/);
  assert.match(elements.content.textContent, /workspace\/src\/legado/);
  assert.match(elements.content.textContent, /scope: src/);
  assert.match(elements.content.textContent, /Documentação/);
  assert.ok(descendants(elements.content).some((item) => item.className === 'source-badge legacy'));
  assert.ok(descendants(elements.content).some((item) => item.className === 'source-badge documentation'));
  assert.equal(descendants(elements.content).filter((item) => item.attributes['data-dependency']).length, 18);
  assert.ok(descendants(elements.content).some((item) => item.classList.contains('done')));
  assert.ok(descendants(elements.content).some((item) => item.classList.contains('error')));
});

test('valida schemaVersion e as coleções canônicas sem fallback de estados', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('v2.json', { ...state('v2'), schemaVersion: 2 })]);
  assert.match(elements.message.textContent, /Schema 1|inválido/i);

  await selectFiles(elements, [runFile('nodes.json', { ...state('sem-nodes'), nodes: {} })]);
  assert.match(elements.message.textContent, /Schema 1|inválido/i);

  const unknown = makeNode('node-3', 'Status incorreto', { 'business-epic': { status: 'invalid' } });
  await selectFiles(elements, [runFile('status.json', state('status', [unknown]))]);
  assert.match(elements.message.textContent, /status|inválido/i);
  assert.equal(elements.content.textContent, '');
});

test('valida arrays de steps, artifacts, items, approvedArtifacts e fontes', async () => {
  const elements = await viewer();
  const invalidSteps = { ...state('x'), nodes: [{ id: 'n', tema: 'Tema', steps: {} }] };
  await selectFiles(elements, [runFile('steps.json', invalidSteps)]);
  assert.match(elements.message.textContent, /Schema 1|inválido/i);

  const invalidStep = makeNode('n', 'Tema');
  invalidStep.steps[0].artifacts = {};
  await selectFiles(elements, [runFile('artifacts.json', state('x', [invalidStep]))]);
  assert.match(elements.message.textContent, /Schema 1|inválido/i);

  const invalidItems = makeNode('n', 'Tema', {
    'technical-refinement': { items: [{ id: 'item', label: 'Item', status: StepStatus.PENDING, artifacts: {} }] },
  });
  await selectFiles(elements, [runFile('items.json', state('x', [invalidItems]))]);
  assert.match(elements.message.textContent, /Schema 1|inválido/i);

  const invalidSource = state('x', [makeNode('n', 'Tema')], {});
  await selectFiles(elements, [runFile('sources.json', invalidSource)]);
  assert.match(elements.message.textContent, /Schema 1|inválido/i);

  const invalidApproval = makeNode('n', 'Tema', { 'validation-gate': { approvedArtifacts: {} } });
  await selectFiles(elements, [runFile('approval.json', state('x', [invalidApproval]))]);
  assert.match(elements.message.textContent, /Schema 1|inválido/i);
});

test('Adicionar Fonte gera dados JSON e instrução CLI sem persistir', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('run-123'))]);
  const addButton = descendants(elements.content).find((item) => item.textContent === '+ Adicionar Fonte');
  await addButton.listeners.click();
  const form = descendants(elements.content).find((item) => item.classList.contains('source-form'));
  const id = form.children.find((item) => item.name === 'id');
  const path = form.children.find((item) => item.name === 'path');
  id.value = 'catalog';
  path.value = 'workspace/src/catalog';
  await form.listeners.submit({ preventDefault() {} });
  const output = descendants(form).find((item) => item.classList.contains('source-output'));
  assert.match(output.textContent, /"id": "catalog"/);
  assert.match(output.textContent, /smith sources add --run-id run-123 < source\.json/);
  assert.equal(elements.message.textContent, '');
  assert.equal(elements.content.textContent.includes('catalog'), true);
});

test('painel de detalhes lê artefatos e snapshots aprovados sem oferecer edição', async () => {
  const artifact = { name: 'business-epic', path: 'workspace/epic.md', groupId: 'pub-1' };
  const approvalArtifact = { name: 'business-epic', path: 'workspace/approved-epic.md' };
  const node = makeNode('node-1', 'Tema', {
    'business-epic': { status: StepStatus.COMPLETED, artifacts: [artifact] },
    'validation-gate': {
      status: StepStatus.COMPLETED,
      approvedArtifacts: [{ stepType: 'business-epic', artifacts: [approvalArtifact] }],
    },
  });
  const elements = await viewer();
  await selectFiles(elements, [
    runFile('a.json', state('run', [node])),
    { name: 'epic.md', webkitRelativePath: 'projeto/workspace/epic.md', text: async () => '# Épico' },
    { name: 'approved-epic.md', webkitRelativePath: 'projeto/workspace/approved-epic.md', text: async () => '# Aprovado' },
  ]);
  const card = descendants(elements.content).find((item) => item.attributes['data-step'] === 'business-epic');
  await card.listeners.click();
  assert.match(elements.details.textContent, /Épico/);
  assert.match(elements.details.textContent, /workspace\/epic\.md/);
  assert.match(elements.details.textContent, /Publicação: pub-1/);
  assert.doesNotMatch(elements.details.textContent, /Salvar|Substituir|Registrar artefato/);
  const gate = descendants(elements.content).find((item) => item.attributes['data-step'] === 'validation-gate');
  await gate.listeners.click();
  assert.match(elements.details.textContent, /Aprovado/);
  assert.match(elements.details.textContent, /workspace\/approved-epic\.md/);
});

test('o viewer não solicita permissão de escrita nem contém funções de mutação de JSON', async () => {
  const [html, js] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(html, /add-initiative|initiative-form/);
  assert.doesNotMatch(js, /createWritable|persistState|renderAddTemaForm|renderAddArtifactForm|renderAddItemForm|errorBanner/);
  assert.match(js, /showDirectoryPicker\(\{ mode: 'read' \}\)/);
  assert.match(js, /function findNode\(state, id\)/);
  assert.match(js, /function findStep\(node, type\)/);
});
