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
const themeToggle = document.getElementById('theme-toggle');
const initiative = document.getElementById('initiative');
const message = document.getElementById('message');
const notice = document.getElementById('notice');
const content = document.getElementById('content');
const details = document.getElementById('details');
const overlay = document.getElementById('overlay');
const initiativeTrigger = document.getElementById('initiative-trigger');
const initiativeOptions = document.getElementById('initiative-options');
const lastInitiativeKey = 'smith-last-initiative';
const themeStorageKey = 'smith-theme';
let directory;
let project;
let projectFiles;
let files = [];
let loadSequence = 0;
let detailSequence = 0;
let currentStateObj = null;
const toastTimers = new WeakMap();

function showToast(container, text) {
  const toast = element('p', text, `msg ${container === message ? 'toast-error' : 'toast-notice'}`);
  const timer = setTimeout(() => {
    toast.remove();
    toastTimers.delete(toast);
  }, container === message ? 8000 : 5000);
  toastTimers.set(toast, timer);
  container.append(toast);
}

function clearToasts(container) {
  for (const toast of [...container.children]) {
    clearTimeout(toastTimers.get(toast));
    toastTimers.delete(toast);
    toast.remove();
  }
}

function applyTheme(theme, persist = false) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', normalized);
  const nextLabel = normalized === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  themeToggle.title = nextLabel;
  themeToggle.setAttribute('aria-label', nextLabel);
  if (persist) {
    try {
      localStorage.setItem(themeStorageKey, normalized);
    } catch (error) {
      showToast(notice, `Não foi possível salvar a preferência de tema: ${error.message}`);
    }
  }
  rerenderMermaidDiagrams();
}

if (themeToggle && document.documentElement) {
  let savedTheme;
  try {
    savedTheme = localStorage.getItem(themeStorageKey);
  } catch (error) {
    showToast(notice, `Não foi possível recuperar a preferência de tema: ${error.message}`);
  }
  applyTheme(savedTheme === 'light' ? 'light' : 'dark');
  themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    applyTheme(currentTheme === 'light' ? 'dark' : 'light', true);
  });
}

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
  const cardWidth = 158;
  const cardHeight = 76;
  const columnWidth = 192;
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
  const height = maxParallel * rowHeight + 68;
  const centerY = (height - cardHeight) / 2 + 12;
  const topY = Math.round((height - cardHeight - rowHeight) / 2) + 12;
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
    separator.setAttribute('stroke', 'var(--separator-stroke)');
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
      const tip = endX - 5;
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
  const button = element('button', '', 'btn btn-secondary btn-icon sources-button');
  button.type = 'button';
  button.title = `Fontes de Código e Insumos (${state.sources.length})`;
  button.setAttribute('aria-label', button.title);
  button.append(svgIcon('M4 4h12v12H4z M7 7h6 M7 10h6 M7 13h3'));
  button.addEventListener('click', () => showSources(state));
  return button;
}

async function copyInitialProjectPrompt(projectName) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    showToast(message, 'A cópia do prompt não está disponível neste navegador.');
    return;
  }
  try {
    await navigator.clipboard.writeText(initialProjectPrompt.replaceAll('{{project-name}}', projectName));
    showToast(notice, 'Prompt para iniciar o projeto copiado.');
  } catch (error) {
    showToast(message, `Não foi possível copiar: ${error.message}`);
  }
}

function renderEmptyRuns(folderName) {
  const section = element('section', '', 'empty-runs');
  section.append(
    element('h2', 'Nenhuma execução encontrada'),
    element('p', `O projeto ${folderName} ainda não tem execuções. Use o prompt de início para definir a iniciativa e o primeiro tema com o Smith; não é necessário ter fontes antes de começar.`),
  );
  const copyPrompt = element('button', 'Copiar prompt para iniciar', 'btn btn-primary');
  copyPrompt.type = 'button';
  copyPrompt.addEventListener('click', () => copyInitialProjectPrompt(folderName));
  section.append(copyPrompt);
  content.append(section);
}

