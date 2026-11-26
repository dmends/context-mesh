'use strict';
const labels = {
  'business-epic': 'Épico de negócio',
  'as-is-knowledge': 'Knowledge As-Is',
  'discovery-consolidation': 'Consolidado',
  'decision-record': 'Decisões',
  'validation-gate': 'Gate de validação',
  'tech-solution-specification': 'Solução',
  'story-task-breakdown': 'Histórias',
  'technical-refinement': 'Refinamento',
};
const statusEntries = Object.entries(stepStatuses);
const statuses = Object.fromEntries(statusEntries.map(([key, value]) => [value.value, value]));
const validStatuses = new Set(statusEntries.map(([, value]) => value.value));
const folderInput = document.getElementById('folder');
const chooseFolder = document.getElementById('choose-folder');
const restoreFolder = document.getElementById('restore-folder');
const refreshFolder = document.getElementById('refresh-folder');
const initiative = document.getElementById('initiative');
const message = document.getElementById('message');
const notice = document.getElementById('notice');
const content = document.getElementById('content');
const details = document.getElementById('details');
const overlay = document.getElementById('overlay');
const lastInitiativeKey = 'smith-last-initiative';
let directory;
let project;
let projectFiles;
let files = [];
let loadSequence = 0;
let detailSequence = 0;
let currentStateObj = null;

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function svgIcon(pathData) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  return svg;
}

function findNode(state, id) {
  return state.nodes.find((node) => node.id === id);
}

function findStep(node, type) {
  return node.steps.find((step) => step.type === type);
}

function validateArtifact(artifact) {
  return artifact && typeof artifact.name === 'string' && typeof artifact.path === 'string' &&
    (artifact.groupId === undefined || typeof artifact.groupId === 'string');
}

function validateState(state) {
  const valid = state && state.schemaVersion === 1 && state.workflowId === 'project-lifecycle' &&
    typeof state.runId === 'string' && Array.isArray(state.sources) && Array.isArray(state.nodes);
  if (!valid) throw new Error('Estado inválido ou incompatível: esperado Schema 1 com fontes e nós em arrays.');

  const sourcesValid = state.sources.every((source) => source && typeof source.id === 'string' &&
    typeof source.path === 'string' && ['repository', 'document'].includes(source.kind) &&
    ['legacy', 'target', 'reference', 'integration', 'documentation'].includes(source.role) &&
    ['stack', 'scope', 'description'].every((field) => source[field] === undefined || typeof source[field] === 'string'));
  const nodesValid = state.nodes.every((node) => node && typeof node.id === 'string' &&
    typeof node.tema === 'string' && Array.isArray(node.steps) && node.steps.every((step) =>
      step && typeof step.type === 'string' && typeof step.name === 'string' &&
      validStatuses.has(step.status) && Array.isArray(step.artifacts) &&
      step.artifacts.every(validateArtifact) && Array.isArray(step.items) &&
      step.items.every((item) => item && typeof item.id === 'string' &&
        typeof item.label === 'string' && validStatuses.has(item.status) &&
        Array.isArray(item.artifacts) && item.artifacts.every(validateArtifact)) &&
      (step.approvedArtifacts === undefined || (Array.isArray(step.approvedArtifacts) &&
        step.approvedArtifacts.every((approved) => approved && typeof approved.stepType === 'string' &&
          Array.isArray(approved.artifacts) && approved.artifacts.every(validateArtifact))))) &&
    steps.every((definition) => node.steps.some((step) => step.type === definition.id)));
  if (!sourcesValid || !nodesValid) {
    throw new Error('Estado inválido: fontes, nós, etapas, status ou artefatos não seguem o Schema 1.');
  }
}

function statusBadge(status) {
  const definition = statuses[status];
  const badge = element('span', '', `status-badge ${definition.className}`);
  badge.append(element('span', '', 'dot'), element('span', definition.label));
  return badge;
}

function rankSteps() {
  const ranks = new Map();
  for (const step of steps) {
    const dependencyRanks = step.requires.map((id) => ranks.get(id));
    ranks.set(step.id, dependencyRanks.length ? Math.max(...dependencyRanks) + 1 : 0);
  }
  return ranks;
}

