'use strict';
// steps is injected via inline <script> in index.html as: const steps = __WORKFLOW_STEPS__;
const labels = {
      "business-epic": "Épico de negócio",
      "as-is-knowledge": "Knowledge As-Is",
      "discovery-consolidation": "Consolidado",
      "decision-record": "Decisões",
      "validation-gate": "Gate de validação",
      "tech-solution-specification": "Solução",
      "story-task-breakdown": "Histórias",
      "technical-refinement": "Refinamento"
};
const statuses = { pending: 'Pendente', running: 'Em andamento', completed: 'Concluída', failed: 'Falhou', accumulating: 'Registrado' };
const stepInstructions = {
  'business-epic':               'Considere o tema e elabore o épico de negócio: objetivo estratégico, problema a resolver, personas impactadas e critérios de sucesso mensuráveis. O nome do arquivo será extraído do primeiro heading (#).',
  'as-is-knowledge':             'Considere o tema e documente o estado atual (As-Is): fluxos existentes, sistemas envolvidos, dores e ineficiências identificadas. O nome do arquivo será extraído do primeiro heading (#).',
  'discovery-consolidation':     'Considere o tema e consolide os aprendizados do discovery: hipóteses validadas/invalidadas, decisões já tomadas e principais riscos identificados. O nome do arquivo será extraído do primeiro heading (#).',
  'decision-record':             'Considere o tema e registre a decisão de arquitetura (ADR): contexto, opções avaliadas com prós/contras, decisão tomada e consequências esperadas. O nome do arquivo será extraído do campo **ID:** (ex: DEC-INTEGRACAO-SAP-001 → integracao-sap-001).',
  'validation-gate':             'Considere o tema e avalie a prontidão para o downstream: completude dos artefatos, consistência entre eles e riscos não endereçados',
  'tech-solution-specification': 'Considere o tema e especifique a solução técnica: arquitetura proposta, componentes, integrações, decisões técnicas e plano de implementação em alto nível. O nome do arquivo será extraído do primeiro heading (#).',
  'story-task-breakdown':        'Considere o tema e decomponha em histórias de usuário com critérios de aceite (Given/When/Then) e estimativa de complexidade. O nome do arquivo será extraído do primeiro heading (#).',
  'technical-refinement':        'Considere o tema e faça o refinamento técnico da história: abordagem de implementação, edge cases, impactos em outros sistemas e tarefas técnicas. O nome do arquivo será extraído do primeiro heading (#).',
};
function buildStepPrompt(step, node) {
  const label = labels[step.id] || step.id;
  const runId = currentStateObj?.runId || '';
  const instruction = stepInstructions[step.id] || 'Considere o tema e escreva o documento focado somente nos itens relacionados';
  const nodeKey = Object.keys(currentStateObj?.nodes || {}).find((k) => currentStateObj.nodes[k].tema === node.tema);
  const nodeState = nodeKey ? currentStateObj.nodes[nodeKey] : null;
  const sources = [];
  for (const reqId of step.requires) {
    const stepState = nodeState?.steps?.[reqId];
    const reqArtifacts = (stepState?.approvedArtifacts && Object.keys(stepState.approvedArtifacts).length > 0)
      ? stepState.approvedArtifacts
      : stepState?.artifacts;
    if (reqArtifacts) {
      if (Array.isArray(reqArtifacts)) {
        for (const artifactGroup of reqArtifacts) {
          if (artifactGroup && typeof artifactGroup === 'object') {
            if (typeof artifactGroup.path === 'string') {
              sources.push(artifactGroup.path);
            } else {
              for (const artifact of Object.values(artifactGroup)) {
                if (artifact?.path) sources.push(artifact.path);
              }
            }
          }
        }
      } else {
        for (const artifact of Object.values(reqArtifacts)) {
          if (typeof artifact?.path === 'string') {
            sources.push(artifact.path);
          } else if (artifact && typeof artifact === 'object') {
            for (const subArt of Object.values(artifact)) {
              if (subArt?.path) sources.push(subArt.path);
            }
          }
        }
      }
    }
  }
  if (step.id === 'tech-solution-specification') {
    const standardSources = [
      'workspace/.context/000-direcionamentos-arquiteturais.md',
      'workspace/.context/001-requisitos-nao-funcionais.md',
      'workspace/.context/002-regras-criacao-api.md'
    ];
    for (const src of standardSources) {
      if (!sources.includes(src)) sources.push(src);
    }
  }
  const fontesSection = sources.length ? sources.map((p) => `- ${p}`).join('\n') : '- ';
  return `/Smith: ${label}\n\nrun-id: ${runId}\ntema: ${node.tema}\n\n${instruction}\n\nfontes:\n${fontesSection}`;
}
const folderInput = document.getElementById('folder');
const chooseFolder = document.getElementById('choose-folder');
const restoreFolder = document.getElementById('restore-folder');
const refreshFolder = document.getElementById('refresh-folder');
const addInitiativeBtn = document.getElementById('add-initiative');
const initiativeForm = document.getElementById('initiative-form');
const initiative = document.getElementById('initiative');
const message = document.getElementById('message');
const notice = document.getElementById('notice');
const content = document.getElementById('content');
const details = document.getElementById('details');
const overlay = document.getElementById('overlay');
const lastInitiativeKey = 'smith-last-initiative';
const STEPS_WITH_ITEMS = new Set(['technical-refinement']);
const STEP_SECTION_LABEL = { 'story-task-breakdown': 'Histórias', 'as-is-knowledge': 'Documentos' };
const STEP_ADD_LABEL = { 'story-task-breakdown': ' Registrar história', 'as-is-knowledge': ' Registrar documento' };
let directory;
let project;
let projectFiles;
let files = [];
let loadSequence = 0;
let detailSequence = 0;
let writeHandles = new Map();
let runsHandle = null;
let currentStateName = null;
let currentStateObj = null;

function element(tag, text, className) {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}

function svgIcon(d) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function statusBadge(status) {
  const badge = element('span', '', 'status-badge');
  const dot = element('span', '', 'dot');
  const label = element('span', statuses[status] || status || statuses['pending']);
  badge.append(dot, label);
  return badge;
}

