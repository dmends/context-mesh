import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { WORKFLOW_STEPS } from '../src/workflows/project-lifecycle.mjs';

async function viewer(options = {}) {
  const [html, js] = await Promise.all([
    readFile(new URL('../src/report/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/report/workflow.js', import.meta.url), 'utf8'),
  ]);
  const inlineScript = html.match(/<script>([^<]*)<\/script>/)[1]
    .replace('__WORKFLOW_STEPS__', JSON.stringify(WORKFLOW_STEPS.map(({ id, kind, requires, outputs }) => ({ id, ...(kind && { kind }), requires, outputs }))));
  const script = `${inlineScript}\n${js}`;
  class Element {
    constructor(tag = '') {
      this.tagName = tag.toUpperCase(); this.children = []; this.text = ''; this.listeners = {}; this.files = []; this.attributes = {}; this.style = {}; this.value = '';
      const classes = new Set();
      this.classList = {
        add: (...cls) => cls.forEach((c) => classes.add(c)),
        remove: (...cls) => cls.forEach((c) => classes.delete(c)),
        toggle: (c) => { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; },
        contains: (c) => classes.has(c),
      };
    }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
    append(...children) { this.children.push(...children); }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    click() { this.clicked = true; }
  }
  const ids = ['folder', 'choose-folder', 'restore-folder', 'refresh-folder', 'initiative', 'message', 'notice', 'content', 'details', 'add-initiative', 'initiative-form', 'overlay'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.initiative.disabled = true;
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: (text) => { const node = new Element(); node.textContent = text; return node; } };
  vm.runInNewContext(script, { document, JSON, Object, Array, Error, String, ...options });
  return elements;
}

const descendants = (node) => [node, ...node.children.flatMap(descendants)];
const state = (runId, nodes = {}) => ({ schemaVersion: 2, workflowId: 'project-lifecycle', runId, nodes });
const node = (status = 'completed', artifacts = {}) => ({ tema: 'Tema', steps: { 'business-epic': { status, artifacts } } });
const runFile = (name, data) => ({ name, webkitRelativePath: `projeto/.smith/runs/${name}`, text: async () => typeof data === 'string' ? data : JSON.stringify(data) });
const projectFile = (path, text) => ({ name: path.split('/').at(-1), webkitRelativePath: `projeto/${path}`, text: async () => text });
async function selectFiles(elements, files) {
  elements.folder.files = files;
  await elements.folder.listeners.change();
}
async function openStep(elements, id = 'business-epic') {
  const card = descendants(elements.content).find((item) => item.attributes['data-step'] === id);
  assert.ok(card);
  await card.listeners.click();
}
function rootHandle(entries, workspace = {}) {
  const runs = {
    async *values() { yield* entries; },
    getFileHandle: async (name) => entries.find((e) => e.name === name),
  };
  const root = { name: 'projeto', queryPermission: async () => 'granted' };
  root.getDirectoryHandle = async (part) => {
    if (part === 'workspace') return workspace;
    assert.equal(part, '.smith');
    let remaining = ['runs'];
    const level = { getDirectoryHandle: async (name) => {
      assert.equal(name, remaining.shift());
      return remaining.length ? level : runs;
    } };
    return level;
  };
  return root;
}
function storage() {
  const records = new Map();
  const request = (operation) => {
    const result = {};
    queueMicrotask(() => { result.result = operation(); result.onsuccess?.(); });
    return result;
  };
  const db = { transaction: () => ({ objectStore: () => ({
    get: (key) => request(() => records.get(key)), put: (value, key) => request(() => records.set(key, value)),
  }) }) };
  return { records, indexedDB: { open: () => request(() => db) } };
}

test('one project selection displays themes, status and all workflow dependencies', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('iniciativa', {
    first: { ...node('completed'), tema: '<img src=x onerror=alert(1)>' },
    second: { ...node('failed'), tema: 'Outro tema' },
  }))]);
  assert.match(elements.content.textContent, /iniciativa/);
  assert.match(elements.content.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(elements.content.textContent, /Outro tema/);
  assert.match(elements.content.textContent, /Concluída/);
  assert.match(elements.content.textContent, /Falhou/);
  const arrows = descendants(elements.content).filter((item) => item.attributes['data-dependency']);
  assert.equal(arrows.length, 18);
  assert.ok(arrows.some((item) => item.attributes['data-dependency'] === 'as-is-knowledge:discovery-consolidation'));
  assert.equal(descendants(elements.content).some((item) => item.tagName === 'IMG'), false);
});