function diagram(node) {
  const cardWidth = 148;
  const cardHeight = 68;
  const columnWidth = 182;
  const rowHeight = cardHeight * 2;
  const ranks = rankSteps();
  const byRank = new Map();
  for (const step of steps) {
    const rank = ranks.get(step.id);
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(step);
  }
  const maxRank = Math.max(...ranks.values());
  const maxParallel = Math.max(...[...byRank.values()].map((group) => group.length), 2);
  const width = maxRank * columnWidth + cardWidth + 16;
  const height = maxParallel * rowHeight + 60;
  const centerY = (height - cardHeight) / 2;
  const topY = Math.round((height - cardHeight - rowHeight) / 2);
  const positions = new Map();
  for (const step of steps) {
    const peers = byRank.get(ranks.get(step.id));
    positions.set(step.id, {
      x: 8 + ranks.get(step.id) * columnWidth,
      y: peers.length === 1 ? centerY : topY + peers.indexOf(step) * rowHeight,
    });
  }

  const scroll = element('div', '', 'graph-scroll');
  const graph = element('div', '', 'graph');
  graph.style.width = '100%';
  graph.style.minWidth = `${width}px`;
  graph.style.height = `${height}px`;
  const connections = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  connections.setAttribute('class', 'connections');
  connections.setAttribute('width', '100%');
  connections.setAttribute('height', height);
  connections.setAttribute('viewBox', `0 0 ${width} ${height}`);
  connections.setAttribute('preserveAspectRatio', 'none');
  connections.setAttribute('aria-hidden', 'true');
  const gateRank = ranks.get('validation-gate');
  const nextRankStep = gateRank === undefined ? null : steps.find((step) => ranks.get(step.id) === gateRank + 1);
  if (nextRankStep) {
    const separatorX = Math.round(positions.get('validation-gate').x + cardWidth / 2);
    const separator = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    separator.setAttribute('x1', separatorX);
    separator.setAttribute('y1', 0);
    separator.setAttribute('x2', separatorX);
    separator.setAttribute('y2', height);
    separator.setAttribute('stroke', '#cbd5e1');
    separator.setAttribute('stroke-width', '1.5');
    separator.setAttribute('stroke-dasharray', '5 4');
    connections.append(separator);
    const percentage = `${(separatorX / width * 100).toFixed(2)}%`;
    const upstream = element('div', 'Upstream', 'phase-label');
    upstream.style.cssText = `left:0;width:${percentage};`;
    const downstream = element('div', 'Downstream', 'phase-label');
    downstream.style.cssText = `left:${percentage};right:0;`;
    graph.append(upstream, downstream);
  }
  for (const step of steps) {
    for (const dependency of step.requires) {
      const from = positions.get(dependency);
      const to = positions.get(step.id);
      const startX = from.x + cardWidth;
      const startY = from.y + cardHeight / 2;
      const endX = to.x;
      const endY = to.y + cardHeight / 2;
      const middleX = Math.round((startX + endX) / 2);
      const direction = endY >= startY ? 1 : -1;
      const tip = endX - 6;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('data-dependency', `${dependency}:${step.id}`);
      const d = Math.abs(startY - endY) < 1
        ? `M ${startX} ${startY} H ${tip - 7} M ${tip - 7} ${endY - 5} L ${tip} ${endY} L ${tip - 7} ${endY + 5}`
        : `M ${startX} ${startY} H ${middleX - 8} Q ${middleX} ${startY} ${middleX} ${startY + direction * 8} V ${endY - direction * 8} Q ${middleX} ${endY} ${middleX + 8} ${endY} H ${tip - 7} L ${tip} ${endY} L ${tip - 7} ${endY + 5}`;
      path.setAttribute('d', d);
      connections.append(path);
    }
  }
  graph.insertBefore(connections, graph.children[0] || null);
  for (const [index, step] of steps.entries()) {
    const state = findStep(node, step.id);
    const status = statuses[state.status];
    const card = element('button', '', `step ${status.className}`);
    card.type = 'button';
    card.setAttribute('data-step', step.id);
    card.style.left = `${positions.get(step.id).x / width * 100}%`;
    card.style.top = `${positions.get(step.id).y}px`;
    card.style.width = `${cardWidth / width * 100}%`;
    card.style.height = `${cardHeight}px`;
    const heading = element('div', '', 'step-heading');
    heading.append(
      element('h3', labels[step.id] || step.id),
      element('span', String(index + 1).padStart(2, '0'), 'step-number'),
    );
    const footer = element('div', '', 'step-footer');
    footer.append(statusBadge(state.status));
    footer.append(element('span', 'Ver detalhes', 'step-hint'));
    card.append(heading, footer);
    card.addEventListener('click', () => showDetails(node, step));
    graph.append(card);
  }
  scroll.append(graph);
  return scroll;
}