function diagram(node) {
  const cardWidth = 148, cardHeight = 68, columnWidth = 182, rowHeight = cardHeight * 2;
  const ranks = new Map(), positions = new Map();
  for (const step of steps) {
    ranks.set(step.id, step.requires.length ? Math.max(...step.requires.map((id) => ranks.get(id))) + 1 : 0);
  }
  const byRank = new Map();
  for (const step of steps) {
    const rank = ranks.get(step.id);
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(step);
  }
  const maxRank = Math.max(...ranks.values());
  const maxParallel = Math.max(...[...byRank.values()].map((a) => a.length), 2);
  const width = maxRank * columnWidth + cardWidth + 16;
  const height = maxParallel * rowHeight + 60;
  const centerY = (height - cardHeight) / 2;
  const topY = Math.round((height - cardHeight - rowHeight) / 2);
  for (const step of steps) {
    const rank = ranks.get(step.id);
    const peers = byRank.get(rank);
    const peerIndex = peers.indexOf(step);
    positions.set(step.id, {
      x: 8 + rank * columnWidth,
      y: peers.length === 1 ? centerY : topY + peerIndex * rowHeight,
    });
  }
  const scroll = element('div', '', 'graph-scroll');
  const graph = element('div', '', 'graph');
  graph.style.width = '100%';
  graph.style.minWidth = `${width}px`;
  graph.style.height = `${height}px`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connections');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const gateRk = ranks.get('validation-gate');
  const nextRkId = gateRk !== undefined ? steps.find((s) => ranks.get(s.id) === gateRk + 1)?.id : null;
  let phaseSepX = null;
  if (gateRk !== undefined && nextRkId) {
    phaseSepX = Math.round(positions.get('validation-gate').x + cardWidth / 2);
    const sepLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    sepLine.setAttribute('x1', phaseSepX); sepLine.setAttribute('y1', 0);
    sepLine.setAttribute('x2', phaseSepX); sepLine.setAttribute('y2', height);
    sepLine.setAttribute('stroke', '#cbd5e1'); sepLine.setAttribute('stroke-width', '1.5');
    sepLine.setAttribute('stroke-dasharray', '5 4');
    svg.append(sepLine);
  }
  const longEdgeRoute = new Map();
  for (const step of steps) {
    const longs = step.requires.filter((dep) => ranks.get(step.id) - ranks.get(dep) > 1);
    if (longs.length > 1) {
      const sorted = [...longs].sort((a, b) => ranks.get(a) - ranks.get(b));
      const idxPerSide = { above: 0, below: 0 };
      sorted.forEach((dep, i) => {
        const above = i % 2 === 0;
        const side = above ? 'above' : 'below';
        longEdgeRoute.set(`${dep}:${step.id}`, { above, laneIdx: idxPerSide[side]++ });
      });
    }
  }
  for (const step of steps) {
    const to = positions.get(step.id);
    for (const dependency of step.requires) {
      const from = positions.get(dependency);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const longEdge = ranks.get(step.id) - ranks.get(dependency) > 1;
      const r = 8;
      let d;
      if (longEdge) {
        const route = longEdgeRoute.get(`${dependency}:${step.id}`);
        const above = route ? route.above : from.y + cardHeight / 2 < height / 2;
        const laneIdx = route ? route.laneIdx : 0;
        const direction = above ? 1 : -1;
        const startX = from.x + cardWidth / 2;
        const startY = above ? from.y : from.y + cardHeight;
        const endX = to.x + cardWidth * (above ? 1 / 4 : 3 / 4);
        const endY = above ? to.y : to.y + cardHeight;
        const baseLane = above ? Math.round(height / 3) : Math.round(2 * height / 3);
        const lane = above ? baseLane - laneIdx * 18 : baseLane + laneIdx * 18;
        const tipY = endY - direction * 6;
        d = `M ${startX} ${startY} V ${lane + direction * r} Q ${startX} ${lane} ${startX + r} ${lane} H ${endX - r} Q ${endX} ${lane} ${endX} ${lane + direction * r} V ${tipY} M ${endX - 5} ${tipY - direction * 7} L ${endX} ${tipY} L ${endX + 5} ${tipY - direction * 7}`;
      } else {
        const startX = from.x + cardWidth, startY = from.y + cardHeight / 2;
        const stdReqs = step.requires.filter((dep) => ranks.get(step.id) - ranks.get(dep) <= 1);
        const reqIndex = stdReqs.indexOf(dependency);
        const reqCount = stdReqs.length;
        const endX = to.x;
        const endY = to.y + cardHeight / 2 + (reqCount > 1 ? (reqIndex - (reqCount - 1) / 2) * 20 : 0);
        const midX = Math.round((startX + endX) / 2);
        const tip = endX - 6;
        if (Math.abs(startY - endY) < 1) {
          d = `M ${startX} ${startY} H ${tip} M ${tip - 7} ${endY - 5} L ${tip} ${endY} L ${tip - 7} ${endY + 5}`;
        } else {
          const dir = endY > startY ? 1 : -1;
          d = `M ${startX} ${startY} H ${midX - r} Q ${midX} ${startY} ${midX} ${startY + dir * r} V ${endY - dir * r} Q ${midX} ${endY} ${midX + r} ${endY} H ${tip} M ${tip - 7} ${endY - 5} L ${tip} ${endY} L ${tip - 7} ${endY + 5}`;
        }
      }
      path.setAttribute('d', d);
      path.setAttribute('data-dependency', `${dependency}:${step.id}`);
      svg.append(path);
    }
  }
  graph.append(svg);
  if (phaseSepX !== null) {
    const pct = `${(phaseSepX / width * 100).toFixed(2)}%`;
    const upLabel = element('div', 'Upstream', 'phase-label');
    upLabel.style.cssText = `left:0;width:${pct};`;
    const downLabel = element('div', 'Downstream', 'phase-label');
    downLabel.style.cssText = `left:${pct};right:0;`;
    graph.append(upLabel, downLabel);
  }
  for (const [index, step] of steps.entries()) {
    const status = node.steps[step.id]?.status;
    const effectiveStatus = Object.hasOwn(statuses, status) ? status : (status ? 'unknown' : 'pending');
    const card = element('button', '', `step ${effectiveStatus}`);
    card.type = 'button';
    card.setAttribute('data-step', step.id);
    const position = positions.get(step.id);
    card.style.left = `${position.x / width * 100}%`;
    card.style.top = `${position.y}px`;
    card.style.width = `${cardWidth / width * 100}%`;
    card.style.height = `${cardHeight}px`;

    const heading = element('div', '', 'step-heading');
    heading.append(
      element('h3', labels[step.id] || step.id),
      element('span', String(index + 1).padStart(2, '0'), 'step-number'),
    );
    const footer = element('div', '', 'step-footer');
    footer.append(statusBadge(effectiveStatus));
    const hint = element('span', '', 'step-hint');
    hint.append(svgIcon('M13 7l-3 3-3-3M10 10V4'), document.createTextNode('Ver'));
    footer.append(hint);
    card.append(heading, footer);
    if (node.steps[step.id]?.error) {
      card.classList.add('has-error');
      const errBadge = element('div', '', 'step-error-badge');
      errBadge.append(svgIcon('M10 6v4M10 14h.01M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z'));
      card.append(errBadge);
    }
    card.addEventListener('click', () => showDetails(node, step));
    graph.append(card);
  }
  scroll.append(graph);
  return scroll;
}

