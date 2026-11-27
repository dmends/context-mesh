import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { StepStatus } from '../src/domain/status.mjs';
import { WORKFLOW_ID, WORKFLOW_STEPS } from '../src/workflows/project-lifecycle.mjs';

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
  set textContent(value) {
    this.text = String(value);
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    child.parentElement = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) {
    const matches = (item) => selector.startsWith('.')
      ? item.classList.contains(selector.slice(1))
      : item.tagName.toLowerCase() === selector;
    return descendants(this).slice(1).find(matches) || null;
  }
  remove() {
    this.removed = true;
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
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
  const [html, js, initialPrompt] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
    readFile(new URL('../resources/instructions/initial-project.md', import.meta.url), 'utf8'),
  ]);
  const inlineScript = html.match(/<script>([^<]*)<\/script>/)[1]
    .replace('__WORKFLOW_STEPS__', JSON.stringify(WORKFLOW_STEPS.map(({ id, name, kind, requires, outputs, instructions, promptCommand, recommendedSources }) => ({
      id, name, ...(kind && { kind }), requires, outputs, instructions, promptCommand, recommendedSources,
    }))))
    .replace('__STEP_STATUSES__', JSON.stringify(stepStatuses))
    .replace('__INITIAL_PROJECT_PROMPT__', JSON.stringify(initialPrompt));
  const script = `${inlineScript}\n${js}`;
  const ids = ['folder', 'choose-folder', 'restore-folder', 'refresh-folder', 'theme-toggle', 'initiative', 'initiative-trigger', 'initiative-options', 'message', 'notice', 'content', 'details', 'overlay'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.initiative.disabled = true;
  elements['initiative-options'].hidden = true;
  const documentElement = new Element('html');
  const timers = [];
  let nextTimerId = 0;
  const document = {
    documentElement,
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    createTextNode: (text) => { const node = new Element(); node.textContent = text; return node; },
  };
  vm.runInNewContext(script, {
    document,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout: (callback, delay) => {
      const timer = { id: ++nextTimerId, callback, delay, cleared: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: (id) => {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
    ...options,
  });
  return {
    ...elements,
    documentElement,
    runTimers() {
      for (const timer of timers) if (!timer.cleared) timer.callback();
    },
    timers,
  };
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
    { id: 'new-service', path: 'workspace/src/novo', kind: 'repository', role: 'target', description: 'Serviço novo.' },
  ];
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('iniciativa', nodes, sources))]);
  assert.match(elements.content.textContent, /Iniciativa: iniciativa/);
  assert.match(elements.content.textContent, /Tema Alfa/);
  assert.match(elements.content.textContent, /Tema Beta/);
  const sourcesButton = descendants(elements.content).find((item) => item.className.includes('sources-button'));
  assert.equal(sourcesButton.attributes['aria-label'], 'Fontes de Código e Insumos (3)');
  assert.equal(sourcesButton.children.length, 1);
  assert.equal(descendants(elements.content).filter((item) => item.className === 'source-card').length, 0);
  await sourcesButton.listeners.click();
  assert.equal(elements.details.hidden, false);
  assert.equal(elements.overlay.hidden, false);
  assert.match(elements.details.textContent, /Fontes de Código e Insumos \(3\)/);
  const sourceClose = descendants(elements.details).find((item) => item.attributes['aria-label'] === 'Fechar');
  assert.equal(sourceClose.textContent, '');
  assert.equal(sourceClose.classList.contains('btn-icon'), true);
  assert.match(elements.details.textContent, /legacy-code/);
  assert.match(elements.details.textContent, /workspace\/src\/legado/);
  assert.match(elements.details.textContent, /scope: src/);
  assert.match(elements.details.textContent, /Documentação/);
  assert.ok(descendants(elements.details).some((item) => item.className === 'source-badge legacy'));
  assert.ok(descendants(elements.details).some((item) => item.className === 'source-badge source-kind-badge' && item.textContent === 'Documento'));
  const sourceCards = descendants(elements.details).filter((item) => item.className === 'source-card');
  assert.equal(sourceCards.length, 3);
  assert.ok(sourceCards.every((card) => card.tagName === 'ARTICLE'));
  const targetCard = sourceCards.find((card) => card.textContent.includes('new-service'));
  assert.equal(targetCard.children[0].className, 'source-title');
  assert.equal(targetCard.children[0].tagName, 'SPAN');
  assert.equal(targetCard.children[1].className, 'source-path');
  assert.equal(targetCard.children[2].className, 'source-badge source-kind-badge');
  assert.equal(targetCard.children.at(-1).className, 'source-badge target');
  const firstTheme = descendants(elements.content).find((item) => item.classList.contains('theme'));
  assert.equal(firstTheme.classList.contains('open'), true);
  assert.equal(descendants(firstTheme).find((item) => item.className === 'theme-header').attributes['aria-expanded'], 'true');
  assert.equal(descendants(elements.content).filter((item) => item.className.includes('metric-value')).length, 4);
  assert.equal(descendants(elements.content).filter((item) => item.attributes['data-dependency']).length, 18);
  assert.ok(descendants(elements.content).some((item) => item.classList.contains('done')));
  assert.ok(descendants(elements.content).some((item) => item.classList.contains('error')));
});