function sourceRoleLabel(role) {
  return ({
    legacy: 'Legado',
    target: 'To-Be / Target',
    reference: 'Referência',
    integration: 'Integração',
    documentation: 'Documentação',
  })[role] || 'Papel inválido';
}

function renderSourcesSection(state) {
  const section = element('section', '', 'sources-section');
  const header = element('div', '', 'sources-header');
  header.append(element('h3', `Fontes de Código e Insumos (${state.sources.length})`));
  const addButton = element('button', '+ Adicionar Fonte', 'btn btn-secondary');
  addButton.type = 'button';
  header.append(addButton);
  section.append(header);
  const grid = element('div', '', 'sources-grid');
  for (const source of state.sources) {
    const card = element('article', '', 'source-card');
    const badge = element('span', sourceRoleLabel(source.role), `source-badge ${source.role}`);
    const title = element('strong', source.id);
    const kind = element('span', source.kind === 'repository' ? 'Repositório' : 'Documento', 'source-kind');
    card.append(badge, title, element('code', source.path, 'source-path'), kind);
    if (source.stack) card.append(element('span', source.stack, 'source-stack'));
    if (source.scope) card.append(element('span', `scope: ${source.scope}`, 'source-scope'));
    if (source.description) card.append(element('p', source.description, 'source-description'));
    grid.append(card);
  }
  if (!state.sources.length) grid.append(element('p', 'Nenhuma fonte registrada nesta iniciativa.', 'sources-empty'));
  section.append(grid);
  addButton.addEventListener('click', () => openSourceForm(section, state.runId));
  return section;
}

function openSourceForm(section, runId) {
  section.querySelector('.source-form')?.remove();
  const form = element('form', '', 'source-form');
  const fields = [
    ['id', 'Identificador', 'ex: monolito-core'],
    ['path', 'Caminho relativo', 'workspace/src/monolito-core'],
    ['stack', 'Stack (opcional)', 'Java 8 / Spring 4'],
    ['scope', 'Escopo (opcional)', 'src/main/java'],
    ['description', 'Descrição (opcional)', 'Propósito da fonte'],
  ];
  const inputs = {};
  for (const [key, label, placeholder] of fields) {
    const input = element('input');
    input.name = key;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    inputs[key] = input;
    form.append(input);
  }
  const kind = element('select');
  kind.name = 'kind';
  for (const value of ['repository', 'document']) {
    const option = element('option', value === 'repository' ? 'Repositório' : 'Documento');
    option.value = value;
    kind.append(option);
  }
  const role = element('select');
  role.name = 'role';
  for (const value of ['legacy', 'target', 'reference', 'integration', 'documentation']) {
    const option = element('option', sourceRoleLabel(value));
    option.value = value;
    role.append(option);
  }
  form.append(kind, role);
  const output = element('pre', '', 'source-output');
  output.hidden = true;
  const generate = element('button', 'Gerar JSON e instrução CLI', 'btn btn-primary');
  generate.type = 'submit';
  const copyJson = element('button', 'Copiar JSON', 'btn btn-secondary');
  copyJson.type = 'button';
  const copyCommand = element('button', 'Copiar instrução CLI', 'btn btn-secondary');
  copyCommand.type = 'button';
  const cancel = element('button', 'Fechar', 'btn btn-secondary');
  cancel.type = 'button';
  cancel.addEventListener('click', () => form.remove());
  form.append(generate, copyJson, copyCommand, cancel, output);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const source = { id: inputs.id.value.trim(), path: inputs.path.value.trim(), kind: kind.value, role: role.value };
    for (const field of ['stack', 'scope', 'description']) {
      if (inputs[field].value.trim()) source[field] = inputs[field].value.trim();
    }
    if (!source.id || !source.path) {
      output.hidden = false;
      output.textContent = 'Informe o identificador e o caminho relativo da fonte.';
      return;
    }
    const json = JSON.stringify(source, null, 2);
    output.dataset.json = json;
    output.dataset.command = `smith sources add --run-id ${runId} < source.json`;
    output.hidden = false;
    output.textContent = `${json}\n\n${output.dataset.command}`;
  });
  copyJson.addEventListener('click', () => copySourceText(output, 'json'));
  copyCommand.addEventListener('click', () => copySourceText(output, 'command'));
  section.append(form);
}