test('workflow cards expand with available width while connections match their geometry', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('teste', { tema: node() }))]);
  const items = descendants(elements.content);
  const first = items.find((item) => item.attributes['data-step'] === 'business-epic');
  const next = items.find((item) => item.attributes['data-step'] === 'discovery-consolidation');
  const arrow = items.find((item) => item.attributes['data-dependency'] === 'business-epic:discovery-consolidation');
  const graph = items.find((item) => item.className === 'graph');
  const svg = items.find((item) => item.attributes.class === 'connections');
  const graphWidth = parseFloat(graph.style.minWidth);
  assert.equal(graph.style.width, '100%');
  assert.equal(svg.attributes.viewBox, `0 0 ${graphWidth} ${parseFloat(graph.style.height)}`);
  assert.equal(svg.attributes.preserveAspectRatio, 'none');
  const width = parseFloat(first.style.width) * graphWidth / 100;
  const height = parseFloat(first.style.height);
  assert.ok(width >= 147.9 && width <= 148.1, 'cards remain wide enough for their content');
  assert.ok(height <= 80, 'cards are shorter than before');
  assert.ok(width >= height * 2, 'cards use a horizontal shape');
  assert.ok(graphWidth <= 1260, 'workflow fits a typical desktop viewport');
  const firstX = parseFloat(first.style.left) * graphWidth / 100;
  const nextX = parseFloat(next.style.left) * graphWidth / 100;
  assert.ok(nextX - (firstX + width) >= 33.9, 'cards have room between columns');
  assert.ok(parseFloat(first.style.width) * 1500 / 100 > 170, 'cards expand on wider screens');
  assert.ok((parseFloat(next.style.left) - parseFloat(first.style.left) - parseFloat(first.style.width)) * 1500 / 100 > 40, 'spacing grows on wider screens');
  const originX = 156;
  const originY = parseFloat(first.style.top) + height / 2;
  assert.ok(arrow.attributes.d.startsWith(`M ${originX} ${originY} `));
  assert.match(arrow.attributes.d, new RegExp(`L ${Math.round(nextX) - 6} ${parseFloat(next.style.top) + height / 2 - 10}(?: |$)`));
});

test('both initial dependencies enter discovery from above and below without sharing a port', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('teste', { tema: node() }))]);
  const items = descendants(elements.content);
  const graphWidth = parseFloat(items.find((item) => item.className === 'graph').style.minWidth);
  const card = items.find((item) => item.attributes['data-step'] === 'discovery-consolidation');
  const x = Math.round(parseFloat(card.style.left) * graphWidth / 100);
  const width = Math.round(parseFloat(card.style.width) * graphWidth / 100);
  const top = parseFloat(card.style.top);
  const bottom = top + parseFloat(card.style.height);
  const epic = items.find((item) => item.attributes['data-dependency'] === 'business-epic:discovery-consolidation');
  const knowledge = items.find((item) => item.attributes['data-dependency'] === 'as-is-knowledge:discovery-consolidation');
  assert.match(epic.attributes.d, new RegExp(`L ${x - 6} ${top + parseFloat(card.style.height) / 2 - 10}(?: |$)`));
  assert.match(knowledge.attributes.d, new RegExp(`L ${x - 6} ${top + parseFloat(card.style.height) / 2 + 10}(?: |$)`));
});

test('long dependencies enter validation from separate top and bottom ports', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('teste', { tema: node() }))]);
  const items = descendants(elements.content);
  const gate = items.find((item) => item.attributes['data-step'] === 'validation-gate');
  const top = items.find((item) => item.attributes['data-dependency'] === 'discovery-consolidation:validation-gate');
  const bottom = items.find((item) => item.attributes['data-dependency'] === 'tech-solution-specification:validation-gate');
  const graph = items.find((item) => item.className === 'graph');
  const graphWidth = parseFloat(graph.style.minWidth);
  const x = Math.round(parseFloat(gate.style.left) * graphWidth / 100);
  const y = parseFloat(gate.style.top);
  const width = Math.round(parseFloat(gate.style.width) * graphWidth / 100);
  const height = parseFloat(gate.style.height);
  assert.match(top.attributes.d, new RegExp(`L ${x + width / 4} ${y - 6}(?: |$)`));
  assert.match(bottom.attributes.d, new RegExp(`L ${x + 3 * width / 4} ${y + height + 6}(?: |$)`));
});