function renderAddInitiativeForm() {
  initiativeForm.textContent = '';
  const form = element('div', '', 'add-form');
  const nameInput = element('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Nome da iniciativa (ex: checkout-v2)';
  const row = element('div', '', 'add-form-actions');
  const saveBtn = element('button', 'Criar', 'btn btn-primary');
  saveBtn.type = 'button';
  saveBtn.style.cssText = 'font-size:.78rem;padding:5px 12px';
  const cancelBtn = element('button', 'Cancelar', 'btn btn-secondary');
  cancelBtn.type = 'button';
  cancelBtn.style.cssText = 'font-size:.78rem;padding:5px 12px';
  row.append(saveBtn, cancelBtn);
  form.append(nameInput, row);

  cancelBtn.addEventListener('click', () => { initiativeForm.textContent = ''; initiativeForm.hidden = true; });
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) { nameInput.focus(); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Criando…';
    try {
      if (!directory) throw new Error('Abra uma pasta de projeto primeiro.');
      let runs = directory;
      for (const part of ['.smith', 'runs']) runs = await runs.getDirectoryHandle(part, { create: true });
      const fileName = `${name}.json`;
      const handle = await runs.getFileHandle(fileName, { create: true });
      const state = { schemaVersion: 2, workflowId: 'project-lifecycle', runId: name, nodes: {} };
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(state, null, 2));
      await writable.close();
      let discoveryDir = directory;
      for (const part of ['workspace', '.discovery', name, 'results']) {
        discoveryDir = await discoveryDir.getDirectoryHandle(part, { create: true });
      }
      for (const folder of Object.keys(labels)) {
        await discoveryDir.getDirectoryHandle(folder, { create: true });
      }
      writeHandles.set(fileName, handle);
      const fileObj = { name: fileName, getFile: () => handle.getFile() };
      files.push(fileObj);
      files.sort((a, b) => a.name.localeCompare(b.name));
      if (!initiative.querySelector(`option[value="${fileName}"]`)) {
        const opt = element('option', fileName);
        opt.value = fileName;
        initiative.append(opt);
      }
      initiative.disabled = false;
      initiative.value = fileName;
      currentStateName = fileName;
      rememberInitiative(fileName);
      initiativeForm.textContent = '';
      initiativeForm.hidden = true;
      await readFile(await handle.getFile());
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Criar';
      form.append(element('div', `Erro: ${err.message}`, 'artifact-error'));
    }
  });

  initiativeForm.append(form);
  initiativeForm.hidden = false;
  nameInput.focus();
}