async function copySourceText(output, field) {
  if (!output.dataset[field] || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(output.dataset[field]);
    notice.textContent = field === 'json' ? 'JSON copiado.' : 'Instrução CLI copiada.';
  } catch (error) {
    notice.textContent = `Não foi possível copiar: ${error.message}`;
  }
}

function render(state) {
  validateState(state);
  const overview = element('section', '', 'overview');
  overview.append(element('h2', `Iniciativa: ${state.runId}`));
  const metrics = element('div', '', 'metrics-row');
  const metricStatuses = ['COMPLETED', 'RUNNING', 'PENDING', 'FAILED'].map((key) => stepStatuses[key]);
  for (const definition of metricStatuses) {
    const count = state.nodes.flatMap((node) => node.steps.map((step) => step.status))
      .filter((status) => status === definition.value).length;
    const metric = element('div', '', 'metric');
    const icon = element('div', '', `metric-icon ${definition.className}`);
    const iconPaths = {
      done: 'M5 10l4 4 7-7',
      active: 'M10 3v4M10 13v4M3 10h4M13 10h4',
      waiting: 'M10 6v4l2.5 2.5M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
      error: 'M10 6v4M10 14h.01M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
    };
    icon.append(svgIcon(iconPaths[definition.className] || iconPaths.waiting));
    const body = element('div', '', 'metric-body');
    body.append(element('strong', String(count)), element('span', definition.label));
    metric.append(icon, body);
    metrics.append(metric);
  }
  overview.append(metrics);
  content.append(overview, renderSourcesSection(state));

  for (const node of state.nodes) {
    const theme = element('section', '', 'theme');
    const header = element('div', '', 'theme-header');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    const left = element('div', '', 'theme-header-left');
    left.append(element('h2', node.tema), element('p', 'Clique para expandir o fluxo'));
    const badge = element('span', 'Tema', 'theme-badge');
    const chevron = element('span', '', 'theme-chevron');
    chevron.append(svgIcon('M5 8l5 5 5-5'));
    const right = element('div', '', 'theme-header-right');
    right.append(badge, chevron);
    header.append(left, right);
    const toggle = () => {
      const open = theme.classList.toggle('open');
      header.setAttribute('aria-expanded', String(open));
      left.children[1].textContent = open
        ? 'Selecione uma etapa para consultar seus artefatos'
        : 'Clique para expandir o fluxo';
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    theme.append(header, diagram(node));
    content.append(theme);
  }
}

function validArtifactPath(path) {
  return typeof path === 'string' && path.startsWith('workspace/') &&
    !path.includes('\\') && !path.includes(':') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..' && !part.includes('\0'));
}

async function artifactFile(path) {
  if (!validArtifactPath(path)) throw new Error('Caminho inválido do artefato.');
  if (projectFiles) {
    const file = projectFiles.get(path);
    if (!file) throw new Error('Artefato não encontrado na pasta selecionada.');
    return file;
  }
  if (!project) throw new Error('Autorize a pasta raiz do projeto para ler os artefatos.');
  const parts = path.split('/');
  let current = project;
  for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part);
  return (await current.getFileHandle(parts.at(-1))).getFile();
}

function closeDetails() {
  detailSequence += 1;
  details.hidden = true;
  overlay.hidden = true;
}