test('reports malformed JSON and shows unknown status without interpreting prototype properties', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', '{')]);
  assert.match(elements.message.textContent, /inválido/i);
  assert.equal(elements.content.textContent, '');
  await selectFiles(elements, [runFile('b.json', state('teste', { a: node('toString') }))]);
  assert.match(elements.content.textContent, /unknown/);
});

test('lists project JSONs and restores the last selected initiative', async () => {
  const saved = new Map([['smith-last-initiative', 'b.json']]);
  const localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const elements = await viewer({ localStorage });
  await selectFiles(elements, [runFile('a.json', state('Primeira')), runFile('b.json', state('Segunda')), projectFile('workspace/outro.txt', '')]);
  assert.equal(elements.initiative.children.length, 2);
  assert.equal(elements.initiative.value, 'b.json');
  assert.match(elements.content.textContent, /Segunda/);
  elements.initiative.value = 'a.json';
  await elements.initiative.listeners.change();
  assert.match(elements.content.textContent, /Primeira/);
  assert.equal(saved.get('smith-last-initiative'), 'a.json');
});

test('rejects invalid or mixed project roots without replacing the selected project', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('Original'))]);
  await selectFiles(elements, [projectFile('sem-workflow.txt', '')]);
  assert.match(elements.message.textContent, /projeto.*válido|execuções/i);
  assert.match(elements.content.textContent, /Original/);
  await selectFiles(elements, [runFile('a.json', state('Outro')), { ...runFile('b.json', state('Outro')), webkitRelativePath: 'outra/.smith/runs/b.json' }]);
  assert.match(elements.message.textContent, /única raiz/i);
  assert.match(elements.content.textContent, /Original/);
});

test('remembers the project handle and restores it without additional authorization', async () => {
  const { records, indexedDB } = storage();
  const file = runFile('one.json', state('Persistida'));
  const root = rootHandle([{ kind: 'file', name: file.name, getFile: async () => file }]);
  const first = await viewer({ indexedDB, showDirectoryPicker: async () => root });
  await first['choose-folder'].listeners.click();
  assert.equal(records.get('project-root'), root);
  assert.match(first.content.textContent, /Persistida/);
  const second = await viewer({ indexedDB, showDirectoryPicker: async () => root });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(second.content.textContent, /Persistida/);
});

test('rejects a selected directory without a workflow runs folder', async () => {
  const { records, indexedDB } = storage();
  const invalid = { name: 'errado', getDirectoryHandle: async () => { throw new Error('inexistente'); } };
  const elements = await viewer({ indexedDB, showDirectoryPicker: async () => invalid });
  await elements['choose-folder'].listeners.click();
  assert.match(elements.message.textContent, /projeto inválido.*execuções/i);
  assert.equal(records.has('project-root'), false);
  assert.equal(elements.initiative.disabled, true);
});

test('reads an artifact through the same project directory handle', async () => {
  const file = runFile('one.json', state('Projeto', { tema: node('completed', { epic: { path: 'workspace/epico.md' } }) }));
  const root = rootHandle(
    [{ kind: 'file', name: file.name, getFile: async () => file }],
    { getFileHandle: async (name) => {
      assert.equal(name, 'epico.md');
      return { getFile: async () => projectFile('workspace/epico.md', '# Teste') };
    } },
  );
  const elements = await viewer({ showDirectoryPicker: async () => root });
  await elements['choose-folder'].listeners.click();
  await openStep(elements);
  assert.ok(descendants(elements.details).some((item) => item.tagName === 'H1' && item.textContent === 'Teste'));
});