function renderAddTemaForm(onSave, onCancel) {
  const form = element('div', '', 'add-form');
  form.style.marginTop = '8px';
  const nameInput = element('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Nome do épico/tema (ex: Cadastro e ciclo de vida do contrato)';
  const row = element('div', '', 'add-form-actions');
  const saveBtn = element('button', 'Adicionar', 'btn btn-primary');
  saveBtn.type = 'button';
  saveBtn.style.cssText = 'font-size:.78rem;padding:5px 12px';
  const cancelBtn = element('button', 'Cancelar', 'btn btn-secondary');
  cancelBtn.type = 'button';
  cancelBtn.style.cssText = 'font-size:.78rem;padding:5px 12px';
  row.append(saveBtn, cancelBtn);
  form.append(nameInput, row);

  cancelBtn.addEventListener('click', () => { form.remove(); onCancel?.(); });
  saveBtn.addEventListener('click', async () => {
    const tema = nameInput.value.trim();
    if (!tema) { nameInput.focus(); return; }
    const key = tema.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || Date.now().toString();
    if (currentStateObj.nodes[key]) { nameInput.style.borderColor = '#dc2626'; return; }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando…';
    try {
      currentStateObj.nodes[key] = { tema, steps: {} };
      await persistState();
      content.textContent = '';
      render(currentStateObj);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Adicionar';
      delete currentStateObj.nodes[key];
      form.append(element('div', `Erro: ${err.message}`, 'artifact-error'));
    }
  });
  setTimeout(() => nameInput.focus(), 0);
  return form;
}

function render(state) {
  if (!state || state.schemaVersion < 2 || state.workflowId !== 'project-lifecycle' ||
      typeof state.runId !== 'string' || !state.nodes || typeof state.nodes !== 'object' ||
      Array.isArray(state.nodes)) {
    throw new Error('O arquivo não é um estado válido do Smith.');
  }
  const nodes = Object.values(state.nodes);
  if (!nodes.every((node) => node && typeof node.tema === 'string' &&
      node.steps && typeof node.steps === 'object' && !Array.isArray(node.steps))) {
    throw new Error('Os temas ou etapas do arquivo são inválidos.');
  }

  const overview = element('section', '', 'overview');
  overview.append(element('h2', `Iniciativa: ${state.runId}`));
  const metricsRow = element('div', '', 'metrics-row');
  const statusIcons = {
    completed: 'M5 10l4 4 7-7',
    running: 'M10 3v4M10 13v4M3 10h4M13 10h4',
    pending: 'M10 6v4l2.5 2.5M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
    failed: 'M10 6v4M10 14h.01M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z',
  };
  for (const status of ['completed', 'running', 'pending', 'failed']) {
    const count = nodes.flatMap((node) => steps.map((step) => node.steps[step.id]?.status)).filter((value) => value === status).length;
    const metric = element('div', '', 'metric');
    const icon = element('div', '', `metric-icon ${status}`);
    icon.append(svgIcon(statusIcons[status]));
    const body = element('div', '', 'metric-body');
    body.append(element('strong', String(count)), element('span', statuses[status]));
    metric.append(icon, body);
    metricsRow.append(metric);
  }
  overview.append(metricsRow);
  content.append(overview);

  for (const node of nodes) {
    const theme = element('section', '', 'theme');
    const header = element('div', '', 'theme-header');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    const left = element('div', '', 'theme-header-left');
    left.append(element('h2', node.tema));
    left.append(element('p', 'Clique para expandir o fluxo'));
    const right = element('div', '', '');
    right.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const badge = element('span', '', 'theme-badge');
    badge.append(svgIcon('M4 6h12M4 10h12M4 14h8'), document.createTextNode('Tema'));
    const chevron = element('span', '', 'theme-chevron');
    chevron.append(svgIcon('M5 8l5 5 5-5'));
    right.append(badge, chevron);
    header.append(left, right);
    const graph = diagram(node);
    const toggle = () => {
      const open = theme.classList.toggle('open');
      header.setAttribute('aria-expanded', String(open));
      if (!open) left.querySelector('p').textContent = 'Clique para expandir o fluxo';
      else left.querySelector('p').textContent = 'Selecione uma etapa para consultar seus artefatos';
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    theme.append(header, graph);
    content.append(theme);
  }

  const addTemaBtn = element('button', '', 'btn-add');
  addTemaBtn.type = 'button';
  addTemaBtn.append(svgIcon('M5 10h10M10 5v10'), document.createTextNode(' Adicionar épico'));
  addTemaBtn.addEventListener('click', () => {
    addTemaBtn.hidden = true;
    content.append(renderAddTemaForm(
      () => { /* re-render handled inside */ },
      () => { addTemaBtn.hidden = false; }
    ));
  });
  content.append(addTemaBtn);
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

function makeArtifactAccordion(item, header) {
  const chevron = element('span', '', 'artifact-chevron');
  chevron.append(svgIcon('M5 8l5 5 5-5'));
  header.append(chevron);
  header.addEventListener('click', () => item.classList.toggle('open'));
}


function renderArtifactElement(name, artifact, sequence, loads) {
  const item = element('div', '', 'artifact');
  const artifactHeader = element('div', '', 'artifact-header');
  artifactHeader.append(element('strong', name));
  const path = artifact?.path;
  artifactHeader.append(element('span', typeof path === 'string' ? path : 'Caminho inválido.', 'artifact-path'));
  makeArtifactAccordion(item, artifactHeader);
  item.append(artifactHeader);

  const artifactBody = element('div', '', 'artifact-body');
  if (!validArtifactPath(path)) {
    const warn = element('div', '', 'artifact-warning');
    warn.append(svgIcon('M10 6v4M10 14h.01M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z'), document.createTextNode('Caminho inválido do artefato.'));
    artifactBody.append(warn);
  } else {
    const output = element('div', '', 'artifact-loading');
    const loadingSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    loadingSvg.setAttribute('viewBox', '0 0 20 20'); loadingSvg.setAttribute('fill', 'none');
    loadingSvg.setAttribute('stroke', 'currentColor'); loadingSvg.setAttribute('stroke-width', '1.8');
    const lp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    lp.setAttribute('d', 'M10 3a7 7 0 0 1 7 7'); loadingSvg.append(lp);
    output.append(loadingSvg, document.createTextNode('Carregando artefato…'));
    artifactBody.append(output);
    loads?.push((async () => {
      try {
        const file = await artifactFile(path);
        const text = await file.text();
        if (sequence !== detailSequence) return;
        output.textContent = '';
        output.append(path.toLowerCase().endsWith('.md') ? renderMarkdown(text) : element('pre', text));
      } catch (error) {
        if (sequence === detailSequence) {
          output.textContent = '';
          const errDiv = element('div', '', 'artifact-error');
          errDiv.append(svgIcon('M10 6v4M10 14h.01M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z'), document.createTextNode(`Não foi possível ler o artefato: ${error.message}`));
          output.append(errDiv);
        }
      }
    })());
  }
  item.append(artifactBody);
  return item;
}

async function persistState() {
  if (!currentStateName || !writeHandles.has(currentStateName)) {
    throw new Error('Permissão de escrita não disponível. Reabra a pasta para habilitar edição.');
  }
  const handle = writeHandles.get(currentStateName);
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(currentStateObj, null, 2));
  await writable.close();
}

function getOrCreateStepState(node, stepId) {
  const nodeKey = Object.keys(currentStateObj.nodes).find((k) => currentStateObj.nodes[k].tema === node.tema);
  if (!currentStateObj.nodes[nodeKey].steps[stepId]) {
    currentStateObj.nodes[nodeKey].steps[stepId] = { status: 'pending', artifacts: {} };
  }
  return currentStateObj.nodes[nodeKey].steps[stepId];
}

function renderAddArtifactForm(node, stepId, itemId, onSave, onCancel, fixedName) {
  const form = element('div', '', 'add-form artifact-form-inline');
  let nameInput = null;
  if (!fixedName) {
    const stepDef = steps.find((s) => s.id === stepId);
    const validOutputs = stepDef?.outputs || [];
    nameInput = element('select');
    nameInput.style.cssText = 'padding:7px 10px;border:1px solid var(--color-border);border-radius:var(--radius-sm);font:inherit;font-size:.82rem;outline:none;cursor:pointer;flex-shrink:0;min-width:150px;';
    const placeholder = element('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecione um tipo de artefato';
    placeholder.disabled = true;
    placeholder.selected = true;
    nameInput.append(placeholder);
    for (const output of validOutputs) {
      const opt = element('option', output);
      opt.value = output;
      nameInput.append(opt);
    }
    nameInput.addEventListener('focus', () => { nameInput.style.borderColor = '#93c5fd'; nameInput.style.boxShadow = '0 0 0 2px #bfdbfe'; });
    nameInput.addEventListener('blur', () => { nameInput.style.borderColor = 'var(--color-border)'; nameInput.style.boxShadow = 'none'; });
    form.append(nameInput);
  }
  const pathInput = element('input');
  pathInput.type = 'text';
  pathInput.placeholder = 'workspace/.discovery/<iniciativa>/results/...';
  pathInput.style.cssText = 'flex:1;min-width:200px;';
  pathInput.addEventListener('focus', () => { pathInput.style.borderColor = '#93c5fd'; pathInput.style.boxShadow = '0 0 0 2px #bfdbfe'; });
  pathInput.addEventListener('blur', () => { pathInput.style.borderColor = 'var(--color-border)'; pathInput.style.boxShadow = 'none'; });
  const saveBtn = element('button', 'Salvar', 'btn btn-primary');
  saveBtn.type = 'button';
  saveBtn.style.cssText = 'font-size:.78rem;padding:5px 12px;flex-shrink:0;';
  const cancelBtn = element('button', 'Cancelar', 'btn btn-secondary');
  cancelBtn.type = 'button';
  cancelBtn.style.cssText = 'font-size:.78rem;padding:5px 12px;flex-shrink:0;';
  form.append(pathInput, saveBtn, cancelBtn);

  cancelBtn.addEventListener('click', () => { form.remove(); onCancel?.(); });
  saveBtn.addEventListener('click', async () => {
    const name = fixedName || (nameInput ? nameInput.value.trim() : '');
    const path = pathInput.value.trim();
    if (!name) { nameInput?.focus(); return; }
    if (!path) { pathInput.focus(); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando…';
    try {
      const stepState = getOrCreateStepState(node, stepId);
      if (itemId) {
        if (!stepState.items) stepState.items = {};
        if (!stepState.items[itemId]) stepState.items[itemId] = { label: itemId, artifacts: {} };
        if (!stepState.items[itemId].artifacts) stepState.items[itemId].artifacts = {};
        stepState.items[itemId].artifacts[name] = { path };
      } else {
        if (!stepState.artifacts) stepState.artifacts = {};
        stepState.artifacts[name] = { path };
      }
      if (stepState.status === 'pending') stepState.status = 'running';
      await persistState();
      const card = document.querySelector(`[data-step="${stepId}"]`);
      if (card) {
        card.className = `step ${stepState.status}`;
        const badge = card.querySelector('.status-badge');
        if (badge) badge.replaceWith(statusBadge(stepState.status));
      }
      form.remove();
      onSave?.();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar';
      form.append(element('div', `Erro: ${err.message}`, 'artifact-error'));
    }
  });
  return form;
}

function renderAddItemForm(node, stepId, onSave, onCancel) {
  const form = element('div', '', 'add-form');
  const idInput = element('input');
  idInput.type = 'text';
  idInput.placeholder = 'ID da história (ex: hist-a)';
  const labelInput = element('input');
  labelInput.type = 'text';
  labelInput.placeholder = 'Nome da história (ex: História A — Agendamento)';
  const row = element('div', '', 'add-form-actions');
  const saveBtn = element('button', 'Adicionar', 'btn btn-primary');
  saveBtn.type = 'button';
  saveBtn.style.cssText = 'font-size:.78rem;padding:5px 12px';
  const cancelBtn = element('button', 'Cancelar', 'btn btn-secondary');
  cancelBtn.type = 'button';
  cancelBtn.style.cssText = 'font-size:.78rem;padding:5px 12px';
  row.append(saveBtn, cancelBtn);
  form.append(idInput, labelInput, row);

  cancelBtn.addEventListener('click', () => { form.remove(); onCancel?.(); });
  saveBtn.addEventListener('click', async () => {
    const id = idInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    const label = labelInput.value.trim() || id;
    if (!id) { idInput.focus(); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando…';
    try {
      const stepState = getOrCreateStepState(node, stepId);
      if (!stepState.items) stepState.items = {};
      if (stepState.items[id]) {
        idInput.style.borderColor = '#dc2626';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Adicionar';
        return;
      }
      stepState.items[id] = { label, status: 'pending', artifacts: {} };
      await persistState();
      form.remove();
      onSave?.();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Adicionar';
      form.append(element('div', `Erro: ${err.message}`, 'artifact-error'));
    }
  });
  return form;
}

function renderItemsSection(node, step, state, sequence, loads) {
  const section = element('div', '', 'items-section');
  section.append(element('div', 'Histórias', 'artifacts-heading'));

  const isTechnicalRefinement = step.id === 'technical-refinement';

  let items;
  if (isTechnicalRefinement) {
    const nodeKey = Object.keys(currentStateObj?.nodes || {}).find((k) => currentStateObj.nodes[k].tema === node.tema);
    const breakdownItems = currentStateObj?.nodes?.[nodeKey]?.steps?.['story-task-breakdown']?.items || {};
    const stateItems = (state.items && typeof state.items === 'object' && !Array.isArray(state.items)) ? state.items : {};
    const allIds = [...new Set([...Object.keys(breakdownItems), ...Object.keys(stateItems)])];
    if (!allIds.length) {
      const empty = element('div', '', 'empty-artifacts');
      empty.append(svgIcon('M4 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'));
      empty.append(element('span', 'Nenhuma história encontrada. Registre histórias na etapa "Quebra de histórias e plano" primeiro.'));
      section.append(empty);
      return section;
    }
    items = allIds.map((id) => {
      const bItem = breakdownItems[id] || {};
      const techItem = stateItems[id] || { status: 'pending', artifacts: {} };
      return [id, { label: techItem.label || bItem.label || id, status: techItem.status || 'pending', artifacts: techItem.artifacts || {} }];
    });
  } else {
    items = state.items && typeof state.items === 'object' && !Array.isArray(state.items)
      ? Object.entries(state.items) : [];
  }

  if (!items.length) {
    const empty = element('div', '', 'empty-artifacts');
    empty.append(svgIcon('M4 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'));
    empty.append(element('span', 'Nenhuma história registrada nesta etapa.'));
    section.append(empty);
  }

  for (const [id, item] of items) {
    const card = element('div', '', 'item-card');
    const header = element('div', '', 'item-header');
    const headerLeft = element('div', '');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
    headerLeft.append(statusBadge(item.status || 'pending'), element('span', item.label || id, 'item-label'));
    const chevronBtn = element('button', '');
    chevronBtn.type = 'button';
    chevronBtn.style.cssText = 'background:none;border:none;padding:4px;cursor:pointer;color:var(--color-text-muted);line-height:0;flex-shrink:0';
    chevronBtn.setAttribute('aria-label', 'Expandir');
    chevronBtn.append(svgIcon('M5 8l5 5 5-5'));
    header.append(headerLeft, chevronBtn);
    card.append(header);

    const body = element('div', '', 'item-body');
    body.hidden = true;

    const isArrayArtifacts = Array.isArray(item.artifacts);
    const itemArtifacts = item.artifacts && typeof item.artifacts === 'object' && !isArrayArtifacts
      ? Object.entries(item.artifacts) : [];
    const singleArtifact = step.id === 'technical-refinement';

    if (singleArtifact) {
      if (itemArtifacts.length) {
        const [, artifact] = itemArtifacts[0];
        const aItem = renderArtifactElement('Detalhamento técnico', artifact, sequence, loads);
        aItem.classList.add('open');
        body.append(aItem);

        const replaceBtn = element('button', '', 'btn-add');
        replaceBtn.type = 'button';
        replaceBtn.style.marginTop = '8px';
        replaceBtn.append(svgIcon('M4 4l12 12M4 16L10 10M14 6l2-2M9.5 9.5L16 16'), document.createTextNode(' Substituir detalhamento'));
        replaceBtn.addEventListener('click', () => {
          replaceBtn.hidden = true;
          const fixedName = itemArtifacts[0][0];
          body.append(renderAddArtifactForm(node, step.id, id, () => showDetails(node, step), () => { replaceBtn.hidden = false; }, fixedName));
        });
        body.append(replaceBtn);
      } else {
        const noArt = element('p', 'Sem detalhamento técnico registrado.');
        noArt.style.cssText = 'color:var(--color-text-muted);font-size:.82rem;margin:0 0 8px';
        body.append(noArt);

        const addArtBtn = element('button', '', 'btn-add');
        addArtBtn.type = 'button';
        addArtBtn.append(svgIcon('M5 10h10M10 5v10'), document.createTextNode(' Registrar detalhamento'));
        addArtBtn.addEventListener('click', () => {
          addArtBtn.hidden = true;
          body.append(renderAddArtifactForm(node, step.id, id, () => showDetails(node, step), () => { addArtBtn.hidden = false; }));
        });
        body.append(addArtBtn);
      }
    } else {
      if (isArrayArtifacts) {
        for (let i = 0; i < item.artifacts.length; i++) {
          const artifact = item.artifacts[i];
          const aItem = renderArtifactElement(`Artefato ${i + 1}`, artifact, sequence, loads);
          aItem.classList.add('open');
          body.append(aItem);
        }
      } else {
        if (!itemArtifacts.length) {
          const noArt = element('p', 'Nenhum artefato registrado.');
          noArt.style.cssText = 'color:var(--color-text-muted);font-size:.82rem;margin:0 0 8px';
          body.append(noArt);
        }
        for (const [aName, artifact] of itemArtifacts) {
          const aItem = renderArtifactElement(aName, artifact, sequence, loads);
          aItem.classList.add('open');
          body.append(aItem);
        }
      }

      const addArtBtn = element('button', '', 'btn-add');
      addArtBtn.type = 'button';
      addArtBtn.append(svgIcon('M5 10h10M10 5v10'), document.createTextNode(' Registrar artefato'));
      addArtBtn.addEventListener('click', () => {
        addArtBtn.hidden = true;
        body.append(renderAddArtifactForm(node, step.id, id, () => showDetails(node, step), () => { addArtBtn.hidden = false; }));
      });
      body.append(addArtBtn);
    }
    card.append(body);

    const toggleBody = () => {
      body.hidden = !body.hidden;
      chevronBtn.querySelector('path').setAttribute('d', body.hidden ? 'M5 8l5 5 5-5' : 'M5 12l5-5 5 5');
    };
    chevronBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleBody(); });
    header.addEventListener('click', toggleBody);

    section.append(card);
  }

  if (!isTechnicalRefinement) {
    const addItemBtn = element('button', '', 'btn-add');
    addItemBtn.type = 'button';
    addItemBtn.append(svgIcon('M5 10h10M10 5v10'), document.createTextNode(' Adicionar história'));
    addItemBtn.addEventListener('click', () => {
      addItemBtn.hidden = true;
      section.append(renderAddItemForm(node, step.id, () => showDetails(node, step), () => { addItemBtn.hidden = false; }));
    });
    section.append(addItemBtn);
  }

  return section;
}
async function showDetails(node, step) {
  const sequence = ++detailSequence;
  details.textContent = '';
  details.hidden = false;
  overlay.hidden = false;

  const topbar = element('div', '', 'details-topbar');
  const close = element('button', '', 'btn btn-secondary');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar');
  close.style.cssText = 'padding: 6px; line-height: 0; flex-shrink: 0;';
  close.append(svgIcon('M5 5l10 10M15 5L5 15'));
  close.addEventListener('click', closeDetails);
  topbar.append(element('h2', labels[step.id] || step.id), close);
  details.append(topbar);
  overlay.addEventListener('click', closeDetails, { once: true });

  const scroll = element('div', '', 'details-scroll');

  const state = node.steps[step.id] || {};
  const metaRow = element('div', '', 'detail-meta-row');

  const themeChip = element('span', '', 'detail-chip');
  themeChip.append(svgIcon('M4 6h12M4 10h12M4 14h8'), document.createTextNode(node.tema));
  metaRow.append(themeChip);

  const statusChip = element('span', '', 'detail-chip');
  statusChip.append(svgIcon('M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z'), document.createTextNode(statuses[state.status] ?? statuses['pending']));
  metaRow.append(statusChip);

  const depsChip = element('span', '', 'detail-chip');
  depsChip.append(svgIcon('M5 10h10M10 5l5 5-5 5'), document.createTextNode(step.requires.length ? `Depende de: ${step.requires.join(', ')}` : 'Sem dependências'));
  metaRow.append(depsChip);
  scroll.append(metaRow);

  const hasEngineError = !!state.error;
  const hasUnknownStatus = !!state.status && !Object.hasOwn(statuses, state.status);
  if (hasEngineError || hasUnknownStatus) {
    const errorBanner = element('div', '', 'engine-error-banner');
    const bannerIcon = svgIcon('M10 6v4M10 14h.01M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z');
    const textCol = element('div', '', 'engine-error-text');
    if (hasEngineError) {
      const msgLine = element('div', '');
      msgLine.append(element('strong', 'Erro do engine: '), document.createTextNode(state.error));
      textCol.append(msgLine);
    }
    if (hasUnknownStatus) {
      const statusLine = element('div', `Status desconhecido: "${state.status}"`);
      if (hasEngineError) statusLine.style.marginTop = '4px';
      textCol.append(statusLine);
    }
    const actions = element('div', '', 'engine-error-actions');
    if (hasEngineError) {
      const clearBtn = element('button', 'Limpar erro', 'btn btn-secondary');
      clearBtn.type = 'button';
      clearBtn.style.cssText = 'font-size:.72rem;padding:4px 10px;';
      clearBtn.addEventListener('click', async () => {
        try {
          const nodeKey = Object.keys(currentStateObj.nodes).find((k) => currentStateObj.nodes[k].tema === node.tema);
          delete currentStateObj.nodes[nodeKey].steps[step.id].error;
          await persistState();
          errorBanner.remove();
          const stepCard = document.querySelector(`[data-step="${step.id}"]`);
          if (stepCard) { stepCard.classList.remove('has-error'); stepCard.querySelector('.step-error-badge')?.remove(); }
        } catch (err) { clearBtn.textContent = `Erro: ${err.message}`; }
      });
      actions.append(clearBtn);
    }
    if (hasUnknownStatus) {
      for (const s of ['completed', 'running', 'pending']) {
        const fixBtn = element('button', `→ ${statuses[s]}`, 'btn btn-secondary');
        fixBtn.type = 'button';
        fixBtn.style.cssText = 'font-size:.72rem;padding:4px 10px;';
        fixBtn.addEventListener('click', async () => {
          try {
            const nodeKey = Object.keys(currentStateObj.nodes).find((k) => currentStateObj.nodes[k].tema === node.tema);
            currentStateObj.nodes[nodeKey].steps[step.id].status = s;
            await persistState();
            const stepCard = document.querySelector(`[data-step="${step.id}"]`);
            if (stepCard) { stepCard.className = `step ${s}`; const badge = stepCard.querySelector('.status-badge'); if (badge) badge.replaceWith(statusBadge(s)); }
            await showDetails(node, step);
          } catch (err) { fixBtn.textContent = `Erro: ${err.message}`; }
        });
        actions.append(fixBtn);
      }
    }
    textCol.append(actions);
    errorBanner.append(bannerIcon, textCol);
    scroll.append(errorBanner);
  }

  const isApprovalGate = step.kind === 'approval' || step.id === 'validation-gate';
  let artifacts = [];

  if (isApprovalGate) {
    if (state.approvedArtifacts && Object.keys(state.approvedArtifacts).length > 0) {
      const approvedData = Object.entries(state.approvedArtifacts);
      for (const [stepId, artifactGroup] of approvedData) {
        if (Array.isArray(artifactGroup)) {
          for (let i = 0; i < artifactGroup.length; i++) {
            const item = artifactGroup[i];
            if (item && typeof item === 'object') {
              if (typeof item.path === 'string') {
                artifacts.push([`${stepId} [${i + 1}/${artifactGroup.length}]`, item]);
              } else {
                for (const [name, art] of Object.entries(item)) {
                  artifacts.push([`${stepId} [${i + 1}/${artifactGroup.length}] - ${name}`, art]);
                }
              }
            }
          }
        } else if (artifactGroup && typeof artifactGroup === 'object') {
          if (typeof artifactGroup.path === 'string') {
            artifacts.push([stepId, artifactGroup]);
          } else {
            for (const [name, art] of Object.entries(artifactGroup)) {
              artifacts.push([name === stepId ? stepId : `${stepId} - ${name}`, art]);
            }
          }
        }
      }
    } else if (step.requires && step.requires.length > 0) {
      for (const reqStepId of step.requires) {
        const upstreamState = node.steps[reqStepId] || {};
        if (upstreamState.artifacts) {
          if (Array.isArray(upstreamState.artifacts)) {
            for (let i = 0; i < upstreamState.artifacts.length; i++) {
              const artifactObj = upstreamState.artifacts[i];
              if (artifactObj && typeof artifactObj === 'object') {
                if (typeof artifactObj.path === 'string') {
                  artifacts.push([`${reqStepId} [${i + 1}/${upstreamState.artifacts.length}]`, artifactObj]);
                } else {
                  for (const [name, artifact] of Object.entries(artifactObj)) {
                    artifacts.push([`${reqStepId} [${i + 1}/${upstreamState.artifacts.length}] - ${name}`, artifact]);
                  }
                }
              }
            }
          } else if (typeof upstreamState.artifacts === 'object') {
            for (const [name, artifact] of Object.entries(upstreamState.artifacts)) {
              artifacts.push([`${reqStepId} - ${name}`, artifact]);
            }
          }
        }
      }
    }
  } else {
    if (Array.isArray(state.artifacts)) {
      for (let i = 0; i < state.artifacts.length; i++) {
        const item = state.artifacts[i];
        if (item && typeof item === 'object') {
          if (typeof item.path === 'string') {
            const displayName = state.artifacts.length > 1
              ? `${step.id} [${i + 1}/${state.artifacts.length}]`
              : step.id;
            artifacts.push([displayName, item]);
          } else {
            for (const [name, artifact] of Object.entries(item)) {
              const displayName = state.artifacts.length > 1
                ? `${name} [${i + 1}/${state.artifacts.length}]`
                : name;
              artifacts.push([displayName, artifact]);
            }
          }
        }
      }
    } else if (state.artifacts && typeof state.artifacts === 'object') {
      artifacts = Object.entries(state.artifacts);
    }
  }

  const hideArtifactsSection = STEPS_WITH_ITEMS.has(step.id) && !artifacts.length;

  if (!hideArtifactsSection) {
    const sectionLabel = STEP_SECTION_LABEL[step.id] || 'Artefatos';
    const addArtBtn = element('button', '', 'btn btn-secondary btn-icon');
    addArtBtn.type = 'button';
    addArtBtn.title = (STEP_ADD_LABEL[step.id] || ' Registrar artefato').trim();
    addArtBtn.append(svgIcon('M5 10h10M10 5v10'));
    const copyPromptBtn = element('button', '', 'btn btn-secondary btn-icon');
    copyPromptBtn.type = 'button';
    copyPromptBtn.title = 'Copiar sugestão de prompt';
    copyPromptBtn.append(svgIcon('M10 2l1.5 5.5 5.5 1.5-5.5 1.5L10 16l-1.5-5.5L3 9l5.5-1.5L10 2zM16 13l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z'));
    copyPromptBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(buildStepPrompt(step, node));
        const pathEl = copyPromptBtn.querySelector('path');
        const orig = pathEl.getAttribute('d');
        pathEl.setAttribute('d', 'M5 10l4 4 7-7');
        setTimeout(() => pathEl.setAttribute('d', orig), 1500);
      } catch {}
    });
    const headingActions = element('div', '');
    headingActions.style.cssText = 'display:flex;align-items:center;gap:6px;';

    
    if (!isApprovalGate) {
      headingActions.append(copyPromptBtn, addArtBtn);
    } else {
      headingActions.append(copyPromptBtn);
    }
    const headingRow = element('div', '');
    headingRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--color-border);';
    const headingText = element('span', sectionLabel);
    headingText.style.cssText = 'font-size:.68rem;font-weight:750;letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted);';
    headingRow.append(headingText, headingActions);
    scroll.append(headingRow);

    if (!isApprovalGate) {
      addArtBtn.addEventListener('click', () => {
        addArtBtn.hidden = true;
        const form = renderAddArtifactForm(node, step.id, null, () => showDetails(node, step), () => { addArtBtn.hidden = false; });
        scroll.insertBefore(form, scroll.children[1]);
      });
    }

    if (!artifacts.length && !isApprovalGate) {
      const empty = element('div', '', 'empty-artifacts');
      empty.append(svgIcon('M9 12h6M9 16h6M6 8h.01M6 12h.01M6 16h.01M4 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'));
      const emptyMsg = STEP_SECTION_LABEL[step.id]
        ? `Nenhum artefato registrado em ${sectionLabel.toLowerCase()}.`
        : 'Nenhum artefato registrado nesta etapa.';
      empty.append(element('span', emptyMsg));
      scroll.append(empty);
    }
  }

  const loads = [];
  for (const [name, artifact] of (hideArtifactsSection ? [] : artifacts)) {
    const item = renderArtifactElement(name, artifact, sequence, loads);
    scroll.append(item);
  }
  if (STEPS_WITH_ITEMS.has(step.id)) {
    scroll.append(renderItemsSection(node, step, state, sequence, loads));
  }

  details.append(scroll);
  await Promise.all(loads);
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
      const node = element(`h${heading[1].length}`, '');
      renderInline(node, heading[2]); result.append(node); index += 1; continue;
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
      const ul = element(ordered ? 'ol' : 'ul', '');
      while (index < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.+)$/.exec(lines[index]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        const li = element('li', ''); renderInline(li, item[2]); ul.append(li); index += 1;
      }
      result.append(ul); continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = element('blockquote', '');
      const parts = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) parts.push(lines[index++].replace(/^\s*>\s?/, ''));
      renderInline(quote, parts.join('\n')); result.append(quote); continue;
    }
    const paragraph = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !isBlock(lines[index]) &&
      !(index + 1 < lines.length && lines[index].includes('|') && isTableRule(lines[index + 1]))) {
      paragraph.push(lines[index++]);
    }
    const node = element('p', ''); renderInline(node, paragraph.join('\n')); result.append(node);
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
    currentStateObj = state;
    if (sequence === loadSequence) render(state);
  } catch (error) {
    if (sequence !== loadSequence) return;
    content.textContent = '';
    message.textContent = `Não foi possível ler o arquivo: JSON ou estado inválido. ${error.message}`;
  }
}