function renderArtifact(name, artifact, sequence, loads) {
  const item = element('div', '', 'artifact');
  const header = element('div', '', 'artifact-header');
  header.append(element('strong', name), element('span', artifact.path, 'artifact-path'));
  if (artifact.groupId) header.append(element('span', `Publicação: ${artifact.groupId}`, 'artifact-group'));
  const chevron = element('span', '', 'artifact-chevron');
  chevron.append(svgIcon('M5 8l5 5 5-5'));
  header.append(chevron);
  header.addEventListener('click', () => item.classList.toggle('open'));
  const body = element('div', '', 'artifact-body');
  const output = element('div', 'Carregando artefato…', 'artifact-loading');
  body.append(output);
  item.append(header, body);
  loads.push((async () => {
    try {
      const file = await artifactFile(artifact.path);
      const text = await file.text();
      if (sequence !== detailSequence) return;
      output.textContent = '';
      output.append(artifact.path.toLowerCase().endsWith('.md') ? renderMarkdown(text) : element('pre', text));
    } catch (error) {
      if (sequence === detailSequence) {
        output.className = 'artifact-error';
        output.textContent = `Não foi possível ler o artefato: ${error.message}`;
      }
    }
  })());
  return item;
}

async function showDetails(node, definition) {
  const sequence = ++detailSequence;
  const selectedNode = findNode(currentStateObj, node.id);
  const state = findStep(selectedNode, definition.id);
  details.textContent = '';
  details.hidden = false;
  overlay.hidden = false;
  const topbar = element('div', '', 'details-topbar');
  const close = element('button', 'Fechar', 'btn btn-secondary');
  close.type = 'button';
  close.addEventListener('click', closeDetails);
  topbar.append(element('h2', labels[definition.id] || definition.id), close);
  details.append(topbar);
  overlay.addEventListener('click', closeDetails, { once: true });

  const scroll = element('div', '', 'details-scroll');
  const meta = element('div', '', 'detail-meta-row');
  meta.append(element('span', node.tema, 'detail-chip'), statusBadge(state.status));
  meta.append(element('span', definition.requires.length
    ? `Depende de: ${definition.requires.join(', ')}` : 'Sem dependências', 'detail-chip'));
  scroll.append(meta);
  if (state.error) {
    scroll.append(element('div', `Erro do engine: ${state.error}`, 'engine-error-banner'));
  }
  const artifacts = state.artifacts.map((artifact) => [artifact.name, artifact]);
  for (const approved of state.approvedArtifacts || []) {
    for (const artifact of approved.artifacts) artifacts.push([`${approved.stepType} — ${artifact.name}`, artifact]);
  }
  if (artifacts.length || !state.items.length) {
    scroll.append(element('div', 'Artefatos', 'artifacts-heading'));
    const loads = [];
    for (const [name, artifact] of artifacts) {
      const card = renderArtifact(name, artifact, sequence, loads);
      scroll.append(card);
    }
    if (!artifacts.length) scroll.append(element('div', 'Nenhum artefato registrado nesta etapa.', 'empty-artifacts'));
    await Promise.all(loads);
  }
  if (state.items.length) {
    const items = element('section', '', 'items-section');
    items.append(element('div', 'Itens', 'artifacts-heading'));
    const loads = [];
    for (const item of state.items) {
      const card = element('article', '', 'item-card');
      const heading = element('div', '', 'item-header');
      heading.append(statusBadge(item.status), element('span', item.label, 'item-label'));
      const body = element('div', '', 'item-body');
      for (const artifact of item.artifacts) body.append(renderArtifact(artifact.name, artifact, sequence, loads));
      if (!item.artifacts.length) body.append(element('p', 'Nenhum artefato registrado.'));
      card.append(heading, body);
      items.append(card);
    }
    scroll.append(items);
    await Promise.all(loads);
  }
  details.append(scroll);
}

function renderInline(parent, text) {
  const tokens = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|!?\[[^\]\n]+\]\([^)\n]+\))/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(document.createTextNode(text.slice(offset, match.index)));
    const token = match[0];
    if (token.startsWith('`')) parent.append(element('code', token.slice(1, -1)));
    else if (token.startsWith('**') || token.startsWith('__')) parent.append(element('strong', token.slice(2, -2)));
    else if (token.startsWith('*') || token.startsWith('_')) parent.append(element('em', token.slice(1, -1)));
    else if (token.startsWith('[')) parent.append(element('span', token.slice(1, token.indexOf(']'))));
    else parent.append(document.createTextNode(token));
    offset = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(offset)));
}