test('requests renewed project permission before reading runs', async () => {
  const { records, indexedDB } = storage();
  const file = runFile('one.json', state('Autorizada'));
  const root = rootHandle([{ kind: 'file', name: file.name, getFile: async () => file }]);
  root.queryPermission = async () => 'prompt';
  root.requestPermission = async () => 'granted';
  records.set('project-root', root);
  const elements = await viewer({ indexedDB, showDirectoryPicker: async () => root });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(elements['restore-folder'].hidden, false);
  await elements['restore-folder'].listeners.click();
  assert.match(elements.content.textContent, /Autorizada/);
});

test('does not replace a more recent initiative with a slower file handle', async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const initial = runFile('a.json', state('Inicial'));
  const latest = runFile('c.json', state('Recente'));
  const root = rootHandle([
    { kind: 'file', name: 'a.json', getFile: async () => initial },
    { kind: 'file', name: 'b.json', getFile: async () => slow },
    { kind: 'file', name: 'c.json', getFile: async () => latest },
  ]);
  const elements = await viewer({ showDirectoryPicker: async () => root });
  await elements['choose-folder'].listeners.click();
  elements.initiative.value = 'b.json';
  const pending = elements.initiative.listeners.change();
  elements.initiative.value = 'c.json';
  await elements.initiative.listeners.change();
  release(runFile('b.json', state('Antiga')));
  await pending;
  assert.match(elements.content.textContent, /Recente/);
  assert.doesNotMatch(elements.content.textContent, /Antiga/);
});

test('formats Markdown safely from the same authorized project', async () => {
  const artifact = { epic: { path: 'workspace/epico.md', sha256: '0'.repeat(64) } };
  const markdown = '# Título\n\n**Negrito** e `código`\n\n- Primeiro\n- Segundo\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```js\nalert(1)\n```\n\n<script>alert(1)</script>\n\n[Referência](https://example.test/a)\n\n![imagem](https://example.test/a)';
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('Iniciativa', { tema: node('completed', artifact) })), projectFile('workspace/epico.md', markdown)]);
  await openStep(elements);
  const rendered = descendants(elements.details);
  assert.ok(rendered.some((item) => item.tagName === 'H1' && item.textContent === 'Título'));
  assert.ok(rendered.some((item) => item.tagName === 'STRONG' && item.textContent === 'Negrito'));
  assert.ok(rendered.some((item) => item.tagName === 'UL' && item.textContent.includes('Primeiro')));
  assert.ok(rendered.some((item) => item.tagName === 'TABLE'));
  assert.ok(rendered.some((item) => item.tagName === 'CODE' && item.textContent.includes('alert(1)')));
  assert.equal(rendered.some((item) => item.tagName === 'SCRIPT' || item.tagName === 'IMG'), false);
  assert.ok(rendered.some((item) => item.tagName === 'SPAN' && item.textContent === 'Referência'));
  assert.equal(rendered.some((item) => item.tagName === 'A'), false);
  assert.equal(rendered.some((item) => item.tagName === 'BUTTON' && /ler artefato/i.test(item.textContent)), false);
});

test('rejects an artifact path escaping the authorized project', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('teste', { tema: node('completed', { epic: { path: '../secret', sha256: '0'.repeat(64) } }) }))]);
  await openStep(elements);
  assert.match(elements.details.textContent, /caminho inválido/i);
  assert.equal(descendants(elements.details).some((item) => item.attributes['data-artifact']), false);
});

test('reports an artifact missing from the project', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('teste', { tema: node('completed', { epic: { path: 'workspace/ausente.md' } }) }))]);
  await openStep(elements);
  assert.match(elements.details.textContent, /não foi possível ler.*não encontrado/i);
});

test('closes the old artifact panel when a newly selected project has no JSON', async () => {
  const elements = await viewer();
  await selectFiles(elements, [runFile('a.json', state('teste', { tema: node() }))]);
  await openStep(elements);
  assert.equal(elements.details.hidden, false);
  await selectFiles(elements, [projectFile('.smith/runs/not-a-json.html', '')]);
  assert.equal(elements.details.hidden, true);
  assert.match(elements.notice.textContent, /Nenhum arquivo JSON/i);
});