async function selectInitiative() {
  const file = files.find((item) => item.name === initiative.value);
  if (!file) return;
  currentStateName = file.name;
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
  writeHandles = new Map();
  runsHandle = runs;
  for await (const entry of runs.values()) {
    if (entry.kind === 'file') {
      const entryName = entry.name;
      items.push({ name: entryName, getFile: async () => (await runsHandle.getFileHandle(entryName)).getFile() });
      if (/\.json$/i.test(entry.name)) writeHandles.set(entry.name, entry);
    }
  }
  directory = handle;
  project = handle;
  projectFiles = undefined;
  refreshFolder.hidden = false;
  restoreFolder.hidden = true;
  addInitiativeBtn.hidden = false;
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
    const handle = await showDirectoryPicker({ mode: 'readwrite' });
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
    if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      message.textContent = 'Permissão para a pasta não concedida.';
      return;
    }
    await readDirectory(directory);
  } catch (error) { message.textContent = `Não foi possível reabrir a pasta: ${error.message}`; }
});

refreshFolder.addEventListener('click', async () => {
  try { await readDirectory(directory); }
  catch (error) { message.textContent = `Não foi possível atualizar a pasta: ${error.message}`; }
});

addInitiativeBtn.addEventListener('click', () => {
  if (initiativeForm.hidden) renderAddInitiativeForm();
  else { initiativeForm.textContent = ''; initiativeForm.hidden = true; }
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