function renderMarkdown(text) {
  const result = element('div', '', 'markdown');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tableCells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  const isTableRule = (line) => /^\s*\|?\s*:?-{3,}/.test(line) &&
    tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
  const isBlock = (line) => /^\s*(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s)/.test(line);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      index += 1;
      const code = [];
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = element('pre', '');
      pre.append(element('code', code.join('\n')));
      result.append(pre);
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const title = element(`h${heading[1].length}`, '');
      renderInline(title, heading[2]); result.append(title); index += 1; continue;
    }
    if (index + 1 < lines.length && line.includes('|') && isTableRule(lines[index + 1])) {
      const table = element('table', ''), head = element('thead', ''), row = element('tr', '');
      for (const cell of tableCells(line)) { const th = element('th', ''); renderInline(th, cell); row.append(th); }
      head.append(row); table.append(head);
      const body = element('tbody', '');
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const tr = element('tr', '');
        for (const cell of tableCells(lines[index++])) { const td = element('td', ''); renderInline(td, cell); tr.append(td); }
        body.append(tr);
      }
      table.append(body); result.append(table); continue;
    }
    const list = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const listElement = element(ordered ? 'ol' : 'ul', '');
      while (index < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(lines[index]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        const listItem = element('li', '');
        renderInline(listItem, item[2]);
        listElement.append(listItem);
        index += 1;
      }
      result.append(listElement); continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = element('blockquote', '');
      const parts = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) parts.push(lines[index++].replace(/^\s*>\s?/, ''));
      renderInline(quote, parts.join('\n')); result.append(quote); continue;
    }
    const paragraph = element('p', '');
    const parts = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !isBlock(lines[index]) &&
      !(index + 1 < lines.length && lines[index].includes('|') && isTableRule(lines[index + 1]))) {
      parts.push(lines[index++]);
    }
    renderInline(paragraph, parts.join('\n')); result.append(paragraph);
  }
  return result;
}

function getLastInitiative() {
  try { return localStorage.getItem(lastInitiativeKey); }
  catch (error) { notice.textContent = `Não foi possível lembrar a iniciativa: ${error.message}`; return null; }
}

function rememberInitiative(name) {
  try { localStorage.setItem(lastInitiativeKey, name); }
  catch (error) { notice.textContent = `Não foi possível lembrar a iniciativa: ${error.message}`; }
}

async function readFile(file, sequence = ++loadSequence) {
  message.textContent = '';
  content.textContent = '';
  details.hidden = true;
  overlay.hidden = true;
  detailSequence += 1;
  try {
    const state = JSON.parse(await file.text());
    validateState(state);
    if (sequence === loadSequence) {
      currentStateObj = state;
      render(state);
    }
  } catch (error) {
    if (sequence !== loadSequence) return;
    content.textContent = '';
    message.textContent = `Não foi possível ler o arquivo: JSON ou estado inválido. ${error.message}`;
  }
}

async function selectInitiative() {
  const file = files.find((item) => item.name === initiative.value);
  if (!file) return;
  const sequence = ++loadSequence;
  rememberInitiative(file.name);
  try {
    const selected = await file.getFile();
    if (sequence === loadSequence) await readFile(selected, sequence);
  } catch (error) {
    if (sequence !== loadSequence) return;
    content.textContent = '';
    message.textContent = `Não foi possível abrir ${file.name}: ${error.message}`;
  }
}

async function showFiles(items, folderName) {
  files = items.filter((item) => /\.json$/i.test(item.name)).sort((a, b) => a.name.localeCompare(b.name));
  initiative.textContent = '';
  content.textContent = '';
  message.textContent = '';
  details.hidden = true;
  overlay.hidden = true;
  detailSequence += 1;
  loadSequence += 1;
  initiative.disabled = files.length === 0;
  if (!files.length) {
    initiative.append(element('option', 'Nenhum JSON encontrado'));
    notice.textContent = `Nenhum arquivo JSON encontrado em ${folderName}.`;
    return;
  }
  for (const file of files) {
    const option = element('option', file.name);
    option.value = file.name;
    initiative.append(option);
  }
  notice.textContent = '';
  const last = getLastInitiative();
  initiative.value = files.some((file) => file.name === last) ? last : files[0].name;
  await selectInitiative();
}

