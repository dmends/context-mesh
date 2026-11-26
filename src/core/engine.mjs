import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readdir, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';
import { StepStatus } from '../domain/status.mjs';
import { WorkflowError } from '../domain/errors.mjs';
import { acquireRunLock, processIsAlive } from './run-lock.mjs';
import { statePath, createInitialState, createInitialNodeState, saveState } from './state-store.mjs';

const APPROVAL_CONFIRMATION = 'APPROVE';
const SOURCE_ROLES = Object.freeze(['legacy', 'target', 'reference', 'integration', 'documentation']);
const SOURCE_KINDS = Object.freeze(['repository', 'document']);
const STEP_STATUSES = new Set(Object.values(StepStatus));

export function findNode(state, nodeId) {
  return state.nodes.find((node) => node.id === nodeId);
}

function resetStep(current, step, status = StepStatus.PENDING, errorMessage) {
  for (const key of Object.keys(current)) delete current[key];
  Object.assign(current, emptyStepState(step), { status });
  if (errorMessage) current.error = errorMessage;
}

export function findNodeByTema(state, tema) {
  return state.nodes.find((node) => node.tema === tema);
}

export function findStep(node, stepType) {
  return node.steps.find((step) => step.type === stepType);
}

function topicSlug(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function assertRunContext({ workspaceRoot, runId, tema, inputFiles }) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new WorkflowError('INVALID_RUN_CONTEXT', 'workspaceRoot is required');
  }
  if (typeof runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId)) {
    throw new WorkflowError('INVALID_RUN_CONTEXT', 'runId must contain 1–64 letters, numbers, underscores, or hyphens');
  }
  if (tema !== undefined && (typeof tema !== 'string' || !tema.trim())) {
    throw new WorkflowError('INVALID_RUN_CONTEXT', 'tema must be a non-empty string');
  }
  if (!Array.isArray(inputFiles)) {
    throw new WorkflowError('INVALID_RUN_CONTEXT', 'inputFiles must be an array');
  }
}

async function resolveRunContext(context) {
  assertRunContext(context);
  const workspaceRoot = resolve(context.workspaceRoot);
  const realRoot = await realpath(workspaceRoot);
  const inputs = [...new Set(context.inputFiles)].sort();
  const topics = new Set();

  if (inputs.length > 0) {
    for (const input of inputs) {
      if (typeof input !== 'string' || input.length === 0 || isAbsolute(input)) {
        throw new WorkflowError('INVALID_RUN_CONTEXT', 'inputFiles must contain non-empty relative paths');
      }

      const absolutePath = resolve(workspaceRoot, input);
      const relativePath = relative(workspaceRoot, absolutePath);
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
        throw new WorkflowError('PREREQ_NOT_MET', `Input path must stay inside the workspace: ${input}`);
      }

      let actualPath;
      try {
        actualPath = await realpath(absolutePath);
        const actualRelativePath = relative(realRoot, actualPath);
        if (
          !actualRelativePath ||
          actualRelativePath === '..' ||
          actualRelativePath.startsWith(`..${sep}`) ||
          isAbsolute(actualRelativePath)
        ) {
          throw new WorkflowError('PREREQ_NOT_MET', `Input resolves outside the workspace: ${input}`);
        }
        const topic = /^workspace\/\.discovery\/([^/]+)\//.exec(actualRelativePath.split(sep).join('/'))?.[1];
        if (topic) topics.add(topic);
      } catch (error) {
        if (error.message.startsWith('Input resolves outside')) {
          throw error;
        }
        throw new WorkflowError('PREREQ_NOT_MET', `Input file cannot be read: ${input}`, { cause: error });
      }
    }
  }

  if (!context.tema && topics.size > 1) {
    throw new WorkflowError('PREREQ_NOT_MET', 'Workflow inputs belong to multiple discovery topics; provide an explicit tema');
  }
  if (inputs.length === 0 && !context.tema) {
    throw new WorkflowError('PREREQ_NOT_MET', '--tema is required when no --input files are provided');
  }
  const inputTopic = [...topics][0] ?? context.runId;
  const tema = context.tema?.trim() ?? inputTopic;
  const nodeId = topicSlug(tema);
  if (!nodeId) throw new WorkflowError('PREREQ_NOT_MET', `Invalid tema; it must contain letters or numbers: ${tema}`);
  return {
    ...context,
    workspaceRoot,
    tema,
    nodeId,
    initiative: context.tema ? context.runId : inputTopic,
  };
}


async function withRunLock(context, action) {
  const release = await acquireRunLock(statePath(context));
  try {
    return await action();
  } finally {
    await release();
  }
}