function showSources(state) {
  detailSequence += 1;
  details.textContent = '';
  details.hidden = false;
  overlay.hidden = false;
  const topbar = element('div', '', 'details-topbar');
  const actions = element('div', '', 'details-actions');
  actions.append(closeButton());
  topbar.append(element('h2', `Fontes de Código e Insumos (${state.sources.length})`), actions);
  details.append(topbar);
  overlay.addEventListener('click', closeDetails, { once: true });

  const scroll = element('div', '', 'details-scroll');
  const addButton = element('button', '+ Adicionar Fonte', 'btn btn-secondary');
  addButton.type = 'button';
  addButton.addEventListener('click', () => openSourceForm(scroll, state.runId));
  scroll.append(addButton);
  const grid = element('div', '', 'sources-grid');
  for (const source of state.sources) {
    const card = element('article', '', 'source-card');
    const badge = element('span', sourceRoleLabel(source.role), `source-badge ${source.role}`);
    const title = element('span', source.id, 'source-title');
    const kind = element('span', source.kind === 'repository' ? 'Repositório' : 'Documento', 'source-badge source-kind-badge');
    if (source.role !== 'target') card.append(badge);
    card.append(title, element('code', source.path, 'source-path'), kind);
    if (source.stack) card.append(element('span', source.stack, 'source-stack'));
    if (source.scope) card.append(element('span', `scope: ${source.scope}`, 'source-scope'));
    if (source.description) card.append(element('p', source.description, 'source-description'));
    if (source.role === 'target') card.append(badge);
    grid.append(card);
  }
  if (!state.sources.length) grid.append(element('p', 'Nenhuma fonte registrada nesta iniciativa.', 'sources-empty'));
  scroll.append(grid);
  details.append(scroll);
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
    showToast(notice, field === 'json' ? 'JSON copiado.' : 'Instrução CLI copiada.');
  } catch (error) {
    showToast(notice, `Não foi possível copiar: ${error.message}`);
  }
}