async function readDirectory(handle) {
  let runs = handle;
  try {
    for (const part of ['.smith', 'runs']) runs = await runs.getDirectoryHandle(part);
  } catch (error) {
    throw new Error(`Projeto inválido: pasta de execuções indisponível. ${error.message}`, { cause: error });
  }
  const items = [];
  for await (const entry of runs.values()) {
    if (entry.kind === 'file') {
      const entryName = entry.name;
      items.push({ name: entryName, getFile: async () => (await runs.getFileHandle(entryName)).getFile() });
    }
  }
  directory = handle;
  project = handle;
  projectFiles = undefined;
  refreshFolder.hidden = false;
  restoreFolder.hidden = true;
  await showFiles(items, handle.name);
}

function storedDirectory(mode, value, key = 'project-root') {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('smith-viewer', 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains('preferences')) opening.result.createObjectStore('preferences');
    };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const transaction = opening.result.transaction('preferences', mode === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('preferences');
      const request = mode === 'get' ? store.get(key) : store.put(value, key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

chooseFolder.addEventListener('click', async () => {
  if (typeof showDirectoryPicker !== 'function') {
    folderInput.click();
    return;
  }
  try {
    const handle = await showDirectoryPicker({ mode: 'read' });
    await readDirectory(handle);
    try { await storedDirectory('put', handle); }
    catch (error) { notice.textContent += ` Não foi possível lembrar a pasta: ${error.message}`; }
  } catch (error) {
    if (error.name !== 'AbortError') message.textContent = `Não foi possível abrir a pasta: ${error.message}`;
  }
});

folderInput.addEventListener('change', async () => {
  const selected = Array.from(folderInput.files);
  folderInput.value = '';
  if (!selected.length) return;
  const root = selected[0].webkitRelativePath.split('/')[0];
  const prefix = '.smith/runs/';
  if (!root || selected.some((file) => file.webkitRelativePath.split('/')[0] !== root)) {
    message.textContent = 'Projeto inválido: selecione uma única raiz de projeto.';
    return;
  }
  const entries = selected.map((file) => [file.webkitRelativePath.split('/').slice(1).join('/'), file]);
  const runs = entries.filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
  if (!runs.length) {
    message.textContent = 'Projeto inválido: pasta de execuções não encontrada ou vazia.';
    return;
  }
  directory = undefined;
  project = undefined;
  projectFiles = new Map(entries);
  refreshFolder.hidden = true;
  restoreFolder.hidden = true;
  await showFiles(runs.map(([, file]) => ({ name: file.name, getFile: async () => file })), root);
  notice.textContent += ' Para atualizar ou reabrir, selecione o projeto novamente.';
});

restoreFolder.addEventListener('click', async () => {
  try {
    if (await directory.requestPermission({ mode: 'read' }) !== 'granted') {
      message.textContent = 'Permissão de leitura para a pasta não concedida.';
      return;
    }
    await readDirectory(directory);
  } catch (error) { message.textContent = `Não foi possível reabrir a pasta: ${error.message}`; }
});

refreshFolder.addEventListener('click', async () => {
  try { await readDirectory(directory); }
  catch (error) { message.textContent = `Não foi possível atualizar a pasta: ${error.message}`; }
});

initiative.addEventListener('change', selectInitiative);

if (typeof showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined') {
  storedDirectory('get').then(async (handle) => {
    if (!handle) return;
    directory = handle;
    if (await handle.queryPermission({ mode: 'read' }) === 'granted') await readDirectory(handle);
    else {
      restoreFolder.hidden = false;
      notice.textContent = `Autorize o acesso para reabrir o projeto ${handle.name}.`;
    }
  }).catch((error) => { notice.textContent = `Não foi possível recuperar o último projeto: ${error.message}`; });
} else {
  notice.textContent = 'Este navegador pode exigir que o projeto seja selecionado novamente ao abrir a página.';
}