async function loadOrCreateState(context) {
  const filePath = statePath(context);
  let initiativeState;
  try {
    const text = await readFile(filePath, 'utf8');
    try {
      initiativeState = JSON.parse(text);
    } catch (error) {
      throw new WorkflowError('INVALID_RUN_STATE', `Workflow state is not valid JSON: ${filePath}`, { cause: error });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    initiativeState = createInitialState(context);
  }

  validateState(initiativeState, context, filePath);
  let state = findNode(initiativeState, context.nodeId);
  if (!state) {
    state = createInitialNodeState(context);
    initiativeState.nodes.push(state);
    initiativeState.updatedAt = state.updatedAt;
    await saveState(filePath, initiativeState);
    return { initiativeState, state };
  }
  if (state.tema !== context.tema) {
    throw new WorkflowError('PREREQ_NOT_MET', `Tema "${context.tema}" collides with existing tema "${state.tema}" after normalization`);
  }

  let changed = false;

  // Detect input file changes and invalidate non-accumulative completed steps
  if (context.inputFiles?.length > 0) {
    const currentFingerprint = await computeInputFingerprint(context.workspaceRoot, context.inputFiles);
    if (state.inputFingerprint && state.inputFingerprint !== currentFingerprint) {
      for (const step of WORKFLOW_STEPS) {
        const current = findStep(state, step.id);
        if (current?.status === StepStatus.COMPLETED && !step.accumulative && step.kind !== 'approval') {
          resetStep(current, step);
          changed = true;
        }
      }
    }
    if (state.inputFingerprint !== currentFingerprint) {
      state.inputFingerprint = currentFingerprint;
      changed = true;
    }
  }

  for (const step of WORKFLOW_STEPS) {
    const current = findStep(state, step.id);
    if (!current || (current.status !== StepStatus.COMPLETED && current.status !== StepStatus.ACCUMULATING) || step.kind === 'approval') {
      continue;
    }
    try {
      await verifyStoredArtifacts(context, step, current.artifacts);
    } catch (error) {
      if (!(error instanceof ArtifactValidationError)) {
        throw error;
      }
      invalidateFromStep(state, step.id, error.message);
      state.updatedAt = new Date().toISOString();
      changed = true;
      break;
    }
  }

  const gate = WORKFLOW_STEPS.find(({ kind }) => kind === 'approval');
  const gateState = findStep(state, gate.id);
  if (gateState?.status === StepStatus.COMPLETED) {
    for (const dependencyId of gate.requires) {
      const currentArtifacts = findStep(state, dependencyId)?.artifacts;
      const approvedArtifacts = gateState.approvedArtifacts?.find(({ stepType }) => stepType === dependencyId)?.artifacts;
      if (!sameArtifactReferences(currentArtifacts, approvedArtifacts)) {
        invalidateFromStep(
          state,
          dependencyId,
          `Approval invalidated because "${dependencyId}" changed`,
        );
        state.updatedAt = new Date().toISOString();
        changed = true;
        break;
      }
    }
  }
  if (changed) {
    initiativeState.updatedAt = state.updatedAt;
    await saveState(filePath, initiativeState);
  }
  return { initiativeState, state };
}

function emptyStepState(step) {
  return {
    name: step.name ?? step.id,
    type: step.id,
    status: StepStatus.PENDING,
    artifacts: [],
    items: [],
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateArtifactList(artifacts, label) {
  if (!Array.isArray(artifacts)) throw new WorkflowError('INVALID_RUN_STATE', `${label} must be an array`);
  const identities = new Set();
  for (const artifact of artifacts) {
    if (!isRecord(artifact) || typeof artifact.name !== 'string' || !artifact.name ||
        typeof artifact.path !== 'string' || !artifact.path ||
        (artifact.groupId !== undefined && (typeof artifact.groupId !== 'string' || !artifact.groupId))) {
      throw new WorkflowError('INVALID_RUN_STATE', `${label} contains an invalid artifact reference`);
    }
    const identity = `${artifact.groupId ?? ''}\0${artifact.name}`;
    if (identities.has(identity)) throw new WorkflowError('INVALID_RUN_STATE', `${label} contains duplicate artifact names`);
    identities.add(identity);
  }
}

function validateState(state, context, filePath) {
  const invalid = (detail) => {
    throw new WorkflowError('INVALID_RUN_STATE', `Invalid schema 1 workflow state (${detail}): ${filePath}`);
  };
  if (!isRecord(state) || state.schemaVersion !== 1 || state.workflowId !== 'project-lifecycle' ||
      state.runId !== context.runId || typeof state.createdAt !== 'string' ||
      typeof state.updatedAt !== 'string' || !Array.isArray(state.nodes) || !Array.isArray(state.sources)) {
    invalid('root fields');
  }
  const nodeIds = new Set();
  for (const node of state.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id ||
        typeof node.tema !== 'string' || !node.tema || typeof node.createdAt !== 'string' ||
        typeof node.updatedAt !== 'string' || !Array.isArray(node.steps) ||
        nodeIds.has(node.id) || !Array.isArray(node.steps)) invalid('node fields');
    nodeIds.add(node.id);
    if (node.steps.length !== WORKFLOW_STEPS.length) invalid(`steps for ${node.id}`);
    const stepTypes = new Set();
    for (const [index, step] of node.steps.entries()) {
      if (!isRecord(step) || typeof step.type !== 'string' || stepTypes.has(step.type) ||
          step.type !== WORKFLOW_STEPS[index]?.id || typeof step.name !== 'string' ||
          !STEP_STATUSES.has(step.status) || !Array.isArray(step.items)) invalid(`step fields for ${node.id}`);
      stepTypes.add(step.type);
      validateArtifactList(step.artifacts, `artifacts for ${step.type}`);
      const definition = WORKFLOW_STEPS[index];
      const artifactGroups = definition.accumulative
        ? groupArtifactReferences(step.artifacts)
        : [Object.fromEntries(step.artifacts.map((artifact) => [artifact.name, artifact]))];
      const expectedOutputs = [...definition.outputs].sort();
      const hasCompleteOutputs = artifactGroups.length > 0 && artifactGroups.every((group) =>
        JSON.stringify(Object.keys(group).sort()) === JSON.stringify(expectedOutputs));
      if (step.status === StepStatus.COMPLETED && definition.kind !== 'approval' &&
          (step.artifacts.some(({ groupId }) => groupId !== undefined) || !hasCompleteOutputs)) {
        invalid(`completed outputs for ${step.type}`);
      }
      if (step.status === StepStatus.ACCUMULATING &&
          (!definition.accumulative || !step.artifacts.length || !hasCompleteOutputs)) {
        invalid(`accumulated outputs for ${step.type}`);
      }
      const itemIds = new Set();
      for (const item of step.items) {
        if (!isRecord(item) || typeof item.id !== 'string' || !item.id ||
            typeof item.label !== 'string' || !STEP_STATUSES.has(item.status) ||
            itemIds.has(item.id)) invalid(`items for ${step.type}`);
        itemIds.add(item.id);
        validateArtifactList(item.artifacts, `item artifacts for ${step.type}`);
      }
      if (step.approvedArtifacts !== undefined) {
        if (!Array.isArray(step.approvedArtifacts)) invalid(`approvedArtifacts for ${step.type}`);
        const approvedTypes = new Set();
        for (const approval of step.approvedArtifacts) {
          if (!isRecord(approval) || typeof approval.stepType !== 'string' ||
              !WORKFLOW_STEPS.some(({ id }) => id === approval.stepType) ||
              approvedTypes.has(approval.stepType)) invalid(`approval snapshot for ${step.type}`);
          approvedTypes.add(approval.stepType);
          validateArtifactList(approval.artifacts, `approval artifacts for ${step.type}`);
        }
      }
      if (step.type === 'validation-gate' && step.status === StepStatus.COMPLETED &&
          (!Array.isArray(step.approvedArtifacts) || typeof step.approvedAt !== 'string' ||
           !/^[a-f0-9]{64}$/.test(step.approvalFingerprint ?? ''))) invalid('completed approval gate');
      if (step.status === StepStatus.RUNNING &&
          (!Number.isSafeInteger(step.executionPid) || typeof step.executionToken !== 'string' || !step.executionToken)) {
        invalid(`running step metadata for ${step.type}`);
      }
    }
    if (stepTypes.size !== WORKFLOW_STEPS.length) invalid(`missing steps for ${node.id}`);
  }
  const sourceIds = new Set();
  const sourcePaths = new Set();
  for (const source of state.sources) {
    if (!isRecord(source) || typeof source.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(source.id) ||
        typeof source.path !== 'string' || !source.path || !SOURCE_KINDS.includes(source.kind) ||
        !SOURCE_ROLES.includes(source.role) || sourceIds.has(source.id) || sourcePaths.has(source.path)) {
      invalid('sources');
    }
    if (isAbsolute(source.path) || source.path.includes('\\') ||
        source.path.split('/').some((part) => !part || part === '.' || part === '..')) invalid('source path');
    for (const field of ['stack', 'scope', 'description']) {
      if (source[field] !== undefined && (typeof source[field] !== 'string' || !source[field].trim())) invalid('source metadata');
    }
    if (source.scope !== undefined && (isAbsolute(source.scope) || source.scope.includes('\\') ||
        source.scope.split('/').some((part) => !part || part === '.' || part === '..'))) invalid('source scope');
    sourceIds.add(source.id);
    sourcePaths.add(source.path);
  }
}

class ArtifactValidationError extends WorkflowError {
  constructor(message, options) {
    super('ARTIFACT_NOT_FOUND', message, options);
    this.name = 'ArtifactValidationError';
  }
}

export async function createArtifactReference(workspaceRoot, artifactRelativePath) {
  if (
    typeof artifactRelativePath !== 'string' ||
    artifactRelativePath.length === 0 ||
    isAbsolute(artifactRelativePath)
  ) {
    throw new ArtifactValidationError('Artifact path must be a non-empty relative path');
  }

  const root = resolve(workspaceRoot);
  const artifactPath = resolve(root, artifactRelativePath);
  const workspaceRelativePath = relative(root, artifactPath);
  if (
    !workspaceRelativePath ||
    workspaceRelativePath === '..' ||
    workspaceRelativePath.startsWith(`..${sep}`)
  ) {
    throw new ArtifactValidationError('Artifact path must stay inside the workspace');
  }

  let realRoot;
  let realArtifact;
  try {
    [realRoot, realArtifact] = await Promise.all([realpath(root), realpath(artifactPath)]);
    const realRelativePath = relative(realRoot, realArtifact);
    if (
      !realRelativePath ||
      realRelativePath === '..' ||
      realRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(realRelativePath)
    ) {
      throw new ArtifactValidationError('Artifact resolves outside the workspace');
    }
    await readFile(realArtifact);
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      throw error;
    }
    throw new ArtifactValidationError(`Artifact cannot be read: ${artifactRelativePath}`, {
      cause: error,
    });
  }

  return {
    path: artifactRelativePath,
  };
}

async function verifyArtifact(workspaceRoot, reference) {
  if (!reference || typeof reference.path !== 'string') {
    throw new ArtifactValidationError('Artifact reference is invalid');
  }
  return await createArtifactReference(workspaceRoot, reference.path);
}

function outputDirectory(context, step) {
  return step.outputDirectory?.replace('<iniciativa>', context.initiative);
}

function markdownTableHeaders(markdown) {
  const lines = markdown.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    if (!line.trim().startsWith('|') || !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1] ?? '')) {
      return [];
    }
    return [line.trim().split('|').slice(1, -1).map((cell) => cell.trim()).join('|')];
  });
}