test('Alterna e persiste o tema claro/escuro', async () => {
  const defaultTheme = await viewer();
  assert.equal(defaultTheme.documentElement.getAttribute('data-theme'), 'light');

  const values = new Map([['smith-theme', 'light']]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const elements = await viewer({ localStorage: storage });
  assert.equal(elements.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(elements['theme-toggle'].attributes['aria-label'], 'Mudar para tema escuro');

  elements['theme-toggle'].listeners.click();
  assert.equal(elements.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(values.get('smith-theme'), 'dark');
  assert.equal(elements['theme-toggle'].attributes['aria-label'], 'Mudar para tema claro');

  values.set('smith-theme', 'dark');
  const darkTheme = await viewer({ localStorage: storage });
  assert.equal(darkTheme.documentElement.getAttribute('data-theme'), 'dark');
});

test('menu de iniciativas customizado abre e fecha no controle', async () => {
  const elements = await viewer();
  const trigger = elements['initiative-trigger'];
  const options = elements['initiative-options'];
  assert.equal(options.hidden, true);

  trigger.listeners.click();
  assert.equal(options.hidden, false);
  assert.equal(trigger.attributes['aria-expanded'], 'true');

  trigger.listeners.click();
  assert.equal(options.hidden, true);
  assert.equal(trigger.attributes['aria-expanded'], 'false');
});

test('projeto sem diretório de execuções mostra como iniciar sem erro', async () => {
  const project = {
    name: 'projeto-novo',
    queryPermission: async () => 'granted',
    getDirectoryHandle: async () => {
      const error = new Error('Diretório ausente');
      error.name = 'NotFoundError';
      throw error;
    },
  };
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => false },
          createObjectStore() {},
          transaction() {
            return {
              objectStore() {
                return {
                  get() {
                    const stored = {};
                    queueMicrotask(() => {
                      stored.result = project;
                      stored.onsuccess();
                    });
                    return stored;
                  },
                };
              },
            };
          },
        };
        request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    },
  };
  const elements = await viewer({ indexedDB, showDirectoryPicker: async () => project });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.message.children.length, 0);
  assert.match(elements.content.textContent, /Nenhuma execução encontrada/);
  assert.match(elements.content.textContent, /Use o prompt de início para definir a iniciativa e o primeiro tema/);
  assert.ok(descendants(elements.content).some((item) => item.textContent === 'Copiar prompt para iniciar'));
  assert.equal(elements['refresh-folder'].hidden, false);
});

