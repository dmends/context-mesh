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
    const parts = selector.trim().split(/\s+/);
    const target = parts[parts.length - 1];
    const matches = (item) => {
      if (target.startsWith('.')) return item.classList.contains(target.slice(1));
      if (target.includes('.')) {
        const [tag, cls] = target.split('.');
        return (!tag || item.tagName.toLowerCase() === tag.toLowerCase()) && item.classList.contains(cls);
      }
      return item.tagName.toLowerCase() === target.toLowerCase();
    };
    return descendants(this).slice(1).find(matches) || null;
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const target = parts[parts.length - 1];
    const matches = (item) => {
      if (target.startsWith('.')) return item.classList.contains(target.slice(1));
      if (target.includes('.')) {
        const [tag, cls] = target.split('.');
        return (!tag || item.tagName.toLowerCase() === tag.toLowerCase()) && item.classList.contains(cls);
      }
      return item.tagName.toLowerCase() === target.toLowerCase();
    };
    return descendants(this).slice(1).filter(matches);
  }
  closest(selector) {
    const isClass = selector.startsWith('.');
    const target = isClass ? selector.slice(1) : selector.toUpperCase();
    let cur = this;
    while (cur) {
      if (isClass && cur.classList && cur.classList.contains(target)) return cur;
      if (!isClass && cur.tagName === target) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  prepend(...children) {
    for (let i = children.length - 1; i >= 0; i--) {
      this.insertBefore(children[i], this.children[0]);
    }
  }
  cloneNode(deep = true) {
    const clone = new Element(this.tagName.toLowerCase());
    clone.text = this.text;
    clone.attributes = { ...this.attributes };
    clone._className = this._className;
    clone.style = { ...this.style };
    clone.dataset = { ...this.dataset };
    if (deep) {
      for (const child of this.children) {
        clone.append(child.cloneNode(true));
      }
    }
    return clone;
  }
  get innerHTML() {
    return this.children.map((c) => `<${c.tagName.toLowerCase()}>${c.textContent}</${c.tagName.toLowerCase()}>`).join('') || this.text;
  }
  set innerHTML(val) {
    this.text = String(val);
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    if (this.text.includes("<svg")) {
      const svg = new Element("svg");
      svg.text = this.text;
      this.append(svg);
    }
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
  label: key === 'IN_PROGRESS' ? 'Progresso' : key.toLowerCase(),
  className: {
    PENDING: 'waiting',
    RUNNING: 'active',
    IN_PROGRESS: 'active',
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
  const body = new Element('body');
  documentElement.append(body);
  const document = {
    documentElement,
    body,
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    createTextNode: (text) => { const node = new Element(); node.textContent = text; return node; },
    addEventListener: (event, cb) => { (document.listeners = document.listeners || {})[event] = cb; },
    removeEventListener: (event) => { if (document.listeners) delete document.listeners[event]; },
  };
  vm.runInNewContext(script, {
    document,
    TextEncoder,
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
    makeNode('id-1', 'Tema Alfa', {
      'business-epic': { status: StepStatus.COMPLETED },
      'tech-solution-specification': { status: StepStatus.IN_PROGRESS },
    }),
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
  assert.equal(firstTheme.classList.contains('open'), false);
  const firstHeader = descendants(firstTheme).find((item) => item.className === 'theme-header');
  assert.equal(firstHeader.attributes['aria-expanded'], 'false');
  const progressBadge = descendants(firstTheme).find((item) => item.classList.contains('theme-progress-badge'));
  assert.ok(progressBadge);
  assert.match(progressBadge.textContent, /^\d+%$/);
  assert.equal(descendants(elements.content).filter((item) => item.className.includes('metric-value')).length, 5);
  assert.ok(descendants(elements.content).some((item) =>
    item.className === 'metric-label' && item.textContent === 'Progresso'));
  assert.equal(descendants(elements.content).filter((item) => item.attributes['data-dependency']).length, 18);
  assert.ok(descendants(elements.content).some((item) => item.classList.contains('done')));
  assert.ok(descendants(elements.content).some((item) => item.classList.contains('error')));
});

test('Alterna e persiste o tema claro/escuro', async () => {
  const defaultTheme = await viewer();
  assert.equal(defaultTheme.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(defaultTheme['theme-toggle'].attributes['aria-label'], 'Mudar para tema claro');

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

  elements['theme-toggle'].listeners.click();
  assert.equal(elements.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(values.get('smith-theme'), 'light');
  assert.equal(elements['theme-toggle'].attributes['aria-label'], 'Mudar para tema escuro');

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
    businessEpic.promptCommand,
    '',
    'Contexto:',
    '- Iniciativa: run',
    '- Tema: Tema',
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

test('Melhorias de Usabilidade e Layout do Painel (US-001 a US-004)', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.css', import.meta.url), 'utf8'),
  ]);

  // US-001: Grid de Métricas em 5 Colunas e breakpoints
  assert.match(css, /\.metrics-row\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(css, /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.metrics-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.metrics-row\s*\{[^}]*grid-template-columns:\s*1fr;/);

  // US-002: data-theme="dark" padrão no HTML
  assert.match(html, /<html\s+lang="pt-br"\s+data-theme="dark">/);

  // US-003 & US-004: Renderização de temas, acordeões fechados e badges de progresso
  const allCompletedOverrides = Object.fromEntries(
    WORKFLOW_STEPS.map(({ id: type }) => [type, { status: StepStatus.COMPLETED }])
  );
  const halfCompletedOverrides = Object.fromEntries(
    WORKFLOW_STEPS.slice(0, 4).map(({ id: type }) => [type, { status: StepStatus.COMPLETED }])
  );
  const nodes = [
    makeNode('node-100', 'Tema Concluído', allCompletedOverrides),
    makeNode('node-50', 'Tema Parcial', halfCompletedOverrides),
    makeNode('node-0', 'Tema Vazio'),
  ];

  const elements = await viewer();
  await selectFiles(elements, [runFile('test-run.json', state('test-init', nodes))]);

  const renderedThemes = descendants(elements.content).filter((item) => item.classList.contains('theme'));
  assert.equal(renderedThemes.length, 3);

  // US-003: Todos os temas devem iniciar fechados (sem classe open, aria-expanded="false")
  for (const themeEl of renderedThemes) {
    assert.equal(themeEl.classList.contains('open'), false);
    const header = descendants(themeEl).find((item) => item.className === 'theme-header');
    assert.equal(header.attributes['aria-expanded'], 'false');
    const subtitle = descendants(header).find((item) => item.tagName === 'P');
    assert.equal(subtitle.textContent, 'Clique para expandir o fluxo');

    // Ao clicar, alterna para open
    header.listeners.click();
    assert.equal(themeEl.classList.contains('open'), true);
    assert.equal(header.attributes['aria-expanded'], 'true');
    assert.equal(subtitle.textContent, 'Selecione uma etapa para consultar seus artefatos');

    // Ao clicar novamente, fecha
    header.listeners.click();
    assert.equal(themeEl.classList.contains('open'), false);
    assert.equal(header.attributes['aria-expanded'], 'false');
    assert.equal(subtitle.textContent, 'Clique para expandir o fluxo');
  }

  // US-004: Progresso de 100%, 50% e 0%
  const badge100 = descendants(renderedThemes[0]).find((item) => item.classList.contains('theme-progress-badge'));
  assert.equal(badge100.textContent, '100%');
  assert.equal(badge100.classList.contains('badge-success'), true);

  const badge50 = descendants(renderedThemes[1]).find((item) => item.classList.contains('theme-progress-badge'));
  assert.equal(badge50.textContent, '50%');
  assert.equal(badge50.classList.contains('badge-progress'), true);

  const badge0 = descendants(renderedThemes[2]).find((item) => item.classList.contains('theme-progress-badge'));
  assert.equal(badge0.textContent, '0%');
  assert.equal(badge0.classList.contains('badge-success'), false);
  assert.equal(badge0.classList.contains('badge-progress'), false);
});

test('Renderização de Diagramas no Painel (US-001 a US-005)', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.css', import.meta.url), 'utf8'),
  ]);

  // US-002: index.html inclui o script de vendor mermaid.min.js
  assert.match(html, /<script\s+src="vendor\/mermaid\.min\.js">\s*<\/script>/);

  // US-004 & US-005 & US-001: classes CSS de diagramas presentes
  assert.match(css, /\.diagram-container/);
  assert.match(css, /\.diagram-actions/);
  assert.match(css, /\.diagram-modal/);
  assert.match(css, /\.diagram-error/);
  assert.match(css, /\.diagram-offline-fallback/);

  // Preparação de contexto mock com mermaid
  let mermaidInitializedWith = null;
  let mermaidRunNodes = [];
  const mermaidMock = {
    initialize: (cfg) => { mermaidInitializedWith = cfg; },
    parse: async (code) => {
      if (code.includes('SYNTAX_ERROR')) throw new Error('Syntax error in graph');
      return true;
    },
    run: async ({ nodes }) => {
      mermaidRunNodes.push(...nodes);
      for (const n of nodes) {
        const svg = new Element('svg');
        svg.text = '<svg content>';
        n.append(svg);
      }
    },
    render: async (id, code) => {
      if (code.includes('SYNTAX_ERROR')) throw new Error('Syntax error in graph');
      return { svg: '<svg content></svg>' };
    },
  };

  let copiedText = '';
  const viewerInstance = await viewer({
    mermaid: mermaidMock,
    navigator: {
      clipboard: {
        writeText: async (t) => { copiedText = t; },
      },
    },
  });

  // US-001: Reconhecimento de Linguagens no Parser renderMarkdown
  // Cria nó com markdown contendo múltiplos blocos
  const sampleMarkdown = [
    '# Documento de Teste',
    '```mermaid',
    'flowchart TD',
    'A-->B',
    '```',
    '```plantuml',
    '@startuml',
    'class User',
    '@enduml',
    '```',
    '```puml',
    'class Order',
    '```',
    '```',
    '@startuml',
    'class Account',
    '@enduml',
    '```',
    '```javascript',
    'const a = 1;',
    '```',
    '```mermaid',
    'SYNTAX_ERROR invalid',
    '```',
  ].join('\n');

  const nodes = [
    makeNode('test-diagram-node', 'Tema de Diagramas', {
      'business-epic': {
        status: StepStatus.COMPLETED,
        artifacts: [{ name: 'diag.md', path: 'workspace/diag.md' }],
      },
    }),
  ];

  await selectFiles(viewerInstance, [
    runFile('run-diag.json', state('diag-init', nodes)),
    {
      name: 'diag.md',
      webkitRelativePath: 'projeto/workspace/diag.md',
      text: async () => sampleMarkdown,
    },
  ]);

  // Clica no tema e na etapa business-epic para abrir os detalhes
  const themeHeader = descendants(viewerInstance.content).find((item) => item.className === 'theme-header');
  themeHeader.listeners.click();

  const epicStep = descendants(viewerInstance.content).find((item) => item.attributes['data-step'] === 'business-epic');
  await epicStep.listeners.click();

  // Aguarda os loads assíncronos
  await new Promise((r) => setTimeout(r, 50));

  // 1. Validação US-001 (Parser)
  const mermaidContainers = descendants(viewerInstance.details).filter((item) => item.classList && item.classList.contains('mermaid-container'));
  assert.equal(mermaidContainers.length, 2); // 1 válido + 1 com erro

  const plantumlContainers = descendants(viewerInstance.details).filter((item) => item.classList && item.classList.contains('plantuml-container'));
  assert.equal(plantumlContainers.length, 3); // plantuml, puml e @startuml

  const codeBlocks = descendants(viewerInstance.details).filter((item) => item.classList && item.classList.contains('language-javascript'));
  assert.equal(codeBlocks.length, 1);

  // 2. Validação US-002 (Mermaid Render & Tema)
  assert.ok(mermaidInitializedWith);
  assert.equal(mermaidInitializedWith.theme, 'dark'); // tema inicial é dark
  const validMermaidEl = mermaidContainers[0].querySelector('.mermaid');
  assert.ok(validMermaidEl.querySelector('svg'));

  // Alterna o tema e verifica re-renderização
  viewerInstance['theme-toggle'].listeners.click();
  assert.equal(mermaidInitializedWith.theme, 'default');

  // 3. Validação US-003 (PlantUML Encoder & fallback)
  for (const pumlContainer of plantumlContainers) {
    const pumlEl = pumlContainer.querySelector('.plantuml');
    const img = pumlEl.querySelector('img');
    assert.ok(img);
    assert.match(img.getAttribute('src'), /https:\/\/www\.plantuml\.com\/plantuml\/svg\//);
  }

  // 4. Validação US-004 (Controles: Copiar e Zoom)
  const firstActions = mermaidContainers[0].querySelector('.diagram-actions');
  assert.ok(firstActions);
  const copyBtn = firstActions.querySelector('.btn-copy-diagram');
  assert.ok(copyBtn);
  await copyBtn.listeners.click();
  assert.match(copiedText, /flowchart TD/);

  // Zoom / Modal
  const zoomBtn = firstActions.querySelector('.btn-zoom-diagram');
  assert.ok(zoomBtn);
  zoomBtn.listeners.click();

  const modal = descendants(viewerInstance.documentElement).find((item) => item.classList && item.classList.contains('diagram-modal'));
  assert.ok(modal);
  const closeBtn = modal.querySelector('.diagram-modal-controls').children.at(-1);
  closeBtn.listeners.click();
  assert.equal(modal.removed, true);

  // 5. Validação US-005 (Resiliência / Erro de sintaxe)
  const errorMermaidContainer = mermaidContainers[1];
  const errorCard = errorMermaidContainer.querySelector('.diagram-error');
  assert.ok(errorCard);
  assert.match(errorCard.textContent, /Erro na sintaxe do diagrama Mermaid/);
  assert.match(errorCard.textContent, /Syntax error in graph/);
});

test('Destaque de Sintaxe e Formatação de Código no Painel (US-001 a US-004)', async () => {
  const [html, js, css] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.css', import.meta.url), 'utf8'),
  ]);

  // US-002 & US-004: index.html inclui estilos e scripts vendor
  assert.match(html, /<link\s+rel="stylesheet"\s+href="vendor\/atom-one-dark\.min\.css">/);
  assert.match(html, /<script\s+src="vendor\/highlight\.min\.js">\s*<\/script>/);
  assert.match(html, /<script\s+src="vendor\/highlightjs-line-numbers\.min\.js">\s*<\/script>/);

  // US-001, US-003 & US-004: classes CSS presentes
  assert.match(css, /\.markdown\s+\.code-block-wrapper/);
  assert.match(css, /\.markdown\s+\.code-block-header/);
  assert.match(css, /\.markdown\s+\.code-lang-badge/);
  assert.match(css, /\.markdown\s+\.btn-copy-code/);
  assert.match(css, /\.markdown\s+\.code-block-wrapper\s+table\.hljs-ln/);
  assert.match(css, /\.markdown\s+\.code-block-wrapper\s+td\.hljs-ln-numbers/);
  assert.match(css, /user-select:\s*none/);

  // Mocks para hljs e clipboard
  const highlightedBlocks = [];
  const lineNumberedBlocks = [];
  const hljsMock = {
    highlightElement: (block) => {
      highlightedBlocks.push(block);
    },
    lineNumbersBlock: (block) => {
      lineNumberedBlocks.push(block);
    },
  };

  let copiedText = '';
  const viewerInstance = await viewer({
    hljs: hljsMock,
    navigator: {
      clipboard: {
        writeText: async (t) => { copiedText = t; },
      },
    },
  });

  const sampleMarkdown = [
    '# Especificação Técnica',
    '```javascript',
    'const smith = {',
    '  engine: "active"',
    '};',
    '```',
    '```json',
    '{',
    '  "name": "smith",',
    '  "version": "1.0.0"',
    '}',
    '```',
    '```',
    'texto puro sem linguagem',
    '```',
    '```mermaid',
    'flowchart TD',
    'A-->B',
    '```',
  ].join('\n');

  const nodes = [
    makeNode('test-syntax-node', 'Tema de Realce', {
      'tech-solution-specification': {
        status: StepStatus.COMPLETED,
        artifacts: [{ name: 'spec.md', path: 'workspace/spec.md' }],
      },
    }),
  ];

  await selectFiles(viewerInstance, [
    runFile('run-syntax.json', state('syntax-init', nodes)),
    {
      name: 'spec.md',
      webkitRelativePath: 'projeto/workspace/spec.md',
      text: async () => sampleMarkdown,
    },
  ]);

  const themeHeader = descendants(viewerInstance.content).find((item) => item.className === 'theme-header');
  themeHeader.listeners.click();

  const specStep = descendants(viewerInstance.content).find((item) => item.attributes['data-step'] === 'tech-solution-specification');
  await specStep.listeners.click();
  await new Promise((r) => setTimeout(r, 50));

  // 1. Validação US-001 (Roteador de Cercas Unificado)
  const codeWrappers = descendants(viewerInstance.details).filter((item) => item.classList && item.classList.contains('code-block-wrapper'));
  assert.equal(codeWrappers.length, 3); // javascript, json, plaintext

  const jsBlock = codeWrappers[0].querySelector('code');
  assert.ok(jsBlock.classList.contains('hljs'));
  assert.ok(jsBlock.classList.contains('language-javascript'));

  const jsonBlock = codeWrappers[1].querySelector('code');
  assert.ok(jsonBlock.classList.contains('hljs'));
  assert.ok(jsonBlock.classList.contains('language-json'));

  const plainBlock = codeWrappers[2].querySelector('code');
  assert.ok(plainBlock.classList.contains('hljs'));
  assert.ok(plainBlock.classList.contains('language-plaintext'));

  // Diagrama permanece separado
  const mermaidContainers = descendants(viewerInstance.details).filter((item) => item.classList && item.classList.contains('mermaid-container'));
  assert.equal(mermaidContainers.length, 1);
  assert.equal(mermaidContainers[0].querySelector('code'), null);

  // 2. Validação US-002 (Realce de Sintaxe com Highlight.js)
  assert.equal(highlightedBlocks.length, 3);

  // 3. Validação US-003 (Cabeçalho com Badge e Botão Copiar)
  for (const wrapper of codeWrappers) {
    const header = wrapper.querySelector('.code-block-header');
    assert.ok(header);
    const badge = header.querySelector('.code-lang-badge');
    assert.ok(badge);
    const copyBtn = header.querySelector('.btn-copy-code');
    assert.ok(copyBtn);
  }

  // Testa cópia no primeiro bloco (JavaScript)
  const firstCopyBtn = codeWrappers[0].querySelector('.btn-copy-code');
  await firstCopyBtn.listeners.click();
  assert.match(copiedText, /const smith = {/);
  assert.equal(firstCopyBtn.textContent, 'Copiado!');
  assert.ok(firstCopyBtn.classList.contains('copied'));

  // 4. Validação US-004 (Numeração de Linhas)
  assert.equal(lineNumberedBlocks.length, 3);
});