async function validateTemplateHeadings(context, step, documents) {
  if (step.id !== 'business-epic') return;

  let templatePath = new URL(`../../resources/${step.templates[0]}`, import.meta.url);
  let template;
  try {
    template = await readFile(templatePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    templatePath = new URL(`../${step.templates[0]}`, import.meta.url);
    template = await readFile(templatePath, 'utf8');
  }
  const requiredHeadings = [...template.matchAll(/^#{1,6}\s+.+$/gm)]
    .map(([heading]) => heading.replaceAll('<tema>', context.tema));
  const documentHeadings = [...documents[step.outputs[0]].matchAll(/^#{1,6}\s+.+$/gm)]
    .map(([heading]) => heading);
  let documentIndex = 0;
  const missingHeadings = requiredHeadings.filter((heading) => {
    while (documentIndex < documentHeadings.length && documentHeadings[documentIndex] !== heading) {
      documentIndex += 1;
    }
    if (documentIndex === documentHeadings.length) return true;
    documentIndex += 1;
    return false;
  });
  const requiredTables = markdownTableHeaders(template);
  const documentTables = markdownTableHeaders(documents[step.outputs[0]]);
  let tableIndex = 0;
  const missingTables = requiredTables.filter((table) => {
    while (tableIndex < documentTables.length && documentTables[tableIndex] !== table) {
      tableIndex += 1;
    }
    if (tableIndex === documentTables.length) return true;
    tableIndex += 1;
    return false;
  });

  if (missingHeadings.length || missingTables.length) {
    throw new WorkflowError(
      'ARTIFACT_NOT_FOUND',
      `Document for "${step.id}" must preserve the template headings and tables; missing headings: ${missingHeadings.join(', ') || 'none'}; missing tables: ${missingTables.join(', ') || 'none'}`,
    );
  }
}

async function assertOutputLocation(context, step, path) {
  const directory = outputDirectory(context, step);
  const prefix = `${directory}/`;
  const tail = typeof path === 'string' && path.startsWith(prefix) ? path.slice(prefix.length) : '';
  const parts = tail.split('/');
  const safe = parts.every((segment) => segment && segment !== '.' && segment !== '..' && !/[\\:]/.test(segment));
  const scope = parts.length === 1;
  if (!safe || !scope || !parts.at(-1).endsWith('.md')) {
    throw new ArtifactValidationError(`Output for "${step.id}" must be a Markdown file in ${directory}`);
  }
  await checkOutputDirectory(context.workspaceRoot, dirname(path).split(sep).join('/'));
  const info = await lstat(resolve(context.workspaceRoot, path)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (info && !info.isFile()) throw new ArtifactValidationError(`Output is not a regular file: ${path}`);
}

async function checkOutputDirectory(root, directory, create = false) {
  let current = root;
  for (const segment of directory.split('/')) {
    current = resolve(current, segment);
    if (create) {
      await mkdir(current).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    }
    const info = await lstat(current).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!info) return;
    if (!info.isDirectory()) throw new ArtifactValidationError(`Output directory must not be a symlink or file: ${current}`);
  }
}

async function verifyStoredArtifacts(context, step, artifacts) {
  const groups = step.accumulative
    ? [...new Set(artifacts.map(({ groupId }) => groupId))]
    : [undefined];
  for (const groupId of groups) {
    const group = artifacts.filter((artifact) => artifact.groupId === groupId);
    const actual = group.map(({ name }) => name).sort();
    const expected = [...step.outputs].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new ArtifactValidationError(`Stored outputs for "${step.id}" are incomplete`);
    }
    for (const artifact of group) {
      await assertOutputLocation(context, step, artifact.path);
      await verifyArtifact(context.workspaceRoot, artifact);
    }
  }
}

async function saveCurrentState(context, record) {
  const nodeIndex = record.initiativeState.nodes.findIndex(({ id }) => id === context.nodeId);
  if (nodeIndex < 0) record.initiativeState.nodes.push(record.state);
  else record.initiativeState.nodes[nodeIndex] = record.state;
  record.initiativeState.updatedAt = record.state.updatedAt;
  await saveState(statePath(context), record.initiativeState);
}

function computeApprovalFingerprint(state, gate) {
  const data = gate.requires
    .map((depId) => {
      const artifacts = findStep(state, depId)?.artifacts ?? [];
      const references = [...artifacts]
        .map(({ name, path, groupId }) => ({ name, path, ...(groupId ? { groupId } : {}) }))
        .sort((left, right) => `${left.name}\0${left.path}\0${left.groupId ?? ''}`.localeCompare(`${right.name}\0${right.path}\0${right.groupId ?? ''}`));
      return JSON.stringify({ stepType: depId, artifacts: references });
    })
    .join('\n');
  return createHash('sha256').update(data).digest('hex');
}

async function computeInputFingerprint(workspaceRoot, inputFiles) {
  const parts = await Promise.all(
    [...inputFiles].sort().map(async (file) => {
      try {
        const content = await readFile(resolve(workspaceRoot, file), 'utf8');
        return `${file}:${createHash('sha256').update(content).digest('hex')}`;
      } catch {
        return `${file}:missing`;
      }
    }),
  );
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function sameArtifactReferences(current, approved) {
  if (!Array.isArray(current) || !Array.isArray(approved)) return false;
  const normalize = (artifacts) => artifacts
    .map(({ name, path, groupId }) => ({ name, path, ...(groupId ? { groupId } : {}) }))
    .sort((left, right) => `${left.name}\0${left.path}\0${left.groupId ?? ''}`.localeCompare(`${right.name}\0${right.path}\0${right.groupId ?? ''}`));
  return JSON.stringify(normalize(current)) === JSON.stringify(normalize(approved));
}

function invalidateFromStep(state, stepId, reason) {
  const affected = new Set([stepId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of WORKFLOW_STEPS) {
      if (!affected.has(step.id) && step.requires.some((dependency) => affected.has(dependency))) {
        affected.add(step.id);
        changed = true;
      }
    }
  }

  for (const id of affected) {
    const definition = WORKFLOW_STEPS.find(({ id: candidate }) => candidate === id);
    resetStep(findStep(state, id), definition, id === stepId ? StepStatus.FAILED : StepStatus.PENDING, id === stepId ? reason : undefined);
  }
}

function groupArtifactReferences(artifacts) {
  const grouped = new Map();
  for (const artifact of artifacts) {
    const key = artifact.groupId ?? '';
    if (!grouped.has(key)) grouped.set(key, {});
    grouped.get(key)[artifact.name] = artifact;
  }
  return [...grouped.values()];
}

async function validatedPrerequisites(workspaceRoot, state, step) {
  const prerequisites = {};
  for (const dependencyId of step.requires) {
    const dependency = findStep(state, dependencyId);
    if (!dependency || (dependency.status !== StepStatus.COMPLETED && dependency.status !== StepStatus.ACCUMULATING)) {
      throw new WorkflowError('PREREQ_NOT_MET', `Workflow blocked: prerequisite "${dependencyId}" is incomplete`);
    }

    if (dependencyId === 'validation-gate') {
      const validatedArtifacts = {};
      for (const approval of dependency.approvedArtifacts ?? []) {
        const groups = groupArtifactReferences(approval.artifacts);
        const verifiedGroups = [];
        for (const group of groups) {
          const verified = {};
          for (const [name, reference] of Object.entries(group)) {
            verified[name] = await verifyArtifact(workspaceRoot, reference);
          }
          verifiedGroups.push(verified);
        }
        validatedArtifacts[approval.stepType] = verifiedGroups.length > 1
          ? verifiedGroups
          : verifiedGroups[0] ?? {};
      }
      prerequisites[dependencyId] = validatedArtifacts;
    } else {
      const groups = groupArtifactReferences(dependency.artifacts);
      const verifiedGroups = [];
      for (const group of groups) {
        const verified = {};
        for (const [name, reference] of Object.entries(group)) {
          verified[name] = await verifyArtifact(workspaceRoot, reference);
        }
        verifiedGroups.push(verified);
      }
      prerequisites[dependencyId] = verifiedGroups.length > 1
        ? verifiedGroups
        : verifiedGroups[0] ?? {};
    }
  }
  return prerequisites;
}

async function validateOutputs(context, step, result) {
  if (!result || typeof result.artifacts !== 'object' || result.artifacts === null) {
    throw new ArtifactValidationError(`Step "${step.id}" did not return its artifact outputs`);
  }

  assertOutputKeys(step, result.artifacts);
  const artifacts = {};
  for (const name of step.outputs) {
    await assertOutputLocation(context, step, result.artifacts[name]?.path);
    artifacts[name] = await verifyArtifact(context.workspaceRoot, result.artifacts[name]);
  }
  return artifacts;
}

function assertOutputKeys(step, outputs) {
  const expected = [...step.outputs].sort();
  const actual = Object.keys(outputs).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ArtifactValidationError(
      `Step "${step.id}" output keys must be: ${expected.join(', ') || '(none)'}`,
    );
  }
}

export async function readWorkflowRun(context) {
  const resolvedContext = await resolveRunContext(context);
  return withRunLock(resolvedContext, async () => (await loadOrCreateState(resolvedContext)).state);
}

function assertSourceRunContext({ workspaceRoot, runId }) {
  if (typeof workspaceRoot !== 'string' || !workspaceRoot ||
      typeof runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId)) {
    throw new WorkflowError('INVALID_SOURCE', 'workspaceRoot and a valid runId are required');
  }
  return { workspaceRoot: resolve(workspaceRoot), runId };
}

async function loadOrCreateRootState(context) {
  const filePath = statePath(context);
  let state;
  try {
    state = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') state = createInitialState(context);
    else if (error instanceof SyntaxError) {
      throw new WorkflowError('INVALID_RUN_STATE', `Workflow state is not valid JSON: ${filePath}`, { cause: error });
    } else throw error;
  }
  validateState(state, context, filePath);
  return state;
}

async function validateSourcePath(workspaceRoot, source) {
  if (typeof source.path !== 'string' || !source.path || isAbsolute(source.path) ||
      source.path.includes('\\') || source.path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new WorkflowError('INVALID_SOURCE', 'Source path must be a clean workspace-relative path');
  }
  const root = resolve(workspaceRoot);
  const target = resolve(root, source.path);
  const lexicalRelative = relative(root, target);
  if (!lexicalRelative || lexicalRelative === '..' || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
    throw new WorkflowError('INVALID_SOURCE', `Source path must stay inside the workspace: ${source.path}`);
  }
  let realRoot;
  let realTarget;
  try {
    [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  } catch (error) {
    throw new WorkflowError('INVALID_SOURCE', `Source path does not exist: ${source.path}`, { cause: error });
  }
  const actualRelative = relative(realRoot, realTarget);
  if (!actualRelative || actualRelative === '..' || actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative)) {
    throw new WorkflowError('INVALID_SOURCE', `Source resolves outside the workspace: ${source.path}`);
  }
  const info = await stat(realTarget);
  if ((source.kind === 'repository' && !info.isDirectory()) || (source.kind === 'document' && !info.isFile())) {
    throw new WorkflowError('INVALID_SOURCE', `Source kind "${source.kind}" does not match path: ${source.path}`);
  }
  if (source.scope !== undefined) {
    if (typeof source.scope !== 'string' || !source.scope || isAbsolute(source.scope) ||
        source.scope.includes('\\') || source.scope.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new WorkflowError('INVALID_SOURCE', 'Source scope must be a clean path relative to the source');
    }
    let realScope;
    try {
      realScope = await realpath(resolve(realTarget, source.scope));
    } catch (error) {
      throw new WorkflowError('INVALID_SOURCE', `Source scope does not exist: ${source.scope}`, { cause: error });
    }
    const scopeRelative = relative(realTarget, realScope);
    if (!scopeRelative || scopeRelative === '..' || scopeRelative.startsWith(`..${sep}`) || isAbsolute(scopeRelative)) {
      throw new WorkflowError('INVALID_SOURCE', `Source scope resolves outside its source: ${source.scope}`);
    }
  }
}

async function normalizeSource(workspaceRoot, source) {
  if (!isRecord(source) || typeof source.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(source.id) ||
      !SOURCE_KINDS.includes(source.kind) || !SOURCE_ROLES.includes(source.role)) {
    throw new WorkflowError('INVALID_SOURCE', 'Source requires a valid id, kind, and role');
  }
  const allowedFields = new Set(['id', 'path', 'kind', 'role', 'stack', 'scope', 'description']);
  if (Object.keys(source).some((field) => !allowedFields.has(field))) {
    throw new WorkflowError('INVALID_SOURCE', 'Source contains an unsupported field');
  }
  for (const field of ['stack', 'scope', 'description']) {
    if (source[field] !== undefined && (typeof source[field] !== 'string' || !source[field].trim())) {
      throw new WorkflowError('INVALID_SOURCE', `${field} must be a non-empty string when provided`);
    }
  }
  const normalized = {
    id: source.id,
    path: source.path,
    kind: source.kind,
    role: source.role,
    ...(source.stack ? { stack: source.stack.trim() } : {}),
    ...(source.scope ? { scope: source.scope } : {}),
    ...(source.description ? { description: source.description.trim() } : {}),
  };
  await validateSourcePath(workspaceRoot, normalized);
  return normalized;
}

function assertUniqueSource(sources, candidate, ignoredId) {
  if (sources.some(({ id }) => id === candidate.id && id !== ignoredId)) {
    throw new WorkflowError('INVALID_SOURCE', `Source id already exists: ${candidate.id}`);
  }
  if (sources.some((source) => source.path === candidate.path && source.id !== ignoredId)) {
    throw new WorkflowError('INVALID_SOURCE', `Source path already exists: ${candidate.path}`);
  }
}

export async function addSource(options) {
  const context = assertSourceRunContext(options);
  return withRunLock(context, async () => {
    const state = await loadOrCreateRootState(context);
    const source = await normalizeSource(context.workspaceRoot, options.source);
    assertUniqueSource(state.sources, source);
    state.sources.push(source);
    state.updatedAt = new Date().toISOString();
    await saveState(statePath(context), state);
    return source;
  });
}

export async function updateSource(options) {
  const context = assertSourceRunContext(options);
  return withRunLock(context, async () => {
    const state = await loadOrCreateRootState(context);
    const index = state.sources.findIndex(({ id }) => id === options.source?.id);
    if (index < 0) throw new WorkflowError('INVALID_SOURCE', `Source not found: ${options.source?.id}`);
    const source = await normalizeSource(context.workspaceRoot, { ...state.sources[index], ...options.source });
    assertUniqueSource(state.sources, source, source.id);
    state.sources[index] = source;
    state.updatedAt = new Date().toISOString();
    await saveState(statePath(context), state);
    return source;
  });
}

export async function removeSource(options) {
  const context = assertSourceRunContext(options);
  return withRunLock(context, async () => {
    const state = await loadOrCreateRootState(context);
    const index = state.sources.findIndex(({ id }) => id === options.sourceId);
    if (index < 0) throw new WorkflowError('INVALID_SOURCE', `Source not found: ${options.sourceId}`);
    const [removed] = state.sources.splice(index, 1);
    state.updatedAt = new Date().toISOString();
    await saveState(statePath(context), state);
    return removed;
  });
}

export async function listSources(options) {
  const context = assertSourceRunContext(options);
  return withRunLock(context, async () => (await loadOrCreateRootState(context)).sources);
}

export async function getReadyStepDetails(context) {
  const resolvedContext = await resolveRunContext(context);
  return withRunLock(resolvedContext, async () => {
    const record = await loadOrCreateState(resolvedContext);
    const { state } = record;
    let reconciled = false;
    for (const current of state.steps) {
      if (current.status === StepStatus.RUNNING && !(await processIsAlive(current.executionPid))) {
        current.status = StepStatus.FAILED;
        current.error = 'Previous stage execution was interrupted and can be retried';
        delete current.executionPid;
        delete current.executionToken;
        reconciled = true;
      }
    }
    if (reconciled) {
      state.updatedAt = new Date().toISOString();
      await saveCurrentState(resolvedContext, record);
    }

    const ready = [];
    for (const step of WORKFLOW_STEPS) {
      const current = findStep(state, step.id);
      if (current.status !== StepStatus.PENDING && current.status !== StepStatus.FAILED
          && !(step.accumulative && current.status === StepStatus.ACCUMULATING)) {
        continue;
      }
      try {
        const prerequisites = await validatedPrerequisites(
          resolvedContext.workspaceRoot,
          state,
          step,
        );
        const selected = await selectedSources(resolvedContext.workspaceRoot, record.initiativeState, step);
        const detail = {
          id: step.id,
          kind: step.kind ?? 'work',
          inputs: [...resolvedContext.inputFiles, ...step.inputs, ...selected.map(({ scopedPath }) => scopedPath)],
          sources: selected,
          outputs: step.outputs,
          outputDirectory: outputDirectory(resolvedContext, step),
          templates: step.templates,
          instructions: step.instructions,
          prerequisites,
          ...(step.kind === 'approval' ? { approvalFingerprint: computeApprovalFingerprint(state, step) } : {}),
        };
        ready.push(detail);
      } catch (error) {
        if (!(error instanceof ArtifactValidationError) && !/Workflow blocked:/.test(error.message)) {
          throw error;
        }
      }
    }
    return ready;
  });
}

export async function getReadySteps(context) {
  return (await getReadyStepDetails(context)).map(({ id }) => id);
}

async function selectedSources(workspaceRoot, state, step) {
  const selected = state.sources.filter(({ role }) => step.sourceRoles?.includes(role));
  for (const source of selected) await validateSourcePath(workspaceRoot, source);
  return selected.map((source) => ({
    ...source,
    scopedPath: source.scope ? `${source.path}/${source.scope}` : source.path,
  }));
}

export async function registerWorkflowOutputs({ stepId, paths, ...rawContext }) {
  const context = await resolveRunContext(rawContext);
  const step = WORKFLOW_STEPS.find(({ id }) => id === stepId);
  if (!step?.outputDirectory) throw new WorkflowError('ARTIFACT_NOT_FOUND', `Step "${stepId}" does not register documents`);
  assertOutputKeys(step, paths);
  const artifacts = {};
  for (const name of step.outputs) {
    await assertOutputLocation(context, step, paths[name]);
    artifacts[name] = await createArtifactReference(context.workspaceRoot, paths[name]);
  }
  return withRunLock(context, async () => {
    const record = await loadOrCreateState(context);
    const { state } = record;
    const completedAt = new Date().toISOString();
    const current = findStep(state, stepId);
    const groupId = randomUUID();
    const registered = Object.entries(artifacts)
      .map(([name, reference]) => ({ name, ...reference, ...(step.accumulative ? { groupId } : {}) }));
    current.status = step.accumulative ? StepStatus.ACCUMULATING : StepStatus.COMPLETED;
    current.artifacts = step.accumulative ? [...current.artifacts, ...registered] : registered;
    if (!step.accumulative) current.items = [];
    current.completedAt = completedAt;
    state.updatedAt = completedAt;
    await saveCurrentState(context, record);
    return state;
  });
}

function extractDocumentSlug(markdown, stepId) {
  if (!markdown || typeof markdown !== 'string') return null;

  if (stepId === 'decision-record') {
    const idMatch = markdown.match(/^-\s*\*\*ID:\*\*\s*`([^`]+)`/m);
    if (idMatch) {
      return idMatch[1]
        .toLowerCase()
        .replace(/^dec-/, '')
        .replace(/_/g, '-');
    }
  }

  const titleMatch = markdown.match(/^#+\s+(.+?)(?:\s*#+)?$/m);
  if (titleMatch) {
    const title = titleMatch[1];
    if (!title.includes(' — ')) return null;
    const afterDash = title.split(' — ').slice(1).join(' — ');
    return afterDash
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '');
  }

  return null;
}

export async function publishWorkflowStep({ stepId, documents, documentName, ...rawContext }) {
  const context = await resolveRunContext(rawContext);
  const step = WORKFLOW_STEPS.find(({ id }) => id === stepId);
  if (!step?.outputDirectory) throw new WorkflowError('ARTIFACT_NOT_FOUND', `Step "${stepId}" does not publish documents`);
  const names = Object.keys(documents ?? {});
  if (names.length !== step.outputs.length ||
    !step.outputs.every((name) => typeof documents[name] === 'string' && documents[name].trim())) {
    throw new WorkflowError('ARTIFACT_NOT_FOUND', `Expected non-empty Markdown for: ${step.outputs.join(', ')}`);
  }
  await validateTemplateHeadings(context, step, documents);
  if (documentName !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(documentName)) {
    throw new WorkflowError('ARTIFACT_NOT_FOUND', '--name must match /^[a-z0-9][a-z0-9-]*$/');
  }
  const directory = outputDirectory(context, step);
  const release = await acquireRunLock(resolve(dirname(statePath(context)), '..', 'publication'));
  const published = [];
  try {
    return await runWorkflowStep({
      ...rawContext,
      stepId,
      execute: async () => {
        await checkOutputDirectory(context.workspaceRoot, directory, true);
        const absolute = resolve(context.workspaceRoot, directory);
        const entries = await readdir(absolute);
        let next = entries.reduce((max, name) => {
          const number = /^(\d+)-/.exec(name)?.[1];
          return number ? (BigInt(number) > max ? BigInt(number) : max) : max;
        }, 0n) + 1n;

        let slug = documentName;
        if (!slug) {
          const firstOutput = step.outputs[0];
          const markdown = documents[firstOutput];
          slug = extractDocumentSlug(markdown, stepId);
        }
        slug = slug ?? context.nodeId;

        const artifacts = {};
        for (const name of step.outputs) {
          const path = `${directory}/${String(next++).padStart(3, '0')}-${slug}.md`;
          const destination = resolve(context.workspaceRoot, path);
          const temporary = resolve(absolute, `.smith-${randomUUID()}.tmp`);
          await writeFile(temporary, documents[name], { flag: 'wx' });
          try {
            await checkOutputDirectory(context.workspaceRoot, directory);
            await link(temporary, destination);
            published.push(destination);
          } finally {
            await unlink(temporary);
          }
          artifacts[name] = await createArtifactReference(context.workspaceRoot, path);
        }
        return { artifacts };
      },
    });
  } catch (error) {
    for (const file of published) await unlink(file);
    throw error;
  } finally {
    await release();
  }
}

export async function runWorkflowStep(options) {
  const { stepId, execute, ...rawContext } = options;
  const context = await resolveRunContext(rawContext);
  if (typeof execute !== 'function') {
    throw new WorkflowError('INVALID_EXECUTOR', 'execute must be a function');
  }

  const step = WORKFLOW_STEPS.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new WorkflowError('PREREQ_NOT_MET', `Unknown workflow step: ${stepId}`);
  }
  if (step.kind === 'approval') {
    throw new WorkflowError('INVALID_CONFIRMATION', `Step "${stepId}" requires explicit user approval`);
  }

  const filePath = statePath(context);
  const preparation = await withRunLock(context, async () => {
    const record = await loadOrCreateState(context);
    const { state } = record;
    let current = findStep(state, stepId);
    if (current.status === StepStatus.COMPLETED || current.status === StepStatus.ACCUMULATING) {
      if (step.accumulative) {
        // Accumulative steps always allow re-execution; downstream is not invalidated
      } else {
        return { state, completed: true };
      }
    }
    if (current.status === StepStatus.RUNNING && (await processIsAlive(current.executionPid))) {
      throw new WorkflowError('STEP_LOCKED', `Workflow step "${stepId}" is already running`);
    }
    const prerequisites = await validatedPrerequisites(context.workspaceRoot, state, step);
    const sources = await selectedSources(context.workspaceRoot, record.initiativeState, step);
    const executionToken = randomUUID();
    current.status = StepStatus.RUNNING;
    current.error = undefined;
    current.executionPid = process.pid;
    current.executionToken = executionToken;
    state.updatedAt = new Date().toISOString();
    await saveCurrentState(context, record);
    return { state, record, prerequisites, sources, executionToken, completed: false };
  });
  if (preparation.completed) {
    return preparation.state;
  }

  try {
    const result = await execute({
      step,
      workspaceRoot: resolve(context.workspaceRoot),
      inputFiles: [...context.inputFiles],
      sources: preparation.sources,
      prerequisites: preparation.prerequisites,
    });
    const artifacts = await validateOutputs(context, step, result);
    return await withRunLock(context, async () => {
      const record = await loadOrCreateState(context);
      const { state } = record;
      const current = findStep(state, stepId);
      if (current.executionToken !== preparation.executionToken) {
        throw new WorkflowError('STEP_LOCKED', `Workflow step "${stepId}" was invalidated before its output was saved`);
      }
      const groupId = randomUUID();
      const newArtifacts = Object.entries(artifacts)
        .map(([name, reference]) => ({ name, ...reference, ...(step.accumulative ? { groupId } : {}) }));
      current.artifacts = step.accumulative ? [...current.artifacts, ...newArtifacts] : newArtifacts;
      current.items = [];
      current.status = step.accumulative ? StepStatus.ACCUMULATING : StepStatus.COMPLETED;
      current.completedAt = new Date().toISOString();
      delete current.error;
      delete current.executionPid;
      delete current.executionToken;
      state.updatedAt = current.completedAt;
      await saveCurrentState(context, record);
      return state;
    });
  } catch (error) {
    await withRunLock(context, async () => {
      const record = await loadOrCreateState(context);
      const { state } = record;
      const current = findStep(state, stepId);
      if (current.executionToken === preparation.executionToken) {
        current.status = StepStatus.FAILED;
        current.error = error instanceof Error ? error.message : String(error);
        current.artifacts = [];
        delete current.executionPid;
        delete current.executionToken;
        state.updatedAt = new Date().toISOString();
        await saveCurrentState(context, record);
      }
    });
    throw error;
  }
}

export async function approveValidationGate(options) {
  const { confirmation, approvalFingerprint, ...rawContext } = options;
  const context = await resolveRunContext(rawContext);
  if (confirmation !== APPROVAL_CONFIRMATION) {
    throw new WorkflowError('INVALID_CONFIRMATION', `Explicit user confirmation must be "${APPROVAL_CONFIRMATION}"`);
  }

  const gate = WORKFLOW_STEPS.find(({ id }) => id === 'validation-gate');
  return withRunLock(context, async () => {
    const record = await loadOrCreateState(context);
    const { state } = record;

    const currentFingerprint = computeApprovalFingerprint(state, gate);
    if (approvalFingerprint !== currentFingerprint) {
      throw new WorkflowError('APPROVAL_FINGERPRINT_MISMATCH', 'Approval fingerprint does not match current state; artifacts may have changed since review');
    }

    const validated = await validatedPrerequisites(context.workspaceRoot, state, gate);

    const approvedArtifacts = gate.requires.map((stepType) => ({
      stepType,
      artifacts: findStep(state, stepType).artifacts.map((artifact) => ({ ...artifact })),
    }));

    const approvedAt = new Date().toISOString();
    const gateState = findStep(state, gate.id);
    gateState.status = StepStatus.COMPLETED;
    gateState.artifacts = [];
    gateState.items = [];
    gateState.approvedArtifacts = approvedArtifacts;
    gateState.approvedAt = approvedAt;
    gateState.approvalFingerprint = currentFingerprint;
    state.updatedAt = approvedAt;
    await saveCurrentState(context, record);
    return state;
  });
}