function render(state) {
  validateState(state);
  const overview = element('section', '', 'overview');
  const heading = element('div', '', 'overview-heading');
  const title = element('h2', 'Iniciativa: ');
  title.append(element('span', state.runId, 'run-id-tag'));
  heading.append(title, renderSourcesSection(state));
  overview.append(heading);
  const metrics = element('div', '', 'metrics-row');
  const metricStatuses = ['COMPLETED', 'RUNNING', 'IN_PROGRESS', 'PENDING', 'FAILED'].map((key) => stepStatuses[key]);
  for (const definition of metricStatuses) {
    const count = state.nodes.flatMap((node) => node.steps.map((step) => step.status))
      .filter((status) => status === definition.value).length;
    const metric = element('div', '', `metric ${definition.className}`);
    const icon = element('div', '', `metric-icon ${definition.className}`);
    const iconPaths = {
      done: 'M5.5 10.5l3 3 6-6.5',
      active: 'M10 3v3M10 14v3M3 10h3M14 10h3M5.1 5.1l2.1 2.1M12.8 12.8l2.1 2.1',
      waiting: 'M10 6v4l2.5 2M10 17.5a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z',
      error: 'M10 6.5v4M10 13.5h.01M3.2 16.5L10 3.5l6.8 13H3.2Z',
    };
    icon.append(svgIcon(iconPaths[definition.className] || iconPaths.waiting));
    const titleGroup = element('div', '', 'metric-title-group');
    titleGroup.append(icon, element('span', definition.label, 'metric-label'));
    metric.append(titleGroup, element('strong', String(count), 'metric-value'));
    metrics.append(metric);
  }
  overview.append(metrics);
  content.append(overview);

  for (const [index, node] of state.nodes.entries()) {
    const theme = element('section', '', 'theme');
    const shouldOpen = false;
    const header = element('div', '', 'theme-header');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    const left = element('div', '', 'theme-header-left');
    left.append(
      element('h2', node.tema),
      element('p', 'Clique para expandir o fluxo'),
    );
    const totalSteps = node.steps ? node.steps.length : 8;
    const completedSteps = (node.steps || []).filter((s) =>
      s.status === 'completed' || (s.status === 'accumulating' && s.artifacts && s.artifacts.length > 0)
    ).length;
    const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    const badge = element('span', `${percentage}%`, 'theme-progress-badge');
    if (percentage === 100) {
      badge.classList.add('badge-success');
    } else if (percentage > 0) {
      badge.classList.add('badge-progress');
    }
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

function closeButton() {
  const button = element('button', '', 'btn btn-secondary btn-icon');
  button.type = 'button';
  button.title = 'Fechar';
  button.setAttribute('aria-label', 'Fechar');
  button.append(svgIcon('M5 5l10 10M15 5L5 15'));
  button.addEventListener('click', closeDetails);
  return button;
}

async function copyRecommendedPrompt(definition, node) {
  if (!definition.instructions || !definition.promptCommand || !definition.recommendedSources?.length) {
    showToast(notice, 'Não há prompt recomendado para esta etapa.');
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    showToast(notice, 'A cópia do prompt não está disponível neste navegador.');
    return;
  }
  try {
    const initiativeName = currentStateObj.runId;
    const prompt = [
      definition.promptCommand,
      '',
      'Contexto:',
      `- Iniciativa: ${initiativeName}`,
      `- Tema: ${node.tema}`,
      '',
      definition.instructions,
      '',
      'Fontes recomendadas:',
      ...definition.recommendedSources.map((source) =>
        `- ${source.replaceAll('<iniciativa>', initiativeName)}`),
    ].join('\n');
    await navigator.clipboard.writeText(prompt);
    showToast(notice, 'Prompt recomendado copiado.');
  } catch (error) {
    showToast(notice, `Não foi possível copiar o prompt: ${error.message}`);
  }
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
      if (artifact.path.toLowerCase().endsWith('.md')) {
        const md = renderMarkdown(text);
        output.append(md);
        await renderMermaidDiagrams(md);
        renderPlantUMLDiagrams(md);
        applySyntaxHighlight(md);
      } else {
        output.append(element('pre', text));
      }
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
  const actions = element('div', '', 'details-actions');
  const copyPrompt = element('button', 'Copiar prompt', 'btn btn-secondary');
  copyPrompt.type = 'button';
  copyPrompt.title = 'Copiar prompt recomendado para esta etapa';
  copyPrompt.setAttribute('aria-label', copyPrompt.title);
  copyPrompt.append(svgIcon('M7 7h9v10H7z M4 13H3V3h9v1'));
  copyPrompt.addEventListener('click', () => copyRecommendedPrompt(definition, node));
  actions.append(copyPrompt, closeButton());
  topbar.append(element('h2', labels[definition.id] || definition.id), actions);
  details.append(topbar);
  overlay.addEventListener('click', closeDetails, { once: true });

  const scroll = element('div', '', 'details-scroll');
  const statusRow = element('div', '', 'detail-status-row');
  statusRow.append(statusBadge(state.status));
  scroll.append(statusRow);
  const meta = element('div', '', 'detail-meta-row');
  meta.append(element('span', `Iniciativa: ${currentStateObj.runId}`, 'detail-chip'));
  meta.append(element('span', node.tema, 'detail-chip'));
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
    const fence = /^\s*(`{3,}|~{3,})\s*([a-zA-Z0-9_-]*)/.exec(line);
    if (fence) {
      index += 1;
      const code = [];
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
      if (index < lines.length) index += 1;

      const lang = (fence[2] || '').toLowerCase().trim();
      const rawCode = code.join('\n');
      const isPlantUml = lang === 'plantuml' || lang === 'puml' || rawCode.trim().startsWith('@startuml');

      if (lang === 'mermaid') {
        const container = element('div', '', 'diagram-container mermaid-container');
        const el = element('div', rawCode, 'mermaid');
        el.id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        el.setAttribute('data-original-code', rawCode);
        container.append(el);
        result.append(container);
      } else if (isPlantUml) {
        const container = element('div', '', 'diagram-container plantuml-container');
        const el = element('div', '', 'plantuml');
        el.setAttribute('data-code', rawCode);
        el.setAttribute('data-original-code', rawCode);
        container.append(el);
        result.append(container);
      } else {
        const container = element('div', '', 'code-block-wrapper');
        const header = element('div', '', 'code-block-header');
        const badge = element('span', lang || 'plaintext', 'code-lang-badge');
        const copyBtn = element('button', 'Copiar', 'btn-copy-code');
        copyBtn.type = 'button';
        copyBtn.title = 'Copiar código';
        copyBtn.setAttribute('aria-label', 'Copiar código');
        copyBtn.addEventListener('click', async () => {
          try {
            if (navigator.clipboard) await navigator.clipboard.writeText(rawCode);
            copyBtn.textContent = 'Copiado!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.textContent = 'Copiar';
              copyBtn.classList.remove('copied');
            }, 2000);
          } catch (e) {
            copyBtn.textContent = 'Erro ao copiar';
            showToast(notice, `Não foi possível copiar: ${e.message}`);
          }
        });
        header.append(badge, copyBtn);

        const pre = element('pre', '');
        const codeEl = element('code', rawCode, `hljs language-${lang || 'plaintext'}`);
        pre.append(codeEl);
        container.append(header, pre);
        result.append(container);
      }
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
  renderPlantUMLDiagrams(result);
  return result;
}

function getLastInitiative() {
  try { return localStorage.getItem(lastInitiativeKey); }
  catch (error) { showToast(notice, `Não foi possível lembrar a iniciativa: ${error.message}`); return null; }
}

function rememberInitiative(name) {
  try { localStorage.setItem(lastInitiativeKey, name); }
  catch (error) { showToast(notice, `Não foi possível lembrar a iniciativa: ${error.message}`); }
}

async function readFile(file, sequence = ++loadSequence) {
  clearToasts(message);
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
    showToast(message, `Não foi possível ler o arquivo: JSON ou estado inválido. ${error.message}`);
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
    showToast(message, `Não foi possível abrir ${file.name}: ${error.message}`);
  }
}

function closeInitiativeOptions() {
  initiativeOptions.hidden = true;
  initiativeTrigger.setAttribute('aria-expanded', 'false');
}

function renderInitiativeOptions() {
  initiativeOptions.textContent = '';
  for (const file of files) {
    const option = element('button', file.name, 'initiative-option');
    option.type = 'button';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(file.name === initiative.value));
    option.addEventListener('click', async () => {
      initiative.value = file.name;
      initiativeTrigger.textContent = file.name;
      for (const item of initiativeOptions.children) {
        item.setAttribute('aria-selected', String(item === option));
      }
      closeInitiativeOptions();
      initiativeTrigger.focus();
      await selectInitiative();
    });
    initiativeOptions.append(option);
  }
}

async function showFiles(items, folderName) {
  files = items.filter((item) => /\.json$/i.test(item.name)).sort((a, b) => a.name.localeCompare(b.name));
  initiative.textContent = '';
  content.textContent = '';
  clearToasts(message);
  details.hidden = true;
  overlay.hidden = true;
  detailSequence += 1;
  loadSequence += 1;
  initiative.disabled = files.length === 0;
  initiativeTrigger.disabled = files.length === 0;
  closeInitiativeOptions();
  if (!files.length) {
    initiative.append(element('option', 'Nenhum JSON encontrado'));
    initiativeTrigger.textContent = 'Nenhum JSON encontrado';
    renderInitiativeOptions();
    renderEmptyRuns(folderName);
    clearToasts(notice);
    return;
  }
  for (const file of files) {
    const option = element('option', file.name);
    option.value = file.name;
    initiative.append(option);
  }
  clearToasts(notice);
  const last = getLastInitiative();
  initiative.value = files.some((file) => file.name === last) ? last : files[0].name;
  initiativeTrigger.textContent = initiative.value;
  renderInitiativeOptions();
  await selectInitiative();
}

initiativeTrigger.addEventListener('click', () => {
  const isOpen = initiativeOptions.hidden;
  initiativeOptions.hidden = !isOpen;
  initiativeTrigger.setAttribute('aria-expanded', String(isOpen));
});

initiativeTrigger.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' && initiativeOptions.hidden) {
    event.preventDefault();
    initiativeOptions.hidden = false;
    initiativeTrigger.setAttribute('aria-expanded', 'true');
    initiativeOptions.querySelector('.initiative-option')?.focus();
  }
});

initiativeOptions.addEventListener('keydown', (event) => {
  const options = [...initiativeOptions.children];
  const index = options.indexOf(event.target);
  let nextIndex;
  if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, options.length - 1);
  if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0);
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = options.length - 1;
  if (nextIndex !== undefined) {
    event.preventDefault();
    options[nextIndex]?.focus();
  } else if (event.key === 'Escape') {
    closeInitiativeOptions();
    initiativeTrigger.focus();
  }
});

if (typeof document.addEventListener === 'function') {
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.select-wrap')) closeInitiativeOptions();
  });
}

async function readDirectory(handle) {
  let runs = handle;
  try {
    for (const part of ['.smith', 'runs']) runs = await runs.getDirectoryHandle(part);
  } catch (error) {
    if (error.name !== 'NotFoundError' && error.code !== 'ENOENT') {
      throw new Error(`Projeto inválido: pasta de execuções indisponível. ${error.message}`, { cause: error });
    }
    directory = handle;
    project = handle;
    projectFiles = undefined;
    refreshFolder.hidden = false;
    restoreFolder.hidden = true;
    await showFiles([], handle.name);
    return;
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
    catch (error) { showToast(notice, `Não foi possível lembrar a pasta: ${error.message}`); }
  } catch (error) {
    if (error.name !== 'AbortError') showToast(message, `Não foi possível abrir a pasta: ${error.message}`);
  }
});

folderInput.addEventListener('change', async () => {
  const selected = Array.from(folderInput.files);
  folderInput.value = '';
  if (!selected.length) return;
  const root = selected[0].webkitRelativePath.split('/')[0];
  const prefix = '.smith/runs/';
  if (!root || selected.some((file) => file.webkitRelativePath.split('/')[0] !== root)) {
    showToast(message, 'Projeto inválido: selecione uma única raiz de projeto.');
    return;
  }
  const entries = selected.map((file) => [file.webkitRelativePath.split('/').slice(1).join('/'), file]);
  const runs = entries.filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
  directory = undefined;
  project = undefined;
  projectFiles = new Map(entries);
  refreshFolder.hidden = true;
  restoreFolder.hidden = true;
  await showFiles(runs.map(([, file]) => ({ name: file.name, getFile: async () => file })), root);
  showToast(notice, 'Para atualizar ou reabrir, selecione o projeto novamente.');
});

restoreFolder.addEventListener('click', async () => {
  try {
    if (await directory.requestPermission({ mode: 'read' }) !== 'granted') {
      showToast(message, 'Permissão de leitura para a pasta não concedida.');
      return;
    }
    await readDirectory(directory);
  } catch (error) { showToast(message, `Não foi possível reabrir a pasta: ${error.message}`); }
});

refreshFolder.addEventListener('click', async () => {
  try { await readDirectory(directory); }
  catch (error) { showToast(message, `Não foi possível atualizar a pasta: ${error.message}`); }
});

initiative.addEventListener('change', selectInitiative);

if (typeof showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined') {
  storedDirectory('get').then(async (handle) => {
    if (!handle) return;
    directory = handle;
    if (await handle.queryPermission({ mode: 'read' }) === 'granted') await readDirectory(handle);
    else {
      restoreFolder.hidden = false;
      showToast(notice, `Autorize o acesso para reabrir o projeto ${handle.name}.`);
    }
  }).catch((error) => { showToast(notice, `Não foi possível recuperar o último projeto: ${error.message}`); });
} else {
  showToast(notice, 'Este navegador pode exigir que o projeto seja selecionado novamente ao abrir a página.');
}



function applySyntaxHighlight(container) {
  if (typeof hljs === 'undefined' || !container) return;
  let codeBlocks = [];
  if (typeof container.querySelectorAll === 'function') {
    codeBlocks = container.querySelectorAll('.code-block-wrapper code.hljs');
    if (!codeBlocks || codeBlocks.length === 0) {
      codeBlocks = container.querySelectorAll('code.hljs');
    }
    if (!codeBlocks || codeBlocks.length === 0) {
      codeBlocks = container.querySelectorAll('.hljs');
    }
  }
  for (const block of codeBlocks) {
    try {
      if (typeof hljs.highlightElement === 'function') {
        hljs.highlightElement(block);
      }
      if (typeof hljs.lineNumbersBlock === 'function') {
        hljs.lineNumbersBlock(block);
      }
    } catch (err) {
      console.warn('Falha ao aplicar realce no bloco de código:', err);
    }
  }
}

/* ── Diagram Helpers (Mermaid & PlantUML) ── */

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findClosest(node, selector) {
  if (!node) return null;
  if (node.closest) return node.closest(selector);
  const isClass = selector.startsWith('.');
  const target = isClass ? selector.slice(1) : selector.toUpperCase();
  let cur = node.parentElement;
  while (cur) {
    if (isClass && cur.classList && cur.classList.contains(target)) return cur;
    if (!isClass && cur.tagName === target) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function encode6bit(b) {
  if (b < 10) return String.fromCharCode(48 + b);
  b -= 10;
  if (b < 26) return String.fromCharCode(65 + b);
  b -= 26;
  if (b < 26) return String.fromCharCode(97 + b);
  b -= 26;
  if (b === 0) return '-';
  if (b === 1) return '_';
  return '?';
}

function append3bytes(b1, b2, b3) {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xF) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3F;
  return encode6bit(c1 & 0x3F) + encode6bit(c2 & 0x3F) + encode6bit(c3 & 0x3F) + encode6bit(c4 & 0x3F);
}

function encode64(data) {
  let r = '';
  for (let i = 0; i < data.length; i += 3) {
    if (i + 2 < data.length) {
      r += append3bytes(data[i], data[i + 1], data[i + 2]);
    } else if (i + 1 < data.length) {
      r += append3bytes(data[i], data[i + 1], 0);
    } else {
      r += append3bytes(data[i], 0, 0);
    }
  }
  return r;
}

function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8');
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const second = str.charCodeAt(i + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + second - 0xdc00 + 0x10000;
        i++;
      }
    }
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(bytes);
}

function encodePlantUML(text) {
  const utf8 = utf8Encode(text);

  // RFC 1951 uncompressed DEFLATE blocks (BTYPE=00)
  const chunks = [];
  let offset = 0;
  while (offset < utf8.length) {
    const chunkLen = Math.min(utf8.length - offset, 65535);
    const isLast = (offset + chunkLen >= utf8.length);
    const header = new Uint8Array(5);
    header[0] = isLast ? 0x01 : 0x00;
    header[1] = chunkLen & 0xff;
    header[2] = (chunkLen >> 8) & 0xff;
    const nlen = (~chunkLen) & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >> 8) & 0xff;
    chunks.push(header);
    chunks.push(utf8.subarray ? utf8.subarray(offset, offset + chunkLen) : utf8.slice(offset, offset + chunkLen));
    offset += chunkLen;
  }
  if (chunks.length === 0) {
    chunks.push(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]));
  }
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;
  const deflated = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    deflated.set(c, pos);
    pos += c.length;
  }
  return encode64(deflated);
}

function renderDiagramOfflineFallback(rawCode) {
  const container = element('div', '', 'diagram-offline-fallback');
  const notice = element('div', 'Visualização gráfica requer conexão externa para PlantUML', 'diagram-offline-notice');
  const pre = element('pre', '');
  const code = element('code', rawCode);
  pre.append(code);
  container.append(notice, pre);
  return container;
}

function renderDiagramError(type, message, rawCode) {
  const container = element('div', '', 'diagram-error');
  const header = element('div', '', 'diagram-error-header');
  header.append(element('strong', `⚠️ Erro na sintaxe do diagrama ${type}`));
  const msg = element('p', message, 'diagram-error-msg');
  const details = element('details', '');
  const summary = element('summary', 'Exibir código original');
  const pre = element('pre', '');
  const code = element('code', rawCode);
  pre.append(code);
  details.append(summary, pre);
  container.append(header, msg, details);
  return container;
}

function addDiagramControls(container, rawCode) {
  if (container.querySelector && container.querySelector('.diagram-actions')) return;
  const actions = element('div', '', 'diagram-actions');
  const copyBtn = element('button', 'Copiar', 'btn-diagram-action btn-copy-diagram');
  copyBtn.type = 'button';
  copyBtn.title = 'Copiar código do diagrama';
  copyBtn.setAttribute('aria-label', 'Copiar código do diagrama');
  copyBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(rawCode);
      showToast(notice, 'Código do diagrama copiado.');
    } catch (e) {
      showToast(notice, `Não foi possível copiar: ${e.message}`);
    }
  });

  const zoomBtn = element('button', 'Ampliar', 'btn-diagram-action btn-zoom-diagram');
  zoomBtn.type = 'button';
  zoomBtn.title = 'Ampliar diagrama';
  zoomBtn.setAttribute('aria-label', 'Ampliar diagrama');
  zoomBtn.addEventListener('click', () => openDiagramModal(container, rawCode));

  actions.append(copyBtn, zoomBtn);
  if (container.prepend) {
    container.prepend(actions);
  } else if (container.children && container.children.length > 0) {
    container.insertBefore(actions, container.children[0]);
  } else {
    container.append(actions);
  }
}

function openDiagramModal(container, rawCode) {
  let currentZoom = 1;
  const minZoom = 0.2;
  const maxZoom = 10;

  const diagramEl = container.querySelector ? (container.querySelector('.mermaid') || container.querySelector('.plantuml')) : null;
  if (!diagramEl) return;

  const modal = element('div', '', 'diagram-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Ampliação de Diagrama');

  const content = element('div', '', 'diagram-modal-content');
  const header = element('div', '', 'diagram-modal-header');
  header.append(element('h3', 'Diagrama'));

  const controls = element('div', '', 'diagram-modal-controls');
  const zoomOutBtn = element('button', '−', 'diagram-modal-btn');
  zoomOutBtn.type = 'button';
  zoomOutBtn.title = 'Diminuir zoom';
  zoomOutBtn.setAttribute('aria-label', 'Diminuir zoom');

  const zoomLevel = element('span', '100%', 'diagram-zoom-level');

  const zoomInBtn = element('button', '+', 'diagram-modal-btn');
  zoomInBtn.type = 'button';
  zoomInBtn.title = 'Aumentar zoom';
  zoomInBtn.setAttribute('aria-label', 'Aumentar zoom');

  const resetBtn = element('button', 'Reset', 'diagram-modal-btn');
  resetBtn.type = 'button';
  resetBtn.title = 'Resetar zoom';
  resetBtn.setAttribute('aria-label', 'Resetar zoom');

  const fullscreenBtn = element('button', 'Tela Cheia', 'diagram-modal-btn');
  fullscreenBtn.type = 'button';
  fullscreenBtn.title = 'Alternar tela cheia';
  fullscreenBtn.setAttribute('aria-label', 'Alternar tela cheia');

  const copyModalBtn = element('button', 'Copiar', 'diagram-modal-btn');
  copyModalBtn.type = 'button';
  copyModalBtn.title = 'Copiar código';
  copyModalBtn.setAttribute('aria-label', 'Copiar código');
  copyModalBtn.addEventListener('click', async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(rawCode);
      showToast(notice, 'Código do diagrama copiado.');
    } catch (e) {
      showToast(notice, `Não foi possível copiar: ${e.message}`);
    }
  });

  const closeBtn = element('button', '✕', 'diagram-modal-btn');
  closeBtn.type = 'button';
  closeBtn.title = 'Fechar (ESC)';
  closeBtn.setAttribute('aria-label', 'Fechar');

  controls.append(zoomOutBtn, zoomLevel, zoomInBtn, resetBtn, fullscreenBtn, copyModalBtn, closeBtn);
  header.append(controls);

  const modalBody = element('div', '', 'diagram-modal-body');
  const wrapper = element('div', '', 'diagram-modal-diagram-wrapper');

  const svg = diagramEl.querySelector ? diagramEl.querySelector('svg') : null;
  const img = diagramEl.querySelector ? diagramEl.querySelector('img') : null;
  if (svg && svg.cloneNode) {
    wrapper.append(svg.cloneNode(true));
  } else if (img && img.cloneNode) {
    wrapper.append(img.cloneNode(true));
  } else {
    wrapper.innerHTML = diagramEl.innerHTML || diagramEl.textContent;
  }
  modalBody.append(wrapper);

  content.append(header, modalBody);
  modal.append(content);

  const previousOverflow = document.body ? document.body.style.overflow : '';
  if (document.body) document.body.style.overflow = 'hidden';

  const closeModal = () => {
    document.removeEventListener('keydown', onKeyDown);
    if (document.body) document.body.style.overflow = previousOverflow;
    modal.remove();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  };
  document.addEventListener('keydown', onKeyDown);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  const updateZoom = (z) => {
    currentZoom = Math.max(minZoom, Math.min(maxZoom, z));
    wrapper.style.transform = `scale(${currentZoom})`;
    zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
  };

  zoomInBtn.addEventListener('click', () => updateZoom(currentZoom + (currentZoom < 2 ? 0.25 : 0.5)));
  zoomOutBtn.addEventListener('click', () => updateZoom(currentZoom - (currentZoom <= 2 ? 0.25 : 0.5)));
  resetBtn.addEventListener('click', () => {
    updateZoom(1);
    modalBody.scrollLeft = 0;
    modalBody.scrollTop = 0;
  });

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      if (modal.requestFullscreen) modal.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
  });

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let scrollLeft = 0;
  let scrollTop = 0;

  modalBody.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.pageX - modalBody.offsetLeft;
    startY = e.pageY - modalBody.offsetTop;
    scrollLeft = modalBody.scrollLeft;
    scrollTop = modalBody.scrollTop;
  });

  modalBody.addEventListener('mouseleave', () => { isDragging = false; });
  modalBody.addEventListener('mouseup', () => { isDragging = false; });
  modalBody.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - modalBody.offsetLeft;
    const y = e.pageY - modalBody.offsetTop;
    modalBody.scrollLeft = scrollLeft - (x - startX);
    modalBody.scrollTop = scrollTop - (y - startY);
  });

  const mountTarget = document.body || document.documentElement;
  mountTarget.append(modal);
}

async function renderMermaidDiagrams(container) {
  if (typeof mermaid === 'undefined' || !container) return;
  const isDark = document.documentElement ? document.documentElement.getAttribute('data-theme') === 'dark' : false;
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
      flowchart: { htmlLabels: false },
    });
  } catch (e) {
    // initialize failure handled
  }

  const elements = container.querySelectorAll ? container.querySelectorAll('.mermaid') : [];
  for (const el of elements) {
    const raw = el.getAttribute('data-original-code') || el.textContent;
    if (!raw || !raw.trim()) continue;
    const parentContainer = findClosest(el, '.diagram-container') || el.parentElement;
    try {
      if (mermaid.parse) {
        const valid = await mermaid.parse(raw, { suppressErrors: true });
        if (!valid) throw new Error('Sintaxe inválida no diagrama');
      }
      if (mermaid.render) {
        const renderId = 'mermaid-svg-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now();
        const res = await mermaid.render(renderId, raw);
        const svgContent = typeof res === 'string' ? res : (res && res.svg ? res.svg : '');
        el.innerHTML = svgContent;
        if (res && res.bindFunctions) {
          try { res.bindFunctions(el); } catch (e) {}
        }
      } else if (mermaid.run) {
        el.textContent = raw;
        await mermaid.run({ nodes: [el] });
      }
      if (parentContainer) {
        addDiagramControls(parentContainer, raw);
      }
    } catch (err) {
      el.textContent = '';
      el.append(renderDiagramError('Mermaid', err.message || String(err), raw));
      if (parentContainer) {
        addDiagramControls(parentContainer, raw);
      }
    }
  }
}

async function rerenderMermaidDiagrams() {
  if (typeof mermaid === 'undefined') return;
  const isDark = document.documentElement ? document.documentElement.getAttribute('data-theme') === 'dark' : false;
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
      flowchart: { htmlLabels: false },
    });
  } catch (e) {
    return;
  }

  const elements = document.querySelectorAll ? document.querySelectorAll('.mermaid-container .mermaid') : [];
  for (const el of elements) {
    const raw = el.getAttribute('data-original-code');
    if (!raw) continue;
    try {
      if (mermaid.render) {
        const renderId = 'mermaid-rerender-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now();
        const res = await mermaid.render(renderId, raw);
        const svgContent = typeof res === 'string' ? res : (res && res.svg ? res.svg : '');
        el.innerHTML = svgContent;
        if (res && res.bindFunctions) {
          try { res.bindFunctions(el); } catch (e) {}
        }
      } else if (mermaid.run) {
        el.innerHTML = '';
        el.textContent = raw;
        el.removeAttribute('data-processed');
        await mermaid.run({ nodes: [el] });
      }
    } catch (err) {
      el.textContent = '';
      el.append(renderDiagramError('Mermaid', err.message || String(err), raw));
    }
  }
}

function renderPlantUMLDiagrams(container) {
  if (!container) return;
  const elements = container.querySelectorAll ? container.querySelectorAll('.plantuml') : [];
  for (const el of elements) {
    const raw = el.getAttribute('data-code') || el.getAttribute('data-original-code') || el.textContent;
    if (!raw || !raw.trim()) continue;
    try {
      const encoded = encodePlantUML(raw);
      const parentContainer = findClosest(el, '.diagram-container') || el.parentElement;
      const img = element('img', '', 'plantuml-svg-img');
      img.setAttribute('src', `https://www.plantuml.com/plantuml/svg/${encoded}`);
      img.setAttribute('alt', 'Diagrama PlantUML');
      img.setAttribute('loading', 'lazy');
      img.addEventListener('error', () => {
        el.textContent = '';
        el.append(renderDiagramOfflineFallback(raw));
      });
      el.textContent = '';
      el.append(img);
      if (parentContainer) {
        addDiagramControls(parentContainer, raw);
      }
    } catch (err) {
      el.textContent = '';
      el.append(renderDiagramError('PlantUML', err.message || String(err), raw));
    }
  }
}