test('automatically loads every artifact and reports errors independently', async () => {
  const elements = await viewer();
  const artifacts = { primeiro: { path: 'workspace/a.md' }, segundo: { path: 'workspace/ausente.md' }, terceiro: { path: 'workspace/c.md' } };
  await selectFiles(elements, [
    runFile('a.json', state('teste', { tema: node('completed', artifacts) })),
    projectFile('workspace/a.md', '# Primeiro'),
    projectFile('workspace/c.md', '# Terceiro'),
  ]);
  await openStep(elements);
  assert.match(elements.details.textContent, /Primeiro/);
  assert.match(elements.details.textContent, /Terceiro/);
  assert.match(elements.details.textContent, /não foi possível ler.*não encontrado/i);
});

test('decision-record with multiple artifacts displays all files in accordion list without combo', async () => {
  const elements = await viewer();
  const decisions = [
    { 'decision-record': { path: 'workspace/001-adr.md' } },
    { 'decision-record': { path: 'workspace/002-adr.md' } },
  ];
  const testNode = {
    tema: 'Tema',
    steps: {
      'decision-record': { status: 'completed', artifacts: decisions },
    },
  };
  await selectFiles(elements, [
    runFile('a.json', state('teste', { tema: testNode })),
    projectFile('workspace/001-adr.md', '# ADR 1'),
    projectFile('workspace/002-adr.md', '# ADR 2'),
  ]);
  await openStep(elements, 'decision-record');
  const detailsItems = descendants(elements.details);
  const selectElements = detailsItems.filter((item) => item.tagName === 'SELECT');
  assert.equal(selectElements.length, 0);
  const artifactElements = detailsItems.filter((item) => item.className === 'artifact');
  assert.equal(artifactElements.length, 2);
  for (const art of artifactElements) {
    assert.equal(art.className.includes('open'), false);
  }
  assert.match(elements.details.textContent, /001-adr\.md/);
  assert.match(elements.details.textContent, /002-adr\.md/);
});

test('validation-gate displays approved artifacts without invalid path error', async () => {
  const elements = await viewer();
  const testNode = {
    tema: 'Tema',
    steps: {
      'validation-gate': {
        status: 'completed',
        artifacts: {},
        approvedArtifacts: {
          'discovery-consolidation': { path: 'workspace/consolidation.md' },
          'tech-solution-specification': { path: 'workspace/spec.md' },
          'decision-record': { path: 'workspace/decision.md' },
        },
      },
    },
  };
  await selectFiles(elements, [
    runFile('a.json', state('teste', { tema: testNode })),
    projectFile('workspace/consolidation.md', '# Consolidado'),
    projectFile('workspace/spec.md', '# Especificacao'),
    projectFile('workspace/decision.md', '# Decisao'),
  ]);
  await openStep(elements, 'validation-gate');
  assert.doesNotMatch(elements.details.textContent, /caminho inválido/i);
  assert.match(elements.details.textContent, /workspace\/consolidation\.md/);
  assert.match(elements.details.textContent, /workspace\/spec\.md/);
  assert.match(elements.details.textContent, /workspace\/decision\.md/);
});

test('technical-refinement displays both main artifact and story detail artifacts with markdown content', async () => {
  const elements = await viewer();
  const testNode = {
    tema: 'Tema',
    steps: {
      'technical-refinement': {
        status: 'completed',
        artifacts: {
          'technical-refinement': {
            path: 'workspace/001-refinamento-geral.md',
          },
        },
        items: {
          'us-001': {
            label: 'US-001 — Submissao da Proposta',
            status: 'completed',
            artifacts: {
              'technical-refinement': {
                path: 'workspace/002-refinamento-us001.md',
              },
            },
          },
        },
      },
    },
  };
  await selectFiles(elements, [
    runFile('a.json', state('teste', { tema: testNode })),
    projectFile('workspace/001-refinamento-geral.md', '# Geral de Refinamento'),
    projectFile('workspace/002-refinamento-us001.md', '# Detalhes US 001'),
  ]);
  await openStep(elements, 'technical-refinement');
  assert.doesNotMatch(elements.details.textContent, /caminho inválido/i);
  assert.match(elements.details.textContent, /workspace\/001-refinamento-geral\.md/);
  assert.match(elements.details.textContent, /Geral de Refinamento/);
  assert.match(elements.details.textContent, /US-001/);
  assert.match(elements.details.textContent, /workspace\/002-refinamento-us001\.md/);
  assert.match(elements.details.textContent, /Detalhes US 001/);
});