test('projeto sem execuções oferece um prompt conversacional completo para iniciar', async () => {
  let copiedPrompt;
  const elements = await viewer({
    navigator: { clipboard: { writeText: async (text) => { copiedPrompt = text; } } },
  });
  await selectFiles(elements, [{
    name: 'README.md',
    webkitRelativePath: 'orquestrador-saft-workflow/README.md',
    text: async () => '# Projeto',
  }]);

  const copy = descendants(elements.content).find((item) => item.textContent === 'Copiar prompt para iniciar');
  await copy.listeners.click();
  assert.match(copiedPrompt, /^# Iniciar Smith/);
  assert.match(copiedPrompt, /Pergunte ao usuário qual será o nome da iniciativa \(`--run-id`\)/);
  assert.match(copiedPrompt, /Pergunte qual é o primeiro tema de negócio \(`--tema`\)/);
  assert.match(copiedPrompt, /Não adivinhe nem monte o caminho do runtime/);
  assert.match(copiedPrompt, /\$HOME\/Library\/Application Support\/Smith\/versions\/0\.0\.1/);
  assert.match(copiedPrompt, /init \\\n\s+--workspace \. \\\n\s+--run-id "<run-id>" \\\n\s+--tema "<tema>"/);
  assert.match(copiedPrompt, /workspace\/\.discovery\/<run-id>\/input\/business-stories\//);
  assert.match(copiedPrompt, /workspace\/\.discovery\/<run-id>\/input\/transcripts\//);
  assert.doesNotMatch(elements.content.textContent, /Nome da iniciativa|Primeiro tema|Nova iniciativa/);
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
  const sourcesButton = descendants(elements.content).find((item) => item.className.includes('sources-button'));
  await sourcesButton.listeners.click();
  const addButton = descendants(elements.details).find((item) => item.textContent === '+ Adicionar Fonte');
  await addButton.listeners.click();
  const form = descendants(elements.details).find((item) => item.classList.contains('source-form'));
  const id = form.children.find((item) => item.name === 'id');
  const path = form.children.find((item) => item.name === 'path');
  id.value = 'catalog';
  path.value = 'workspace/src/catalog';
  await form.listeners.submit({ preventDefault() {} });
  const output = descendants(form).find((item) => item.classList.contains('source-output'));
  assert.match(output.textContent, /"id": "catalog"/);
  assert.match(output.textContent, /smith sources add --run-id run-123 < source\.json/);
  assert.equal(elements.message.textContent, '');
  assert.equal(elements.details.textContent.includes('catalog'), true);
});

test('raiz selecionada sem JSON não exige acesso de escrita para copiar prompt', async () => {
  const elements = await viewer();
  await selectFiles(elements, [{
    name: 'README.md',
    webkitRelativePath: 'projeto-novo/README.md',
    text: async () => '# Projeto novo',
  }]);

  assert.equal(elements.message.children.length, 0);
  assert.match(elements.content.textContent, /Nenhuma execução encontrada/);
  assert.ok(descendants(elements.content).some((item) => item.textContent === 'Copiar prompt para iniciar'));
  assert.equal(descendants(elements.content).some((item) => item.textContent === 'Nova iniciativa'), false);
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
  let copiedPrompt;
  const elements = await viewer({
    navigator: { clipboard: { writeText: async (text) => { copiedPrompt = text; } } },
  });
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
  const statusRow = descendants(elements.details).find((item) => item.className === 'detail-status-row');
  assert.equal(statusRow.children[0].className, 'status-badge done');
  assert.equal(descendants(elements.details).find((item) => item.className === 'detail-meta-row').children
    .some((item) => item.className.startsWith('status-badge')), false);
  assert.match(elements.details.textContent, /Iniciativa: run/);
  assert.match(elements.details.textContent, /Tema/);
  const copyPrompt = descendants(elements.details).find((item) => item.attributes['aria-label'] === 'Copiar prompt recomendado para esta etapa');
  await copyPrompt.listeners.click();
  const businessEpic = WORKFLOW_STEPS.find(({ id }) => id === 'business-epic');
  assert.equal(copiedPrompt, [
    'Contexto:',
    '- Iniciativa: run',
    '- Tema: Tema',
    '',
    businessEpic.promptCommand,
    '',
    businessEpic.instructions,
    '',
    'Fontes recomendadas:',
    ...businessEpic.recommendedSources.map((source) => `- ${source.replaceAll('<iniciativa>', 'run')}`),
  ].join('\n'));
  assert.match(elements.notice.textContent, /Prompt recomendado copiado\.$/);
  const noticesBeforeSecondCopy = elements.notice.children.length;
  await copyPrompt.listeners.click();
  assert.equal(elements.notice.children.length, noticesBeforeSecondCopy + 1);
  assert.ok(elements.timers.some(({ delay }) => delay === 5000));
  elements.runTimers();
  assert.equal(elements.notice.children.length, 0);
  const close = descendants(elements.details).find((item) => item.attributes['aria-label'] === 'Fechar');
  assert.equal(close.textContent, '');
  assert.equal(close.classList.contains('btn-icon'), true);
  assert.doesNotMatch(elements.details.textContent, /Salvar|Substituir|Registrar artefato/);
  const gate = descendants(elements.content).find((item) => item.attributes['data-step'] === 'validation-gate');
  await gate.listeners.click();
  assert.match(elements.details.textContent, /Aprovado/);
  assert.match(elements.details.textContent, /workspace\/approved-epic\.md/);
  const pendingStep = descendants(elements.content).find((item) => item.attributes['data-step'] === 'as-is-knowledge');
  await pendingStep.listeners.click();
  const pendingStatusRow = descendants(elements.details).find((item) => item.className === 'detail-status-row');
  assert.equal(pendingStatusRow.children[0].className, 'status-badge waiting');
  assert.equal(descendants(elements.details).find((item) => item.className === 'detail-meta-row').children
    .some((item) => item.className.startsWith('status-badge')), false);
});

test('viewer apresenta prompt de iniciação e continua sem permissão de escrita', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /__INITIAL_PROJECT_PROMPT__/);
  assert.doesNotMatch(js, /createWritable|requestPermission\(\{ mode: 'readwrite' \}\)/);
  assert.doesNotMatch(js, /persistState|renderAddTemaForm|renderAddArtifactForm|renderAddItemForm|errorBanner/);
  assert.doesNotMatch(js, /initiative-create-form|createInitialRun/);
  assert.match(js, /showDirectoryPicker\(\{ mode: 'read' \}\)/);
  assert.match(js, /function findNode\(state, id\)/);
  assert.match(js, /function findStep\(node, type\)/);
  assert.match(css, /\.feedback-bar\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\[data-theme="dark"\][\s\S]*--bg-canvas:\s*#1e1f22/);
  assert.match(css, /--border-focus:\s*#4a88c7/);
  assert.match(css, /\.initiative-options\s*\{[^}]*position:\s*absolute/s);
  assert.match(html, /id="initiative-trigger"[^>]*aria-haspopup="listbox"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
